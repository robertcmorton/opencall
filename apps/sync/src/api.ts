import type { IncomingMessage, ServerResponse } from "node:http";
import { and, desc, eq, ne, inArray } from "drizzle-orm";
import { ulid } from "ulid";
import {
  authContext,
  bearerToken,
  canManageEvent,
  canSeeEvent,
  createSession,
  hashPassword,
  resolveBearer,
  resolveJoinCode,
  revokeSession,
  revokeUserSessions,
  teamIdForEvent,
  teamIdForRundown,
  verifyPassword,
} from "./auth";
import { serializeCsv } from "@opencall/core";
import { inviteEmail, mailConfigured, sendMail } from "./mail";
import { grantInScope, refusedGrants, resolveGrants, type PeopleScope } from "./scope";
import { customEventTypes } from "./eventTypes";
import { customEventTypeCode } from "@opencall/core";

/**
 * The endings a caller asked for, keeping only the ones that mean something.
 *
 * A type describing itself as ending in "banana" is not an error worth a form
 * message — it is a client sending nonsense — but it must not be stored, or a
 * live chooser would render a button nobody can act on.
 */
const OUTCOME_KEYS = ["win", "lose", "draw", "golden"] as const;
const asOutcomeList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((k) => String(k)).filter((k) => (OUTCOME_KEYS as readonly string[]).includes(k)) : [];
import {
  buildRundownDoc,
  decodeDoc,
  encodeDoc,
  projectRundownDoc,
  schema,
  type DbHandle,
  type SeedRow,
} from "@opencall/db";
import * as Y from "yjs";

/**
 * Minimal JSON API for event/rundown/template management (dev-open CORS;
 * real auth arrives with the accounts hardening pass).
 */
/**
 * Fire-and-forget server error journal: everything lands in error_logs so
 * problems can be reviewed (and fixed) from the admin dashboard later.
 */
export function logServerError(
  handle: DbHandle,
  source: "server" | "process" | "client",
  err: unknown,
  extra: { url?: string; userAgent?: string; context?: Record<string, unknown> } = {},
): void {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 2000);
  const stack = err instanceof Error && err.stack ? err.stack.slice(0, 8000) : null;
  void handle.db
    .insert(schema.errorLogs)
    .values({ id: ulid(), source, message, stack, url: extra.url?.slice(0, 500), userAgent: extra.userAgent?.slice(0, 300), context: extra.context })
    .catch((e) => console.error("[sync] error-log write failed:", e));
}

// Client error reports are unauthenticated by design (view screens must be able
// to report) — a coarse budget keeps a misbehaving page from flooding the table.
let clientErrorBudget = 60;
setInterval(() => {
  clientErrorBudget = 60;
}, 60_000).unref();

// Login attempts share a coarse per-process budget to slow brute-forcing.
let loginBudget = 30;
setInterval(() => {
  loginBudget = 30;
}, 60_000).unref();

/**
 * Where the accept link points.
 *
 * The web app and the sync server are separate services on separate hosts, so
 * the sync server cannot know the app's address by looking at itself. It is
 * given one (PUBLIC_WEB_URL); failing that it uses the Origin the request
 * arrived with, which is the dashboard the person is standing in front of.
 */
function inviteUrl(req: IncomingMessage, token: string): string {
  const configured = process.env.PUBLIC_WEB_URL?.trim().replace(/\/$/, "");
  const origin = String(req.headers.origin ?? "").trim().replace(/\/$/, "");
  return `${configured || origin || ""}/invite/${token}`;
}

/**
 * What an invitation gives, in words rather than ids.
 *
 * It goes in the email and on the accept screen, so somebody deciding whether
 * to click can see what they are being handed. "company:01H8…" tells them
 * nothing; "Harbour Park Productions" tells them everything.
 */
async function describeGrants(
  db: DbHandle["db"],
  grants: { kind: string; targetId: string }[],
): Promise<string> {
  const names: string[] = [];
  for (const g of grants) {
    if (g.kind === "admin") {
      names.push("every event on this server");
      continue;
    }
    if (g.kind === "company") {
      const team = await db.query.teams.findFirst({ where: eq(schema.teams.id, g.targetId) });
      names.push(team ? `everything at ${team.name}` : "a company");
      continue;
    }
    const event = await db.query.events.findFirst({ where: eq(schema.events.id, g.targetId) });
    const label = event ? event.name : "an event";
    names.push(g.kind === "view" ? `${label} (view only)` : label);
  }
  if (names.length === 0) return "a run sheet";
  if (names.length === 1) return names[0]!;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function createApiHandler(
  handle: DbHandle,
  /** The live doc server, so in-place restore can kick stale connections. */
  docServer?: { closeConnections: (documentName?: string) => void; documents: Map<string, unknown> },
) {
  const { db } = handle;

  const readJson = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString("utf8");
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  };

  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.statusCode = status;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  };

  /** Dev stub: all data lives under the first team (created on demand). */
  const defaultTeamId = async (): Promise<string> => {
    const existing = await db.query.teams.findFirst();
    if (existing) return existing.id;
    const id = ulid();
    await db.insert(schema.teams).values({ id, name: "My Team", slug: `team-${id.slice(-6).toLowerCase()}` });
    return id;
  };

  return async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const { pathname } = url;
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type,authorization,x-join-code");
    res.setHeader("access-control-expose-headers", "x-source-name");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }

    /** Admin-only routes (across every company). */
    const requireAdmin = async (): Promise<boolean> => {
      if ((await authContext(handle, req))?.kind === "admin") return true;
      json(res, 401, { error: "admin token required" });
      return false;
    };

    /**
     * What slice of the world this context may administer people within.
     *
     * The rules themselves live in `./scope`, pure and tested. This works out
     * WHICH slice; that decides what may be done with it. `all` is the admin:
     * every company, every event.
     */
    const peopleScope = async (): Promise<PeopleScope | null> => {
      const ctx = await authContext(handle, req);
      if (ctx?.kind === "admin") return { all: true };
      // A company token, or an account holding a company grant, administers
      // people inside that company. An event-level grant does not: running one
      // show is not the same as managing who gets into the company.
      const teamIds =
        ctx?.kind === "company"
          ? [ctx.teamId]
          : ctx?.kind === "user"
            ? ctx.grants.filter((g) => g.kind === "company").map((g) => g.targetId)
            : [];
      if (teamIds.length === 0) return null;
      const events = await db.query.events.findMany({
        where: inArray(schema.events.teamId, teamIds),
        columns: { id: true },
      });
      return { all: false, teamIds, eventIds: events.map((e) => e.id) };
    };

    const requirePeopleScope = async (): Promise<PeopleScope | null> => {
      const scope = await peopleScope();
      if (!scope) json(res, 401, { error: "company or admin access required" });
      return scope;
    };

    const eventIdForRundown = async (rundownId: string): Promise<string | null> => {
      const r = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId), columns: { eventId: true } });
      return r?.eventId ?? null;
    };

    /** Anyone who may CHANGE this event: admin, owning company, or a user granted it. */
    const requireEventAccess = async (eventId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req);
      if (await canManageEvent(handle, ctx, eventId)) return true;
      json(res, 401, { error: "management access required" });
      return false;
    };

    /** Structural rundown changes (editors change content, not structure). */
    const requireRundownManage = async (rundownId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req);
      const eventId = await eventIdForRundown(rundownId);
      if (eventId && (await canManageEvent(handle, ctx, eventId))) return true;
      // A missing rundown is "not found", not "no access" — but only say so
      // to authenticated callers, so anonymous probes can't test what exists.
      if (!eventId && ctx) json(res, 404, { error: "rundown not found" });
      else json(res, 401, { error: "management access required" });
      return false;
    };

    /** Rundown-scoped panels/content: managers, or a caller/editor code. */
    const requireEditor = async (rundownId: string): Promise<boolean> => {
      const ctx = await authContext(handle, req, rundownId);
      if (ctx?.kind === "code" && ctx.rundownId === rundownId && ctx.role !== "follower") return true;
      const eventId = await eventIdForRundown(rundownId);
      if (eventId && (await canManageEvent(handle, ctx, eventId))) return true;
      json(res, 401, { error: "editor access required" });
      return false;
    };

    /** The dropped run sheet, base64 in JSON (≤ ~12MB decoded) → bytes, or null. */
    const sourceFileValue = (v: unknown): Uint8Array | null => {
      if (typeof v !== "string" || v.length === 0 || v.length > 16_000_000) return null;
      try {
        return new Uint8Array(Buffer.from(v, "base64"));
      } catch {
        return null;
      }
    };

    /** Which columns record who a row is for — strings only, deduplicated. */
    const roleColumnKeysOf = (body: Record<string, unknown>): string[] =>
      Array.isArray(body.roleColumnKeys)
        ? [...new Set((body.roleColumnKeys as unknown[]).filter((k): k is string => typeof k === "string" && !!k))].slice(0, 8)
        : [];

    /** Column keys in the source sheet's left-to-right order, if supplied. */
    const columnOrderOf = (body: Record<string, unknown>): string[] =>
      Array.isArray(body.columnOrder)
        ? (body.columnOrder as unknown[]).filter((k): k is string => typeof k === "string").slice(0, 100)
        : [];

    /** The sheet's own header names for the structural columns, if supplied. */
    const baseTitlesOf = (body: Record<string, unknown>): { title?: string; start?: string; duration?: string } | undefined => {
      const raw = body.baseTitles;
      if (typeof raw !== "object" || raw === null) return undefined;
      const pick = (k: "title" | "start" | "duration") => {
        const v = (raw as Record<string, unknown>)[k];
        return typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : undefined;
      };
      return { title: pick("title"), start: pick("start"), duration: pick("duration") };
    };

    /** Small inline image (data URL) or null to clear; anything else is rejected. */
    const imageValue = (v: unknown): string | null | undefined => {
      if (v === null) return null;
      if (typeof v === "string" && v.startsWith("data:image/") && v.length < 900_000) return v;
      return undefined;
    };

    /** Deletes a rundown and every row that references it. */
    const deleteRundown = async (rundownId: string): Promise<void> => {
      const sessions = await db.query.showSessions.findMany({
        where: eq(schema.showSessions.rundownId, rundownId),
        columns: { id: true },
      });
      if (sessions.length > 0)
        await db.delete(schema.showTransitions).where(
          inArray(schema.showTransitions.sessionId, sessions.map((s) => s.id)),
        );
      await db.delete(schema.showSessions).where(eq(schema.showSessions.rundownId, rundownId));
      await db.delete(schema.shareTokens).where(eq(schema.shareTokens.rundownId, rundownId));
      await db.delete(schema.rundownSnapshots).where(eq(schema.rundownSnapshots.rundownId, rundownId));
      await db.delete(schema.rundowns).where(eq(schema.rundowns.id, rundownId));
    };

    try {
      // ── Landing-page code resolution (public: a valid code IS the credential) ──
      if (req.method === "GET" && /^\/codes\/[^/]+$/.test(pathname)) {
        const resolved = await resolveJoinCode(handle, pathname.split("/")[2]!);
        if (!resolved) {
          json(res, 404, { error: "unknown code" });
          return true;
        }
        const row = await db.query.shareTokens.findFirst({ where: eq(schema.shareTokens.id, resolved.tokenId) });
        // `columns` is the SHOW list — null means "not set", which the client
        // reads as the phone-shaped default rather than "show nothing".
        json(res, 200, { ...resolved, columns: row?.columnVisibility ?? null });
        return true;
      }

      // ── Cross-show endpoints (admin) ──
      if (req.method === "GET" && pathname === "/live") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company" && ctx?.kind !== "user") {
          json(res, 401, { error: "access token required" });
          return true;
        }
        let sessions = await db.query.showSessions.findMany({
          where: ne(schema.showSessions.state, "ended"),
          columns: { rundownId: true, state: true, startedAt: true },
        });
        if (ctx.kind !== "admin") {
          const scoped: typeof sessions = [];
          for (const session of sessions) {
            const evId = await eventIdForRundown(session.rundownId);
            if (!evId) continue;
            const ev = await db.query.events.findFirst({ where: eq(schema.events.id, evId), columns: { teamId: true } });
            if (ev && (await canSeeEvent(handle, ctx, evId, ev.teamId))) scoped.push(session);
          }
          sessions = scoped;
        }
        json(res, 200, sessions.map((s) => ({ ...s, startedAt: s.startedAt.toISOString() })));
        return true;
      }

      // ── Who am I (drives the dashboard header + visibility) ──
      if (req.method === "GET" && pathname === "/me") {
        const ctx = await resolveBearer(handle, bearerToken(req));
        if (process.env.ADMIN_TOKEN == null) {
          json(res, 200, { role: "admin", devOpen: true });
          return true;
        }
        if (!ctx) json(res, 200, { role: null });
        else if (ctx.kind === "admin") json(res, 200, { role: "admin", name: ctx.name });
        else if (ctx.kind === "company") json(res, 200, { role: "company", teamId: ctx.teamId, teamName: ctx.teamName });
        else if (ctx.kind === "user") {
          const row = await db.query.users.findFirst({ where: eq(schema.users.id, ctx.userId), columns: { email: true } });
          json(res, 200, {
            role: "user",
            name: ctx.name,
            email: row?.email ?? null,
            grants: ctx.grants,
            canManage: ctx.grants.some((g) => g.kind !== "view"),
          });
        } else json(res, 200, { role: null });
        return true;
      }

      // Self-service profile for account sign-ins (token sign-ins have none).
      if (req.method === "PATCH" && pathname === "/me") {
        const ctx = await resolveBearer(handle, bearerToken(req));
        if (ctx?.kind !== "user") {
          json(res, 400, { error: "sign in with an email account to edit a profile" });
          return true;
        }
        const body = await readJson(req);
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 120);
        if (typeof body.email === "string" && /.+@.+\..+/.test(body.email.trim())) patch.email = body.email.trim().toLowerCase();
        try {
          if (Object.keys(patch).length > 0) await db.update(schema.users).set(patch).where(eq(schema.users.id, ctx.userId));
        } catch {
          json(res, 409, { error: "that email is already in use" });
          return true;
        }
        json(res, 200, { ok: true });
        return true;
      }

      // ── Accounts: password login & sessions ──
      if (req.method === "POST" && pathname === "/auth/login") {
        if (loginBudget <= 0) {
          json(res, 429, { error: "too many attempts — wait a minute" });
          return true;
        }
        loginBudget -= 1;
        const body = await readJson(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        const user = email ? await db.query.users.findFirst({ where: eq(schema.users.email, email) }) : null;
        // One indistinct error for unknown email and wrong password alike.
        if (!user || !verifyPassword(password, user.passwordHash)) {
          json(res, 401, { error: "invalid email or password" });
          return true;
        }
        const session = await createSession(handle, user.id, req.headers["user-agent"]);
        json(res, 200, { token: session.token, expiresAt: session.expiresAt.toISOString(), name: user.name });
        return true;
      }

      if (req.method === "POST" && pathname === "/auth/logout") {
        const token = bearerToken(req);
        if (token?.startsWith("ses_")) await revokeSession(handle, token);
        json(res, 200, {});
        return true;
      }

      if (req.method === "POST" && pathname === "/auth/change-password") {
        const token = bearerToken(req);
        const ctx = await resolveBearer(handle, token);
        // Password changes are for signed-in ACCOUNTS (session or personal token);
        // resolveBearer folds admin-grant users into "admin", so look the user up directly.
        const body = await readJson(req);
        const current = String(body.current ?? "");
        const next = String(body.next ?? "");
        let userId: string | null = null;
        if (token?.startsWith("ses_")) {
          const session = await db.query.authSessions.findFirst({ where: eq(schema.authSessions.token, token) });
          if (session && !session.revokedAt && session.expiresAt >= new Date()) userId = session.userId;
        } else if (token && ctx) {
          const user = await db.query.users.findFirst({ where: eq(schema.users.accessToken, token) });
          userId = user?.id ?? null;
        }
        if (!userId) {
          json(res, 401, { error: "sign in first" });
          return true;
        }
        if (next.length < 8) {
          json(res, 400, { error: "new password must be at least 8 characters" });
          return true;
        }
        const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
        if (user?.passwordHash && !verifyPassword(current, user.passwordHash)) {
          json(res, 401, { error: "current password is wrong" });
          return true;
        }
        await db.update(schema.users).set({ passwordHash: hashPassword(next) }).where(eq(schema.users.id, userId));
        // Every other session dies with the old password; this one stays.
        if (token?.startsWith("ses_")) {
          await revokeUserSessions(handle, userId);
          await db.update(schema.authSessions).set({ revokedAt: null }).where(eq(schema.authSessions.token, token));
        } else {
          await revokeUserSessions(handle, userId);
        }
        json(res, 200, {});
        return true;
      }

      if (req.method === "POST" && /^\/users\/[^/]+\/set-password$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        const password = String(body.password ?? "");
        if (password.length < 8) {
          json(res, 400, { error: "password must be at least 8 characters" });
          return true;
        }
        await db.update(schema.users).set({ passwordHash: hashPassword(password) }).where(eq(schema.users.id, id));
        await revokeUserSessions(handle, id); // old sessions die with the old password
        json(res, 200, { id });
        return true;
      }

      // ── Error log ──
      // Browsers report their errors here; admins review and clear below.
      if (req.method === "POST" && pathname === "/client-errors") {
        const body = await readJson(req).catch(() => ({}) as Record<string, unknown>);
        if (clientErrorBudget > 0 && typeof body.message === "string" && body.message.trim()) {
          clientErrorBudget -= 1;
          logServerError(handle, "client", new Error(String(body.message).slice(0, 2000)), {
            url: typeof body.url === "string" ? body.url : undefined,
            userAgent: req.headers["user-agent"],
            context: typeof body.stack === "string" ? { stack: body.stack.slice(0, 8000) } : undefined,
          });
        }
        res.statusCode = 204;
        res.end();
        return true;
      }

      if (req.method === "GET" && pathname === "/errors") {
        if (!(await requireAdmin())) return true;
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200)));
        const rows = await db.query.errorLogs.findMany({ orderBy: desc(schema.errorLogs.at), limit });
        json(
          res,
          200,
          rows.map((r) => ({
            id: r.id,
            at: r.at.toISOString(),
            source: r.source,
            message: r.message,
            stack: r.stack ?? (r.context as { stack?: string } | null)?.stack ?? null,
            url: r.url,
            userAgent: r.userAgent,
          })),
        );
        return true;
      }

      if (req.method === "DELETE" && pathname === "/errors") {
        if (!(await requireAdmin())) return true;
        await db.delete(schema.errorLogs);
        json(res, 200, {});
        return true;
      }

      // ── Users & access (admin only): who controls what ──
      if (req.method === "GET" && pathname === "/users") {
        if (!(await requireAdmin())) return true;
        const users = await db.query.users.findMany();
        const grants = await db.query.userGrants.findMany();
        json(
          res,
          200,
          users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            accessToken: u.accessToken,
            hasPassword: u.passwordHash != null,
            grants: grants.filter((g) => g.userId === u.id).map((g) => ({ kind: g.kind, targetId: g.targetId })),
          })),
        );
        return true;
      }

      /**
       * People this context administers, and the pending invitations to join
       * them. Scoped: a company sees its own crew and nobody else's.
       */
      if (req.method === "GET" && pathname === "/people") {
        const scope = await requirePeopleScope();
        if (!scope) return true;
        const allUsers = await db.query.users.findMany();
        const allGrants = await db.query.userGrants.findMany();
        const people = allUsers
          .map((u) => ({
            u,
            // ONLY the grants this context is entitled to know about. A
            // freelancer's other companies never leave the server.
            grants: allGrants.filter((g) => g.userId === u.id && grantInScope(scope, g)),
          }))
          .filter((p) => scope.all || p.grants.length > 0)
          .map(({ u, grants }) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            hasPassword: u.passwordHash != null,
            grants: grants.map((g) => ({ kind: g.kind, targetId: g.targetId })),
          }));

        const invites = (await db.query.userInvites.findMany())
          .filter((i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date())
          .filter((i) => scope.all || (i.teamId != null && scope.teamIds.includes(i.teamId)))
          .map((i) => ({
            id: i.id,
            email: i.email,
            name: i.name,
            grants: i.grants,
            expiresAt: i.expiresAt.toISOString(),
            url: inviteUrl(req, i.token),
          }));
        json(res, 200, { people, invites, mailConfigured: mailConfigured() });
        return true;
      }

      /** Invite someone by email. The link is returned either way. */
      if (req.method === "POST" && pathname === "/invites") {
        const scope = await requirePeopleScope();
        if (!scope) return true;
        const body = await readJson(req);
        const email = String(body.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          json(res, 400, { error: "A valid email address is required" });
          return true;
        }
        const asked = Array.isArray(body.grants) ? (body.grants as { kind: string; targetId?: string }[]) : [];
        const grants = resolveGrants(scope, asked);
        if (grants.length === 0) {
          json(res, 400, { error: "Choose what this person may open" });
          return true;
        }
        if (refusedGrants(scope, grants).length > 0) {
          json(res, 403, { error: "That is not yours to give access to" });
          return true;
        }

        const ctx = await authContext(handle, req);
        // Which company's invitation this is. An admin may say; otherwise it
        // is read off the grants — a company grant names one outright, and an
        // event grant belongs to whichever company owns the event. Without it
        // the accept screen cannot say WHO is inviting you, which is the first
        // thing anyone wants to know about a link in their inbox.
        let teamId: string | null = scope.all ? (typeof body.teamId === "string" ? body.teamId : null) : scope.teamIds[0]!;
        if (!teamId) {
          const companyGrant = grants.find((g) => g.kind === "company");
          if (companyGrant) teamId = companyGrant.targetId;
          else {
            const eventGrant = grants.find((g) => g.kind === "event" || g.kind === "view");
            if (eventGrant) teamId = await teamIdForEvent(handle, eventGrant.targetId);
          }
        }

        // Somebody who already has an account gets the access added rather
        // than a second identity — which is what "invite them to this event"
        // means when they already work here.
        const existing = await db.query.users.findFirst({ where: eq(schema.users.email, email) });
        if (existing) {
          for (const g of grants) {
            await db
              .insert(schema.userGrants)
              .values({ userId: existing.id, kind: g.kind as never, targetId: g.targetId })
              .onConflictDoNothing();
          }
          json(res, 200, { added: true, userId: existing.id, name: existing.name });
          return true;
        }

        const id = ulid();
        const token = `inv_${ulid().toLowerCase()}${Math.random().toString(36).slice(2, 10)}`;
        const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
        await db.insert(schema.userInvites).values({
          id,
          email,
          name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : null,
          token,
          teamId,
          grants: grants as never,
          invitedByUserId: ctx?.kind === "user" ? ctx.userId : null,
          expiresAt,
        });

        const url = inviteUrl(req, token);
        const from = ctx?.kind === "company" ? ctx.teamName : ctx?.kind === "user" ? ctx.name : "An administrator";
        const access = await describeGrants(db, grants);
        const mail = inviteEmail({ url, from: from ?? "OpenCall", access });
        const sent = await sendMail(email, mail.subject, mail.text, mail.html);
        // The link comes back whether or not the mail went: an invitation
        // whose email could not be sent is still a valid invitation.
        json(res, 201, { id, url, emailed: sent.sent, reason: sent.reason });
        return true;
      }

      /** Withdraw an invitation before it is accepted. */
      if (req.method === "DELETE" && /^\/invites\/[^/]+$/.test(pathname)) {
        const scope = await requirePeopleScope();
        if (!scope) return true;
        const inviteId = pathname.split("/")[2]!;
        const row = await db.query.userInvites.findFirst({ where: eq(schema.userInvites.id, inviteId) });
        if (!row || (!scope.all && !(row.teamId && scope.teamIds.includes(row.teamId)))) {
          json(res, 404, { error: "unknown invitation" });
          return true;
        }
        await db.update(schema.userInvites).set({ revokedAt: new Date() }).where(eq(schema.userInvites.id, inviteId));
        json(res, 200, { ok: true });
        return true;
      }

      /** What an invitation is for — public, because the holder has no account yet. */
      if (req.method === "GET" && /^\/invites\/[^/]+$/.test(pathname)) {
        const row = await db.query.userInvites.findFirst({ where: eq(schema.userInvites.token, pathname.split("/")[2]!) });
        if (!row || row.acceptedAt || row.revokedAt || row.expiresAt < new Date()) {
          json(res, 404, { error: "This invitation has expired or already been used." });
          return true;
        }
        const team = row.teamId ? await db.query.teams.findFirst({ where: eq(schema.teams.id, row.teamId) }) : null;
        json(res, 200, {
          email: row.email,
          name: row.name,
          company: team?.name ?? null,
          access: await describeGrants(db, row.grants),
        });
        return true;
      }

      /** Accept: a name, a password, and the access the invitation carried. */
      if (req.method === "POST" && /^\/invites\/[^/]+\/accept$/.test(pathname)) {
        const token = pathname.split("/")[2]!;
        const row = await db.query.userInvites.findFirst({ where: eq(schema.userInvites.token, token) });
        if (!row || row.acceptedAt || row.revokedAt || row.expiresAt < new Date()) {
          json(res, 404, { error: "This invitation has expired or already been used." });
          return true;
        }
        const body = await readJson(req);
        const name = String(body.name ?? "").trim();
        const password = String(body.password ?? "");
        if (!name) {
          json(res, 400, { error: "Your name is required" });
          return true;
        }
        if (password.length < 8) {
          json(res, 400, { error: "Choose a password of at least 8 characters" });
          return true;
        }
        const userId = ulid();
        await db.insert(schema.users).values({
          id: userId,
          name: name.slice(0, 80),
          email: row.email,
          accessToken: `usr_${ulid().toLowerCase()}`,
          passwordHash: hashPassword(password),
        });
        // Exactly what the invitation carried — accepting cannot ask for more.
        for (const g of row.grants) {
          await db.insert(schema.userGrants).values({ userId, kind: g.kind as never, targetId: g.targetId }).onConflictDoNothing();
        }
        // Single use.
        await db.update(schema.userInvites).set({ acceptedAt: new Date() }).where(eq(schema.userInvites.id, row.id));
        const session = await createSession(handle, userId, String(req.headers["user-agent"] ?? ""));
        json(res, 201, { token: session.token, expiresAt: session.expiresAt.toISOString(), name });
        return true;
      }

      if (req.method === "POST" && pathname === "/users") {
        if (!(await requireAdmin())) return true;
        const body = await readJson(req);
        const name = String(body.name ?? "").trim();
        if (!name) {
          json(res, 400, { error: "name required" });
          return true;
        }
        const id = ulid();
        const token = `usr_${ulid().toLowerCase()}`;
        const password = String(body.password ?? "");
        if (password && password.length < 8) {
          json(res, 400, { error: "password must be at least 8 characters" });
          return true;
        }
        await db.insert(schema.users).values({
          id,
          name,
          email: String(body.email ?? `${id.toLowerCase()}@local`).trim().toLowerCase() || `${id.toLowerCase()}@local`,
          accessToken: token,
          passwordHash: password ? hashPassword(password) : null,
        });
        const grants = Array.isArray(body.grants) ? (body.grants as { kind: string; targetId?: string }[]) : [];
        for (const g of grants) {
          if (!["admin", "company", "event", "view"].includes(g.kind)) continue;
          await db.insert(schema.userGrants).values({ userId: id, kind: g.kind as never, targetId: String(g.targetId ?? "") });
        }
        json(res, 201, { id, accessToken: token });
        return true;
      }

      if (req.method === "PATCH" && /^\/users\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        if (typeof body.name === "string" && body.name.trim())
          await db.update(schema.users).set({ name: body.name.trim() }).where(eq(schema.users.id, id));
        if (Array.isArray(body.grants)) {
          await db.delete(schema.userGrants).where(eq(schema.userGrants.userId, id));
          for (const g of body.grants as { kind: string; targetId?: string }[]) {
            if (!["admin", "company", "event", "view"].includes(g.kind)) continue;
            await db.insert(schema.userGrants).values({ userId: id, kind: g.kind as never, targetId: String(g.targetId ?? "") });
          }
        }
        json(res, 200, { id });
        return true;
      }

      if (req.method === "POST" && /^\/users\/[^/]+\/rotate-token$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const token = `usr_${ulid().toLowerCase()}`;
        await db.update(schema.users).set({ accessToken: token }).where(eq(schema.users.id, id));
        json(res, 200, { id, accessToken: token });
        return true;
      }

      if (req.method === "DELETE" && /^\/users\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        await db.delete(schema.userGrants).where(eq(schema.userGrants.userId, id));
        await db.delete(schema.authSessions).where(eq(schema.authSessions.userId, id));
        await db.delete(schema.users).where(eq(schema.users.id, id));
        json(res, 200, { id });
        return true;
      }

      // ── Archive / unarchive (admin or owning company) ──
      if (req.method === "POST" && /^\/events\/[^/]+\/archive$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireEventAccess(id))) return true;
        const body = await readJson(req);
        await db
          .update(schema.events)
          .set({ archivedAt: body.archived === false ? null : new Date() })
          .where(eq(schema.events.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/archive$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const body = await readJson(req);
        await db
          .update(schema.rundowns)
          .set({ archivedAt: body.archived === false ? null : new Date() })
          .where(eq(schema.rundowns.id, id));
        json(res, 200, { id });
        return true;
      }

      // ── Event companies (admin only): showcaller credentials per company ──
      if (req.method === "GET" && pathname === "/companies") {
        if (!(await requireAdmin())) return true;
        const teams = await db.query.teams.findMany();
        const events = await db.query.events.findMany({ columns: { teamId: true } });
        json(
          res,
          200,
          teams.map((t) => ({
            id: t.id,
            name: t.name,
            companyToken: t.companyToken,
            logo: t.logo ?? null,
            eventCount: events.filter((e) => e.teamId === t.id).length,
          })),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/companies") {
        if (!(await requireAdmin())) return true;
        const body = await readJson(req);
        const name = String(body.name ?? "").trim();
        if (!name) {
          json(res, 400, { error: "name required" });
          return true;
        }
        const id = ulid();
        const token = `co_${ulid().toLowerCase()}`;
        await db.insert(schema.teams).values({
          id,
          name,
          slug: `co-${id.slice(-8).toLowerCase()}`,
          companyToken: token,
        });
        json(res, 201, { id, companyToken: token });
        return true;
      }

      if (req.method === "POST" && /^\/companies\/[^/]+\/rotate-token$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const token = `co_${ulid().toLowerCase()}`;
        await db.update(schema.teams).set({ companyToken: token }).where(eq(schema.teams.id, id));
        json(res, 200, { id, companyToken: token });
        return true;
      }

      if (req.method === "DELETE" && /^\/companies\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        // Cascade: every event under the company (and everything under those),
        // the company's templates and memberships, then the company itself.
        const companyEvents = await db.query.events.findMany({
          where: eq(schema.events.teamId, id),
          columns: { id: true },
        });
        for (const event of companyEvents) {
          const rundowns = await db.query.rundowns.findMany({
            where: eq(schema.rundowns.eventId, event.id),
            columns: { id: true },
          });
          for (const r of rundowns) await deleteRundown(r.id);
          await db.delete(schema.events).where(eq(schema.events.id, event.id));
        }
        await db.delete(schema.templates).where(eq(schema.templates.teamId, id));
        await db.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, id));
        await db.delete(schema.teams).where(eq(schema.teams.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "PATCH" && /^\/companies\/[^/]+$/.test(pathname)) {
        if (!(await requireAdmin())) return true;
        const id = pathname.split("/")[2]!;
        const body = await readJson(req);
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
        const logo = imageValue(body.logo);
        if (logo !== undefined) patch.logo = logo;
        if (Object.keys(patch).length > 0) await db.update(schema.teams).set(patch).where(eq(schema.teams.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "PATCH" && /^\/events\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireEventAccess(id))) return true;
        const body = await readJson(req);
        const current = await db.query.events.findFirst({ where: eq(schema.events.id, id) });
        if (!current) {
          json(res, 404, { error: "event not found" });
          return true;
        }
        const patch: Record<string, unknown> = {};
        if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
        if (typeof body.location === "string") patch.location = body.location.trim() || null;
        const image1 = imageValue(body.image1);
        if (image1 !== undefined) patch.image1 = image1;
        const image2 = imageValue(body.image2);
        if (image2 !== undefined) patch.image2 = image2;
        const dateOk = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
        if (dateOk(body.startDate)) patch.startDate = body.startDate;
        if (dateOk(body.endDate)) patch.endDate = body.endDate;
        {
          // The ordering rule holds on the MERGED result, whichever side changed.
          const nextStart = (patch.startDate as string | undefined) ?? current.startDate;
          const nextEnd = (patch.endDate as string | undefined) ?? current.endDate;
          if (nextEnd < nextStart) {
            json(res, 400, { error: "end date cannot be before the start date" });
            return true;
          }
        }
        if (typeof body.timezone === "string" && body.timezone && body.timezone !== current.timezone) {
          // The event's primary time may only change when its LOCATION changes.
          const locationChanged =
            typeof body.location === "string" && (body.location.trim() || null) !== current.location;
          if (!locationChanged) {
            json(res, 400, { error: "timezone can only change together with the event location" });
            return true;
          }
          patch.timezone = body.timezone;
        }
        if (body.sport === null) patch.sport = null;
        else if (typeof body.sport === "string") patch.sport = body.sport.trim().toLowerCase().slice(0, 24) || null;
        if (Object.keys(patch).length > 0) await db.update(schema.events).set(patch).where(eq(schema.events.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "DELETE" && /^\/events\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireEventAccess(id))) return true;
        const rundowns = await db.query.rundowns.findMany({
          where: eq(schema.rundowns.eventId, id),
          columns: { id: true },
        });
        for (const r of rundowns) await deleteRundown(r.id);
        await db.delete(schema.events).where(eq(schema.events.id, id));
        json(res, 200, { id });
        return true;
      }

      if (req.method === "PATCH" && /^\/rundowns\/[^/]+$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const body = await readJson(req);
        if (typeof body.name === "string" && body.name.trim()) {
          const name = body.name.trim();
          const row = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, id) });
          if (!row) {
            json(res, 404, { error: "rundown not found" });
            return true;
          }
          const patch: { name: string; doc?: Uint8Array; docUpdatedAt?: Date } = { name };
          // Keep the doc's meta name in step. (A concurrently open editor may
          // overwrite this on its next store; the row name is authoritative
          // for dashboards either way.)
          if (row.doc) {
            const doc = decodeDoc(row.doc);
            doc.getMap("meta").set("name", name);
            patch.doc = encodeDoc(doc);
            patch.docUpdatedAt = new Date();
          }
          await db.update(schema.rundowns).set(patch).where(eq(schema.rundowns.id, id));
        }
        // What kind of show THIS sheet is. Null clears it, which falls back to
        // the event's default rather than meaning "no type".
        if (body.sport === null) {
          await db.update(schema.rundowns).set({ sport: null }).where(eq(schema.rundowns.id, id));
        } else if (typeof body.sport === "string") {
          const sport = body.sport.trim().toLowerCase().slice(0, 40) || null;
          await db.update(schema.rundowns).set({ sport }).where(eq(schema.rundowns.id, id));
        }
        json(res, 200, { id });
        return true;
      }

      if (req.method === "DELETE" && /^\/rundowns\/[^/]+$/.test(pathname)) {
        if (!(await requireRundownManage(pathname.split("/")[2]!))) return true;
        await deleteRundown(pathname.split("/")[2]!);
        json(res, 200, {});
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/duplicate$/.test(pathname)) {
        const sourceId = pathname.split("/")[2]!;
        if (!(await requireRundownManage(sourceId))) return true;
        const source = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, sourceId) });
        if (!source?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const id = ulid();
        const name = `${source.name} (copy)`;
        const doc = decodeDoc(source.doc);
        doc.getMap("meta").set("name", name);
        await db.insert(schema.rundowns).values({
          id,
          eventId: source.eventId,
          name,
          description: source.description,
          showDate: source.showDate,
          plannedStartSec: source.plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
        });
        json(res, 201, { id });
        return true;
      }

      if (req.method === "GET" && pathname === "/events") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company" && ctx?.kind !== "user") {
          json(res, 401, { error: "access token required" });
          return true;
        }
        const includeArchived = url.searchParams.get("archived") === "1";
        const all = await db.query.events.findMany();
        const events = [] as typeof all;
        for (const e of all) {
          if (!includeArchived && e.archivedAt) continue;
          if (await canSeeEvent(handle, ctx, e.id, e.teamId)) events.push(e);
        }
        const rundowns = await db.query.rundowns.findMany({
          columns: {
            id: true,
            eventId: true,
            name: true,
            description: true,
            showDate: true,
            archivedAt: true,
            sport: true,
            sourceName: true,
          },
        });
        json(
          res,
          200,
          events.map((event) => ({
            ...event,
            rundowns: rundowns.filter(
              (r) => r.eventId === event.id && (includeArchived || !r.archivedAt),
            ),
          })),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/events") {
        const ctx = await authContext(handle, req);
        // Company-level reach creates events: an admin anywhere, a company
        // token in its own company, an account holder in the companies their
        // grants cover. (An event-only or view grant never creates events.)
        const companyGrants =
          ctx?.kind === "user" ? ctx.grants.filter((g) => g.kind === "company").map((g) => g.targetId) : [];
        if (!ctx || (ctx.kind !== "admin" && ctx.kind !== "company" && companyGrants.length === 0)) {
          json(res, 401, { error: "admin or company access required" });
          return true;
        }
        const body = await readJson(req);
        const createStart = String(body.startDate ?? new Date().toISOString().slice(0, 10));
        const createEnd = String(body.endDate ?? body.startDate ?? new Date().toISOString().slice(0, 10));
        if (createEnd < createStart) {
          json(res, 400, { error: "end date cannot be before the start date" });
          return true;
        }
        const id = ulid();
        const asked = typeof body.teamId === "string" && body.teamId ? body.teamId : null;
        let teamId: string;
        if (ctx.kind === "company") teamId = ctx.teamId;
        else if (companyGrants.length > 0) {
          // An account holder creates only inside a company they manage.
          teamId = asked ?? companyGrants[0]!;
          if (!companyGrants.includes(teamId)) {
            json(res, 403, { error: "that company is outside your access" });
            return true;
          }
        } else teamId = asked ?? (await defaultTeamId());
        await db.insert(schema.events).values({
          id,
          teamId,
          name: String(body.name ?? "Untitled Event"),
          location: body.location ? String(body.location) : null,
          startDate: createStart,
          endDate: createEnd,
          timezone: String(body.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone),
          sport: typeof body.sport === "string" && body.sport.trim() ? body.sport.trim().toLowerCase().slice(0, 40) : null,
          use24h: Boolean(body.use24h ?? false),
        });
        json(res, 201, { id });
        return true;
      }

      /**
       * Kinds of show a company has added for itself.
       *
       * Readable by anyone who may see the company's events, because the
       * picker on the import screen needs them; writable by whoever
       * administers its people, which is the same bar as handing out access.
       */
      if (req.method === "GET" && pathname === "/event-types") {
        const ctx = await authContext(handle, req);
        const teamId = ctx?.kind === "company" ? ctx.teamId : typeof url.searchParams.get("teamId") === "string" ? url.searchParams.get("teamId") : null;
        json(res, 200, { types: await customEventTypes(db, teamId) });
        return true;
      }

      if (req.method === "POST" && pathname === "/event-types") {
        const scope = await requirePeopleScope();
        if (!scope) return true;
        const ctx = await authContext(handle, req);
        const body = await readJson(req);
        const label = String(body.label ?? "").trim().slice(0, 60);
        if (!label) {
          json(res, 400, { error: "Name this kind of show" });
          return true;
        }
        const fullTime = asOutcomeList(body.fullTime);
        if (fullTime.length === 0) {
          json(res, 400, { error: "Choose how it can end" });
          return true;
        }
        // Whose it is: a company's own, or the whole installation's when an
        // administrator adds one without naming a company.
        const teamId = scope.all ? (typeof body.teamId === "string" ? body.teamId : null) : scope.teamIds[0]!;
        let code = customEventTypeCode(label);
        // A second "Water polo" at another company must not collide on the
        // unique code, and must not quietly overwrite the first.
        if (await db.query.customEventTypes.findFirst({ where: eq(schema.customEventTypes.code, code) })) {
          code = `${code}-${ulid().toLowerCase().slice(-6)}`;
        }
        const id = ulid();
        await db.insert(schema.customEventTypes).values({
          id,
          teamId,
          code,
          label,
          fullTime,
          afterExtra: asOutcomeList(body.afterExtra),
          extraLabel: typeof body.extraLabel === "string" && body.extraLabel.trim() ? body.extraLabel.trim().slice(0, 40) : null,
          resultDuePhrases: Array.isArray(body.resultDuePhrases)
            ? (body.resultDuePhrases as unknown[])
                .map((p) => String(p ?? "").trim().slice(0, 60))
                .filter(Boolean)
                .slice(0, 8)
            : [],
          blurb: typeof body.blurb === "string" && body.blurb.trim() ? body.blurb.trim().slice(0, 200) : null,
          createdBy: ctx?.kind === "user" ? ctx.userId : null,
        });
        json(res, 201, { id, code });
        return true;
      }

      if (req.method === "DELETE" && /^\/event-types\/[^/]+$/.test(pathname)) {
        const scope = await requirePeopleScope();
        if (!scope) return true;
        const row = await db.query.customEventTypes.findFirst({
          where: eq(schema.customEventTypes.id, pathname.split("/")[2]!),
        });
        // Another company's type is not merely un-deletable, it is not there.
        if (!row || (!scope.all && !(row.teamId && scope.teamIds.includes(row.teamId)))) {
          json(res, 404, { error: "unknown event type" });
          return true;
        }
        await db.delete(schema.customEventTypes).where(eq(schema.customEventTypes.id, row.id));
        json(res, 200, { ok: true });
        return true;
      }

      if (req.method === "GET" && pathname === "/rundowns") {
        if (!(await requireAdmin())) return true;
        json(
          res,
          200,
          await db.query.rundowns.findMany({
            columns: { id: true, eventId: true, name: true, description: true, showDate: true },
          }),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/rundowns") {
        const body = await readJson(req);
        const eventId = String(body.eventId ?? "");
        if (!(await requireEventAccess(eventId))) return true;
        const event = await db.query.events.findFirst({ where: eq(schema.events.id, eventId) });
        if (!event) {
          json(res, 404, { error: "event not found" });
          return true;
        }

        const id = ulid();
        const name = String(body.name ?? "New Rundown");
        const plannedStartSec = typeof body.plannedStartSec === "number" ? body.plannedStartSec : 9 * 3600;

        let doc: Y.Doc;
        if (typeof body.templateId === "string" && body.templateId) {
          const template = await db.query.templates.findFirst({ where: eq(schema.templates.id, body.templateId) });
          if (!template) {
            json(res, 404, { error: "template not found" });
            return true;
          }
          doc = decodeDoc(template.doc);
          doc.getMap("meta").set("name", name);
          doc.getMap("meta").set("plannedStartSec", plannedStartSec);
        } else {
          const rows = Array.isArray(body.rows) && body.rows.length > 0
            ? (body.rows as SeedRow[])
            : ([{ type: "cue", title: "New item", durationSec: 60 }] as SeedRow[]);
          const extraColumns = Array.isArray(body.columns)
            ? (body.columns as { key: string; title: string }[]).filter(
                (c) => typeof c?.key === "string" && typeof c?.title === "string",
              )
            : [];
          const importRoles = Array.isArray(body.roles)
            ? (body.roles as { name: string; color: string }[]).filter(
                (r) => typeof r?.name === "string" && typeof r?.color === "string",
              )
            : [];
          doc = buildRundownDoc(
            rows,
            {
              name,
              plannedStartSec,
              use24h: event.use24h,
              roleColumnKey: typeof body.roleColumnKey === "string" && body.roleColumnKey ? body.roleColumnKey : null,
              roleColumnKeys: roleColumnKeysOf(body),
              baseTitles: baseTitlesOf(body),
            },
            extraColumns,
            extraColumns.length > 0, // importer path: mirror the source sheet's columns exactly
            importRoles,
            columnOrderOf(body),
          );
        }

        const sourceFile = sourceFileValue(body.sourceFileB64);
        // The kind of show is the SHEET's, chosen on the import screen. It
        // falls back to the event's, which is the default for a day rather
        // than a description of every sheet on it.
        const sport =
          typeof body.sport === "string" && body.sport.trim()
            ? body.sport.trim().toLowerCase().slice(0, 40)
            : (event.sport ?? null);
        await db.insert(schema.rundowns).values({
          id,
          eventId,
          name,
          sport,
          description: body.description ? String(body.description) : null,
          showDate: body.showDate ? String(body.showDate) : null,
          plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
          sourceName: sourceFile && typeof body.sourceName === "string" ? body.sourceName.slice(0, 200) : null,
          sourceFile,
        });
        json(res, 201, { id });
        return true;
      }

      /**
       * The run sheets that have been imported, and what kind of show each was.
       *
       * The files were already being kept so Update import could re-read them;
       * this makes them a corpus. Import rules are the part of this app most
       * likely to be wrong for a sport nobody has tested it against, and the
       * honest way to fix that is to look at real sheets — the netball entries
       * in the built-in list were written from the rules of the game and one
       * of them was wrong until a real sheet was read.
       *
       * Scoped like everything else: a company sees only its own events'.
       */
      if (req.method === "GET" && pathname === "/imported-sheets") {
        const ctx = await authContext(handle, req);
        const isAdmin = ctx?.kind === "admin";
        const teamIds =
          ctx?.kind === "company"
            ? [ctx.teamId]
            : ctx?.kind === "user"
              ? ctx.grants.filter((g) => g.kind === "company").map((g) => g.targetId)
              : [];
        if (!isAdmin && teamIds.length === 0) {
          json(res, 401, { error: "company or admin access required" });
          return true;
        }
        const evs = await db.query.events.findMany({ columns: { id: true, name: true, teamId: true } });
        const mine = new Set(evs.filter((e) => isAdmin || teamIds.includes(e.teamId)).map((e) => e.id));
        const rows = await db.query.rundowns.findMany({
          columns: { id: true, eventId: true, name: true, sport: true, sourceName: true, sourceFile: true, createdAt: true },
        });
        json(res, 200, {
          sheets: rows
            .filter((r) => r.sourceFile && mine.has(r.eventId))
            .map((r) => ({
              rundownId: r.id,
              name: r.name,
              eventName: evs.find((e) => e.id === r.eventId)?.name ?? null,
              sport: r.sport,
              sourceName: r.sourceName,
              bytes: r.sourceFile?.length ?? 0,
              importedAt: r.createdAt.toISOString(),
            }))
            .sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
        });
        return true;
      }

      // The stored source sheet, for Update import to re-read with the current pipeline.
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/source$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const row = await db.query.rundowns.findFirst({
          where: eq(schema.rundowns.id, id),
          columns: { sourceName: true, sourceFile: true },
        });
        if (!row?.sourceFile) {
          json(res, 404, { error: "no stored source sheet — drop the file again (imports now store it)" });
          return true;
        }
        res.statusCode = 200;
        res.setHeader("content-type", "application/octet-stream");
        res.setHeader("x-source-name", encodeURIComponent(row.sourceName ?? "sheet"));
        res.end(Buffer.from(row.sourceFile));
        return true;
      }

      // Update import: re-imported content replaces the SAME rundown — id,
      // links, join codes, and view links all keep working. The old content
      // is snapshotted first, and the doc-epoch bump kicks every open screen
      // onto the fresh document (identical mechanism to in-place restore).
      if (req.method === "POST" && /^\/rundowns\/[^/]+\/replace-content$/.test(pathname)) {
        const id = pathname.split("/")[2]!;
        if (!(await requireRundownManage(id))) return true;
        const body = await readJson(req);
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, id) });
        if (!rundown) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const event = await db.query.events.findFirst({ where: eq(schema.events.id, rundown.eventId) });
        const rows = Array.isArray(body.rows) && body.rows.length > 0 ? (body.rows as SeedRow[]) : null;
        if (!rows) {
          json(res, 400, { error: "rows required" });
          return true;
        }
        const extraColumns = Array.isArray(body.columns)
          ? (body.columns as { key: string; title: string }[]).filter(
              (c) => typeof c?.key === "string" && typeof c?.title === "string",
            )
          : [];
        const importRoles = Array.isArray(body.roles)
          ? (body.roles as { name: string; color: string }[]).filter(
              (r) => typeof r?.name === "string" && typeof r?.color === "string",
            )
          : [];
        const plannedStartSec =
          typeof body.plannedStartSec === "number" ? body.plannedStartSec : rundown.plannedStartSec;
        if (rundown.doc)
          await db.insert(schema.rundownSnapshots).values({
            id: ulid(),
            rundownId: rundown.id,
            doc: rundown.doc,
            label: "Before update",
          });
        const doc = buildRundownDoc(
          rows,
          {
            name: rundown.name,
            plannedStartSec,
            use24h: event?.use24h ?? false,
            roleColumnKey: typeof body.roleColumnKey === "string" && body.roleColumnKey ? body.roleColumnKey : null,
            roleColumnKeys: roleColumnKeysOf(body),
            baseTitles: baseTitlesOf(body),
          },
          extraColumns,
          extraColumns.length > 0,
          importRoles,
          columnOrderOf(body),
        );
        const epoch = rundown.docEpoch + 1;
        const sourceFile = sourceFileValue(body.sourceFileB64);
        await db
          .update(schema.rundowns)
          .set({
            doc: encodeDoc(doc),
            docEpoch: epoch,
            plannedStartSec,
            docUpdatedAt: new Date(),
            updatedAt: new Date(),
            // A newly dropped sheet replaces the stored source; re-reads keep it.
            ...(sourceFile
              ? { sourceFile, sourceName: typeof body.sourceName === "string" ? body.sourceName.slice(0, 200) : rundown.sourceName }
              : {}),
          })
          .where(eq(schema.rundowns.id, id));
        try {
          for (const name of docServer?.documents.keys() ?? []) {
            if (name === id || String(name).startsWith(`${id}@`)) docServer!.closeConnections(String(name));
          }
        } catch (err) {
          logServerError(handle, "server", err, { url: "replace-content closeConnections" });
        }
        json(res, 200, { id, epoch });
        return true;
      }

      // Close the sheet to its audience, or open it again. Only the read-only
      // ways in are affected — crew codes, guest passes, accounts that can see
      // the event but not run it. Whoever calls or edits the show keeps their
      // way in, or nobody could ever undo this.
      if (req.method === "POST" && /^\/rundowns\/[^/]+\/viewing$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const body = await readJson(req);
        const closed = (body as { closed?: unknown }).closed !== false;
        await db
          .update(schema.rundowns)
          .set({ viewingClosedAt: closed ? new Date() : null, updatedAt: new Date() })
          .where(eq(schema.rundowns.id, rundownId));
        json(res, 200, { closed });
        return true;
      }

      if (req.method === "GET" && /^\/rundowns\/[^/]+\/join-codes$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const rows = await db.query.shareTokens.findMany({
          where: and(eq(schema.shareTokens.rundownId, rundownId), eq(schema.shareTokens.kind, "join")),
          columns: { id: true, joinCode: true, role: true, label: true, revokedAt: true, columnVisibility: true },
        });
        json(
          res,
          200,
          rows
            .filter((r) => !r.revokedAt)
            .map(({ revokedAt: _r, columnVisibility, ...rest }) => ({ ...rest, columns: columnVisibility })),
        );
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/join-codes$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const body = await readJson(req);
        const role = ["caller", "editor", "follower"].includes(String(body.role)) ? String(body.role) : "follower";
        const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : null;
        // Readable code: no confusable characters.
        const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
        const code = Array.from(
          { length: 6 },
          () => alphabet[Math.floor(Math.random() * alphabet.length)]!,
        ).join("");
        // Every code is view-only. Running or editing a show takes an account
        // with a password: a code is a thing that gets photographed off a wall
        // and forwarded out of a group chat, and neither of those should end
        // with a stranger holding the transport.
        if (role !== "follower") {
          json(res, 400, {
            error: "Codes are view-only. Running or editing a show needs an account.",
          });
          return true;
        }
        await db.insert(schema.shareTokens).values({
          id: ulid(),
          rundownId,
          kind: "join",
          token: ulid(),
          joinCode: code,
          role: "follower",
          label,
        });
        json(res, 201, { code, role: "follower", label });
        return true;
      }

      /**
       * "This is me, on this device."
       *
       * Sent once a viewer has given a name. One row per device per link,
       * updated on return rather than appended, so what a showcaller reads is
       * a list of people rather than a log of page loads.
       */
      if (req.method === "POST" && /^\/codes\/[^/]+\/viewer$/.test(pathname)) {
        const code = pathname.split("/")[2]!;
        const resolved = await resolveJoinCode(handle, code);
        if (!resolved) {
          json(res, 404, { error: "unknown code" });
          return true;
        }
        const body = await readJson(req);
        const str = (v: unknown, max: number): string | null => {
          const t = typeof v === "string" ? v.trim() : "";
          return t ? t.slice(0, max) : null;
        };
        const name = str(body.name, 60);
        const deviceId = str(body.deviceId, 64);
        if (!name || !deviceId) {
          json(res, 400, { error: "name and deviceId are required" });
          return true;
        }
        // Behind Railway's proxy the socket address is the proxy's; the first
        // entry of x-forwarded-for is the client. Trusting it is fine for a
        // record kept for the showcaller's own eyes — it is not a credential.
        const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim();
        const ip = forwarded || req.socket.remoteAddress || null;
        const existing = await db.query.shareViews.findFirst({
          where: and(eq(schema.shareViews.shareTokenId, resolved.tokenId), eq(schema.shareViews.deviceId, deviceId)),
        });
        // Roles are sent every time the viewer changes them, so a null here
        // means "not mentioned" and must not wipe what they already said.
        const roles = body.roles === undefined ? undefined : str(Array.isArray(body.roles) ? body.roles.join(", ") : body.roles, 120);
        if (existing) {
          await db
            .update(schema.shareViews)
            .set({
              name,
              ...(roles !== undefined ? { roles } : {}),
              browser: str(body.browser, 60),
              os: str(body.os, 40),
              screen: str(body.screen, 20),
              ip,
              lastSeenAt: new Date(),
            })
            .where(eq(schema.shareViews.id, existing.id));
        } else {
          await db.insert(schema.shareViews).values({
            id: ulid(),
            shareTokenId: resolved.tokenId,
            name,
            roles: roles ?? null,
            deviceId,
            browser: str(body.browser, 60),
            os: str(body.os, 40),
            screen: str(body.screen, 20),
            ip,
          });
        }
        json(res, 200, { ok: true, rundownId: resolved.rundownId });
        return true;
      }

      /** Who has this run sheet open on a view-only link — managers only. */
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/viewers$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const tokens = await db.query.shareTokens.findMany({ where: eq(schema.shareTokens.rundownId, rundownId) });
        const ids = tokens.map((t) => t.id);
        if (ids.length === 0) {
          json(res, 200, []);
          return true;
        }
        const views = await db.query.shareViews.findMany({ where: inArray(schema.shareViews.shareTokenId, ids) });
        const labelOf = new Map(tokens.map((t) => [t.id, t.label ?? null]));
        json(
          res,
          200,
          views
            .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
            .map((v) => ({
              id: v.id,
              name: v.name,
              roles: v.roles,
              link: labelOf.get(v.shareTokenId) ?? null,
              browser: v.browser,
              os: v.os,
              screen: v.screen,
              ip: v.ip,
              firstSeenAt: v.firstSeenAt.toISOString(),
              lastSeenAt: v.lastSeenAt.toISOString(),
            })),
        );
        return true;
      }

      /** Which columns a view-only link may show. */
      if (req.method === "PATCH" && /^\/rundowns\/[^/]+\/join-codes\/[^/]+$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        const codeId = pathname.split("/")[4]!;
        if (!(await requireEditor(rundownId))) return true;
        const body = await readJson(req);
        const columns = Array.isArray(body.columns) ? (body.columns as unknown[]).filter((k): k is string => typeof k === "string") : null;
        await db
          .update(schema.shareTokens)
          .set({ columnVisibility: columns ? Object.fromEntries(columns.map((k) => [k, true])) : null })
          .where(and(eq(schema.shareTokens.id, codeId), eq(schema.shareTokens.rundownId, rundownId)));
        json(res, 200, { ok: true });
        return true;
      }

      // Revoke a join code: it stops working everywhere immediately.
      if (req.method === "DELETE" && /^\/rundowns\/[^/]+\/join-codes\/[^/]+$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        const codeId = pathname.split("/")[4]!;
        if (!(await requireEditor(rundownId))) return true;
        await db
          .update(schema.shareTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(schema.shareTokens.id, codeId), eq(schema.shareTokens.rundownId, rundownId)));
        json(res, 200, { id: codeId });
        return true;
      }

      // As-run show report: sessions + transitions for a rundown (JSON or CSV).
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/report/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!.split("?")[0]!;
        if (!(await requireEditor(rundownId))) return true;
        const sessions = await db.query.showSessions.findMany({
          where: eq(schema.showSessions.rundownId, rundownId),
        });
        const report = [] as { session: string; startedAt: string; at: string; type: string; rowId: string | null }[];
        for (const session of sessions) {
          const transitions = await db.query.showTransitions.findMany({
            where: eq(schema.showTransitions.sessionId, session.id),
          });
          for (const t of transitions)
            report.push({
              session: session.id,
              startedAt: session.startedAt.toISOString(),
              at: t.at.toISOString(),
              type: t.type,
              rowId: t.rowId,
            });
        }
        report.sort((a, b) => a.at.localeCompare(b.at));
        if (url.searchParams.get("format") === "csv") {
          res.setHeader("content-type", "text/csv");
          res.end(
            serializeCsv([
              ["Session", "Session started", "At", "Action", "Row"],
              ...report.map((r) => [r.session, r.startedAt, r.at, r.type, r.rowId ?? ""]),
            ]),
          );
          return true;
        }
        json(res, 200, report);
        return true;
      }

      if (req.method === "POST" && pathname === "/guest-passes") {
        const body = await readJson(req);
        const rundownId = String(body.rundownId ?? "");
        if (!(await requireEditor(rundownId))) return true;
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId) });
        if (!rundown) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const token = ulid();
        await db.insert(schema.shareTokens).values({
          id: ulid(),
          rundownId,
          kind: "guest",
          token,
          role: "guest",
          columnVisibility: (body.columns as Record<string, boolean> | undefined) ?? null,
        });
        json(res, 201, { token });
        return true;
      }

      // Guests get a server-filtered plain-JSON projection — never the CRDT.
      if (req.method === "GET" && pathname.startsWith("/guest/")) {
        const token = pathname.slice("/guest/".length);
        const pass = await db.query.shareTokens.findFirst({ where: eq(schema.shareTokens.token, token) });
        if (!pass || pass.kind !== "guest" || pass.revokedAt) {
          json(res, 404, { error: "invalid or revoked guest pass" });
          return true;
        }
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, pass.rundownId) });
        if (!rundown?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        // Closed by the showcaller once the event was done. A pass that WAS
        // valid is a different story from one that never was, and the page
        // showing this has to be able to say which.
        if (rundown.viewingClosedAt) {
          json(res, 403, { error: "This run sheet is closed", closed: true });
          return true;
        }
        const { meta, keyTimes, columns, rows } = projectRundownDoc(decodeDoc(rundown.doc));
        const visibility = pass.columnVisibility ?? {};
        const visibleColumns = columns.filter(
          (c) => c.kind !== "richtext" || visibility[c.key] !== false,
        );
        const visibleKeys = new Set(visibleColumns.map((c) => c.key));
        json(res, 200, {
          meta: {
            name: meta.name,
            use24h: meta.use24h,
            plannedStartSec: meta.plannedStartSec,
            versionLabel: meta.versionLabel || null,
            timezone: (await (async () => {
              const ev = await db.query.events.findFirst({
                where: eq(schema.events.id, rundown.eventId),
                columns: { timezone: true },
              });
              return ev?.timezone ?? null;
            })()),
          },
          keyTimes,
          lastUpdated: rundown.docUpdatedAt?.toISOString() ?? null,
          columns: visibleColumns,
          rows: rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            // durationHidden means exactly this: hidden on shared views.
            durationSec: r.durationHidden ? null : r.durationSec,
            hardStartSec: r.hardStartSec,
            backtime: r.backtime ?? false,
            durationMuted: r.durationMuted ?? false,
            color: r.color ?? null,
            cells: Object.fromEntries(Object.entries(r.cells).filter(([key]) => visibleKeys.has(key))),
          })),
        });
        return true;
      }

      if (req.method === "GET" && /^\/rundowns\/[^/]+\/snapshots$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        json(
          res,
          200,
          await db.query.rundownSnapshots.findMany({
            where: eq(schema.rundownSnapshots.rundownId, rundownId),
            columns: { id: true, label: true, createdAt: true },
          }),
        );
        return true;
      }

      if (req.method === "POST" && /^\/rundowns\/[^/]+\/snapshots$/.test(pathname)) {
        const rundownId = pathname.split("/")[2]!;
        if (!(await requireEditor(rundownId))) return true;
        const body = await readJson(req);
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId) });
        if (!rundown?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const id = ulid();
        await db.insert(schema.rundownSnapshots).values({
          id,
          rundownId,
          doc: rundown.doc,
          label: body.label ? String(body.label) : null,
        });
        json(res, 201, { id });
        return true;
      }

      // The rundown's current doc epoch — clients scope their doc connection
      // to it (`<id>@<epoch>`); public, it's just a counter.
      if (req.method === "GET" && /^\/rundowns\/[^/]+\/epoch$/.test(pathname)) {
        const row = await db.query.rundowns.findFirst({
          where: eq(schema.rundowns.id, pathname.split("/")[2]!),
          columns: { docEpoch: true, viewingClosedAt: true },
        });
        if (!row) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        // Every screen asks for the epoch before it opens a connection, so the
        // answer carries whether the sheet is still open to its audience —
        // saving a second round-trip on the one request nobody can skip.
        json(res, 200, { epoch: row.docEpoch, viewingClosed: row.viewingClosedAt != null });
        return true;
      }

      // In-place restore: replace the SAME rundown's doc with the snapshot.
      // Bumping the doc epoch invalidates every live connection, so no client
      // can merge pre-restore CRDT state back; they reconnect fresh.
      if (req.method === "POST" && /^\/snapshots\/[^/]+\/restore-in-place$/.test(pathname)) {
        const snapshotId = pathname.split("/")[2]!;
        const snapshot = await db.query.rundownSnapshots.findFirst({
          where: eq(schema.rundownSnapshots.id, snapshotId),
        });
        if (!snapshot) {
          json(res, 404, { error: "snapshot not found" });
          return true;
        }
        if (!(await requireEditor(snapshot.rundownId))) return true;
        const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, snapshot.rundownId) });
        if (!rundown) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        // Safety net: snapshot the pre-restore state first, so a restore is
        // itself reversible.
        if (rundown.doc)
          await db.insert(schema.rundownSnapshots).values({
            id: ulid(),
            rundownId: rundown.id,
            doc: rundown.doc,
            label: "Before restore",
          });
        const epoch = rundown.docEpoch + 1;
        await db
          .update(schema.rundowns)
          .set({ doc: snapshot.doc, docEpoch: epoch, docUpdatedAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.rundowns.id, rundown.id));
        // Kick live connections on the old epoch (and legacy bare-id docs).
        try {
          for (const name of docServer?.documents.keys() ?? []) {
            if (name === rundown.id || String(name).startsWith(`${rundown.id}@`)) docServer!.closeConnections(String(name));
          }
        } catch (err) {
          logServerError(handle, "server", err, { url: "restore-in-place closeConnections" });
        }
        json(res, 200, { id: rundown.id, epoch });
        return true;
      }

      // Restore-as-copy: the snapshot becomes a NEW rundown alongside the
      // original (useful for comparing versions side by side).
      if (req.method === "POST" && /^\/snapshots\/[^/]+\/restore$/.test(pathname)) {
        const snapshotId = pathname.split("/")[2]!;
        const body = await readJson(req);
        const snapshot = await db.query.rundownSnapshots.findFirst({
          where: eq(schema.rundownSnapshots.id, snapshotId),
        });
        if (!snapshot) {
          json(res, 404, { error: "snapshot not found" });
          return true;
        }
        if (!(await requireEditor(snapshot.rundownId))) return true;
        const source = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, snapshot.rundownId) });
        if (!source) {
          json(res, 404, { error: "source rundown not found" });
          return true;
        }
        const id = ulid();
        const name = String(body.name ?? `${source.name} (restored)`);
        const doc = decodeDoc(snapshot.doc);
        doc.getMap("meta").set("name", name);
        await db.insert(schema.rundowns).values({
          id,
          eventId: source.eventId,
          name,
          description: source.description,
          showDate: source.showDate,
          plannedStartSec: source.plannedStartSec,
          doc: encodeDoc(doc),
          docUpdatedAt: new Date(),
        });
        json(res, 201, { id });
        return true;
      }

      if (req.method === "GET" && pathname === "/templates") {
        const ctx = await authContext(handle, req);
        if (ctx?.kind !== "admin" && ctx?.kind !== "company") {
          json(res, 401, { error: "admin or company token required" });
          return true;
        }
        const all = await db.query.templates.findMany({
          columns: { id: true, name: true, description: true, teamId: true },
        });
        json(
          res,
          200,
          all
            .filter((t) => ctx.kind === "admin" || t.teamId === ctx.teamId)
            .map(({ teamId: _t, ...rest }) => rest),
        );
        return true;
      }

      if (req.method === "POST" && pathname === "/templates") {
        const body = await readJson(req);
        if (!(await requireEditor(String(body.rundownId ?? "")))) return true;
        const rundown = await db.query.rundowns.findFirst({
          where: eq(schema.rundowns.id, String(body.rundownId ?? "")),
        });
        if (!rundown?.doc) {
          json(res, 404, { error: "rundown not found" });
          return true;
        }
        const id = ulid();
        await db.insert(schema.templates).values({
          id,
          teamId: await defaultTeamId(),
          name: String(body.name ?? `${rundown.name} (template)`),
          description: body.description ? String(body.description) : null,
          doc: rundown.doc,
        });
        json(res, 201, { id });
        return true;
      }
    } catch (err) {
      logServerError(handle, "server", err, { url: `${req.method} ${pathname}` });
      json(res, 500, { error: String(err) });
      return true;
    }
    return false;
  };
}
