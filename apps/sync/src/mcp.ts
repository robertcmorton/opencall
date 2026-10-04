import type { IncomingMessage, ServerResponse } from "node:http";
import type { Hocuspocus } from "@hocuspocus/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { ulid } from "ulid";
import * as Y from "yjs";
import { z } from "zod";
import { lockIsFree, parseDurationShorthand, parseTimeOfDay } from "@opencall/core";
import {
  addRow,
  decodeDoc,
  deleteRow,
  moveRow,
  readSheet,
  schema,
  setCellText,
  setDuration,
  setStartTime,
  SheetOpError,
  strikeRow,
  type DbHandle,
} from "@opencall/db";
import { canEditEvent, canSeeEvent, contextForAccount, type AuthCtx } from "./auth.ts";
import { audit } from "./audit.ts";
import { clientIp, ipBucket } from "./clientIp.ts";
import { consume } from "./throttle.ts";
import {
  authorizationServerMetadata,
  exchangeToken,
  OAuthError,
  parseForm,
  protectedResourceMetadata,
  registerClient,
  revokeToken,
  syncBase,
  verifyAccessToken,
  wwwAuthenticate,
  type McpCaller,
} from "./oauth.ts";

/**
 * The AI-assistant connection (Model Context Protocol): a person connects an
 * assistant to their own account, and it can then read — and, if they allow
 * it, change — exactly the sheets that account can, never more.
 *
 * - Access is the account's own: read where it can see the event, write where
 *   it can edit it. Crew accounts read only; there is no way in without one.
 * - It can never run the show: there is no tool for start, next or stop.
 * - While a show is live, only text and strikes may change — nothing is
 *   added, moved, deleted or re-timed under the person calling it.
 * - A sheet somebody else is editing (the edit lock) is not changed.
 * - Before an assistant's first change to a sheet in any hour, a snapshot is
 *   taken, so its work can be undone from Versions.
 */

export const MCP_BODY_MAX = 64 * 1024;
export const MCP_BATCH_MAX = 10;
export const MCP_LIMITS = {
  perMinute: 60,
  perDay: 2000,
  writesPerMinute: 30,
  anonymousPerMinute: 30,
} as const;

/** What the show is doing, from the server's live state. */
export type LiveState = (rundownId: string) => Promise<{ state: string; activeRowId: string | null }>;

const WRITE_TOOLS = new Set(["update_cells", "set_duration", "set_start_time", "add_rows", "move_row", "strike_row", "delete_rows"]);
/** May still change while the show is live: nothing moves under the caller. */
const LIVE_SAFE = new Set(["update_cells", "strike_row"]);

const INSTRUCTIONS = `OpenCall holds run sheets for live events: rows in running order, each with a start time, a duration and text columns.

Start with list_sheets, then get_sheet to see the rows. Rows are named by their id (from get_sheet); columns by their title. Times you give are wall-clock ("7:30 PM", "19:30") and durations "2:30", "90s" or "1m30s".

Changing a duration or a fixed start time moves the fixed times below it, as it does in the app. A struck row stays visible but gives its time back.

You cannot start, step or stop a show. While a show is live only text and strikes can change. A sheet someone is editing cannot be changed until they close it. Before your first change to a sheet in an hour a snapshot is taken; it can be restored from Versions in the app.`;

const respond = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

async function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  if (Number(req.headers["content-length"] ?? 0) > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return null;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

class ToolRefusal extends Error {}

export function createMcpRoutes(handle: DbHandle, docServer: Hocuspocus, liveState: LiveState, version: string) {
  const { db } = handle;

  // ── Sheets the account can reach ───────────────────────────────────────────

  /** Every event this account can see, with whether it may write there. */
  async function reachableEvents(ctx: AuthCtx) {
    let events: (typeof schema.events.$inferSelect)[];
    if (ctx?.kind === "admin") events = await db.query.events.findMany({ where: isNull(schema.events.archivedAt) });
    else if (ctx?.kind === "user") {
      const teamIds = ctx.grants.filter((g) => g.kind === "company" || g.kind === "company_view").map((g) => g.targetId);
      const eventIds = ctx.grants.filter((g) => g.kind === "event" || g.kind === "edit" || g.kind === "view").map((g) => g.targetId);
      if (teamIds.length === 0 && eventIds.length === 0) return [];
      const reach = [];
      if (teamIds.length) reach.push(inArray(schema.events.teamId, teamIds));
      if (eventIds.length) reach.push(inArray(schema.events.id, eventIds));
      events = await db.query.events.findMany({ where: and(isNull(schema.events.archivedAt), or(...reach)) });
    } else return [];
    const out = [];
    for (const e of events) out.push({ event: e, canEdit: await canEditEvent(handle, ctx, e.id) });
    return out;
  }

  /** One sheet, if this account may read it (and, when asked, write it). */
  async function sheetFor(ctx: AuthCtx, rundownId: string, write: boolean) {
    const rundown = await db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId) });
    const event = rundown ? await db.query.events.findFirst({ where: eq(schema.events.id, rundown.eventId) }) : null;
    // Not found and not allowed read the same, so ids cannot be probed.
    const missing = `No sheet with id "${rundownId}" that this account can ${write ? "edit" : "open"}. Use list_sheets to see them.`;
    if (!rundown || !event || rundown.archivedAt) throw new ToolRefusal(missing);
    if (!(await canSeeEvent(handle, ctx, event.id, event.teamId))) throw new ToolRefusal(missing);
    const canEdit = await canEditEvent(handle, ctx, event.id);
    // A sheet closed to viewers is closed to read-only accounts here too.
    if (!canEdit && rundown.viewingClosedAt) throw new ToolRefusal("This sheet has been closed to viewers since the event ended.");
    if (write && !canEdit) throw new ToolRefusal("This account can read this sheet but not change it. Ask whoever runs the event for edit access.");
    return { rundown, event, canEdit };
  }

  const docName = (r: { id: string; docEpoch: number }) => `${r.id}@${r.docEpoch}`;

  /** The sheet as it is right now: the open document if anyone has it, else the stored one. */
  function currentDoc(r: { id: string; docEpoch: number; doc: Uint8Array | null }): Y.Doc | null {
    const live = docServer.documents.get(docName(r)) as Y.Doc | undefined;
    if (live) return live;
    return r.doc ? decodeDoc(r.doc) : null;
  }

  // ── One MCP server per request (stateless) ─────────────────────────────────

  function buildServer(caller: McpCaller, ctx: AuthCtx, ip: string) {
    const server = new McpServer({ name: "opencall", title: "OpenCall", version }, { instructions: INSTRUCTIONS });
    const mayWrite = caller.scopes.includes("sheets:write");

    const ok = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] });
    const fail = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
    const guarded =
      <A,>(fn: (args: A) => Promise<ReturnType<typeof ok>>) =>
      async (args: A) => {
        try {
          return await fn(args);
        } catch (err) {
          if (err instanceof ToolRefusal || err instanceof SheetOpError) return fail(err.message);
          throw err;
        }
      };

    /**
     * Every change goes through here: checks, a snapshot when one is due, a
     * dry run on a copy (Yjs cannot roll a half-done change back), then the
     * real change on the live document so every open screen gets it at once.
     */
    async function change<T>(tool: string, rundownId: string, apply: (doc: Y.Doc, liveRowId: string | null) => T, summary: Record<string, unknown>): Promise<T> {
      const writes = await consume(handle, `mcp:write:${caller.userId}`, { max: MCP_LIMITS.writesPerMinute, windowSec: 60 });
      if (!writes.ok) throw new ToolRefusal(`Too many changes in a minute. Wait ${writes.retryAfterSec} seconds and try again.`);
      const { rundown } = await sheetFor(ctx, rundownId, true);
      const live = await liveState(rundownId);
      const isLive = live.state === "running" || live.state === "paused";
      if (isLive && !LIVE_SAFE.has(tool)) {
        throw new ToolRefusal("The show on this sheet is live. While it is, only text can be edited and rows struck — nothing added, moved, deleted or re-timed.");
      }
      const lock = {
        heldBy: rundown.editLockBy,
        heldByUserId: rundown.editLockUserId,
        sinceMs: rundown.editLockSince?.getTime() ?? null,
        lastSeenMs: rundown.editLockAt?.getTime() ?? null,
      };
      if (!lockIsFree(lock, Date.now()) && rundown.editLockHolderKey !== `user:${caller.userId}` && ctx?.kind !== "admin") {
        throw new ToolRefusal(`${rundown.editLockBy ?? "Someone"} is editing this sheet right now. Try again once they have closed it.`);
      }
      const current = currentDoc(rundown);
      if (!current) throw new ToolRefusal("This sheet has no content yet.");
      const liveRowId = isLive ? live.activeRowId : null;

      const probe = new Y.Doc();
      Y.applyUpdate(probe, Y.encodeStateAsUpdate(current));
      apply(probe, liveRowId);

      const snap = await consume(handle, `mcp:snap:${caller.grantId}:${rundownId}`, { max: 1, windowSec: 3600 });
      if (snap.ok) {
        await db.insert(schema.rundownSnapshots).values({
          id: ulid(),
          rundownId,
          doc: Y.encodeStateAsUpdate(current),
          label: `Before changes by ${caller.clientName}`.slice(0, 120),
          createdBy: caller.userId,
        });
      }

      const conn = await docServer.openDirectConnection(docName(rundown), { mcp: caller.grantId });
      let result!: T;
      try {
        await conn.transact((doc) => {
          result = apply(doc, liveRowId);
        });
      } finally {
        await conn.disconnect();
      }
      audit(handle, { actor: caller.userId, action: `mcp.${tool}`, target: rundownId, ip, detail: { assistant: caller.clientName, ...summary } });
      return result;
    }

    const sheetId = z.string().min(1).max(64).describe("The sheet's id, from list_sheets.");
    const rowId = z.string().min(1).max(64).describe("A row's id, from get_sheet.");
    const afterRow = z.string().min(1).max(64).nullable().describe("The id of the row to put it after, or null for the very top.");

    server.registerTool(
      "list_sheets",
      {
        title: "List run sheets",
        description: "Every run sheet this account can open, grouped by event, with whether it can be changed and whether its show is live.",
        inputSchema: {},
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      guarded(async () => {
        const reachable = await reachableEvents(ctx);
        if (reachable.length === 0) return ok("This account cannot open any sheets.");
        const ids = reachable.map((r) => r.event.id);
        const rundowns = await db.query.rundowns.findMany({ where: and(inArray(schema.rundowns.eventId, ids), isNull(schema.rundowns.archivedAt)) });
        const teams = await db.query.teams.findMany({ where: inArray(schema.teams.id, [...new Set(reachable.map((r) => r.event.teamId))]) });
        const events = [];
        for (const { event, canEdit } of reachable) {
          const sheets = [];
          for (const r of rundowns.filter((x) => x.eventId === event.id)) {
            if (!canEdit && r.viewingClosedAt) continue;
            const s = (await liveState(r.id)).state;
            sheets.push({ id: r.id, name: r.name, date: r.showDate, live: s === "running" || s === "paused" || undefined });
          }
          events.push({
            event: event.name,
            company: teams.find((t) => t.id === event.teamId)?.name,
            dates: event.startDate === event.endDate ? event.startDate : `${event.startDate} to ${event.endDate}`,
            access: canEdit && mayWrite ? "can change" : "read only",
            sheets,
          });
        }
        return ok({ events });
      }),
    );

    server.registerTool(
      "get_sheet",
      {
        title: "Read a run sheet",
        description:
          "One run sheet in full: its columns, then every row in running order with its id, start time, duration and the text of each column. The row on air is marked when the show is live.",
        inputSchema: { sheet_id: sheetId },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id }: { sheet_id: string }) => {
        const { rundown, event, canEdit } = await sheetFor(ctx, sheet_id, false);
        const doc = currentDoc(rundown);
        if (!doc) return ok({ name: rundown.name, rows: [] });
        const live = await liveState(sheet_id);
        const isLive = live.state === "running" || live.state === "paused";
        const sheet = readSheet(doc, { activeRowId: isLive ? live.activeRowId : null });
        return ok({
          event: event.name,
          ...sheet,
          show: isLive ? live.state : "not live",
          youCan: canEdit && mayWrite ? (isLive ? "edit text and strike rows (the show is live)" : "change this sheet") : "read only",
          editing: !lockIsFree(
            { heldBy: rundown.editLockBy, heldByUserId: rundown.editLockUserId, sinceMs: null, lastSeenMs: rundown.editLockAt?.getTime() ?? null },
            Date.now(),
          )
            ? rundown.editLockBy
            : undefined,
        });
      }),
    );

    if (!mayWrite) return server;

    server.registerTool(
      "update_cells",
      {
        title: "Edit text",
        description: "Sets the text of one or more cells. Each change names a row (by id) and a column (by title, e.g. \"Title\", \"Notes\"). The text replaces what is there; new lines become separate lines.",
        inputSchema: {
          sheet_id: sheetId,
          changes: z
            .array(z.object({ row_id: rowId, column: z.string().min(1).max(100), text: z.string().max(5000) }))
            .min(1)
            .max(100),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id, changes }: { sheet_id: string; changes: { row_id: string; column: string; text: string }[] }) => {
        await change("update_cells", sheet_id, (doc) => {
          for (const c of changes) setCellText(doc, c.row_id, c.column, c.text);
        }, { cells: changes.length });
        return ok(`Changed ${changes.length} cell${changes.length === 1 ? "" : "s"}.`);
      }),
    );

    server.registerTool(
      "set_duration",
      {
        title: "Set a duration",
        description: "Sets how long a row runs (\"2:30\", \"90s\", \"1m30s\"), or clears it with null. Fixed start times below move by the difference, as in the app.",
        inputSchema: { sheet_id: sheetId, row_id: rowId, duration: z.string().max(20).nullable() },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id, row_id, duration }: { sheet_id: string; row_id: string; duration: string | null }) => {
        const sec = duration == null ? null : parseDurationShorthand(duration);
        if (duration != null && (sec == null || sec > 24 * 3600)) return fail(`"${duration}" is not a duration. Use e.g. "2:30", "90s" or "1m30s".`);
        await change("set_duration", sheet_id, (doc) => setDuration(doc, row_id, sec), { row: row_id, sec });
        return ok("Duration set.");
      }),
    );

    server.registerTool(
      "set_start_time",
      {
        title: "Set a fixed start time",
        description: "Fixes the time a row starts (\"7:30 PM\", \"19:30\"), or clears it with null so it follows the row before. Later fixed times move with it when the app would move them.",
        inputSchema: { sheet_id: sheetId, row_id: rowId, start_time: z.string().max(20).nullable() },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id, row_id, start_time }: { sheet_id: string; row_id: string; start_time: string | null }) => {
        const sec = start_time == null ? null : parseTimeOfDay(start_time);
        if (start_time != null && sec == null) return fail(`"${start_time}" is not a time of day. Use e.g. "7:30 PM" or "19:30".`);
        await change("set_start_time", sheet_id, (doc) => setStartTime(doc, row_id, sec), { row: row_id, sec });
        return ok(start_time == null ? "Start time cleared." : "Start time set.");
      }),
    );

    server.registerTool(
      "add_rows",
      {
        title: "Add rows",
        description:
          "Adds rows, in the order given, after a row (or at the top). type is \"cue\" (an item, a minute long unless a duration is given), \"group\" (a heading) or \"milestone\" (a fixed moment). cells sets other columns by title.",
        inputSchema: {
          sheet_id: sheetId,
          after_row_id: afterRow,
          rows: z
            .array(
              z.object({
                type: z.enum(["cue", "group", "milestone"]).optional(),
                title: z.string().max(500),
                duration: z.string().max(20).optional(),
                cells: z.record(z.string().max(100), z.string().max(5000)).optional(),
              }),
            )
            .min(1)
            .max(50),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      guarded(
        async ({
          sheet_id,
          after_row_id,
          rows,
        }: {
          sheet_id: string;
          after_row_id: string | null;
          rows: { type?: "cue" | "group" | "milestone"; title: string; duration?: string; cells?: Record<string, string> }[];
        }) => {
          const specs = rows.map((r) => {
            const sec = r.duration ? parseDurationShorthand(r.duration) : undefined;
            if (r.duration && (sec == null || sec > 24 * 3600)) throw new ToolRefusal(`"${r.duration}" is not a duration.`);
            return { type: r.type, title: r.title, durationSec: sec, cells: r.cells };
          });
          const ids = await change(
            "add_rows",
            sheet_id,
            (doc) => {
              let after = after_row_id;
              return specs.map((s) => (after = addRow(doc, after, s)));
            },
            { rows: specs.length },
          );
          return ok({ added: ids });
        },
      ),
    );

    server.registerTool(
      "move_row",
      {
        title: "Move a row",
        description: "Moves a row to just after another (or to the top). Times re-flow exactly as dragging it in the app does.",
        inputSchema: { sheet_id: sheetId, row_id: rowId, after_row_id: afterRow },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id, row_id, after_row_id }: { sheet_id: string; row_id: string; after_row_id: string | null }) => {
        await change("move_row", sheet_id, (doc, liveRowId) => moveRow(doc, row_id, after_row_id, liveRowId), { row: row_id, after: after_row_id });
        return ok("Row moved.");
      }),
    );

    server.registerTool(
      "strike_row",
      {
        title: "Strike a row",
        description: "Strikes a row out (struck: true) or puts it back (false). A struck row stays on the sheet, crossed out, and its time is given back to the rows below.",
        inputSchema: { sheet_id: sheetId, row_id: rowId, struck: z.boolean() },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id, row_id, struck }: { sheet_id: string; row_id: string; struck: boolean }) => {
        await change("strike_row", sheet_id, (doc, liveRowId) => strikeRow(doc, row_id, struck, liveRowId), { row: row_id, struck });
        return ok(struck ? "Row struck." : "Row put back.");
      }),
    );

    server.registerTool(
      "delete_rows",
      {
        title: "Delete rows",
        description: "Removes rows from the sheet. Prefer strike_row when a row may come back. A snapshot taken before the change can restore them from Versions in the app.",
        inputSchema: { sheet_id: sheetId, row_ids: z.array(rowId).min(1).max(50) },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      },
      guarded(async ({ sheet_id, row_ids }: { sheet_id: string; row_ids: string[] }) => {
        await change("delete_rows", sheet_id, (doc) => {
          for (const id of row_ids) deleteRow(doc, id);
        }, { rows: row_ids.length });
        return ok(`Deleted ${row_ids.length} row${row_ids.length === 1 ? "" : "s"}.`);
      }),
    );

    return server;
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  /**
   * The routes an assistant reaches: discovery, sign-in and the MCP endpoint.
   * Open to any origin — they carry no cookies, only tokens issued for them.
   * Returns false for any other path.
   */
  return async function handleMcpRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    const isOurs =
      path === "/mcp" ||
      path.startsWith("/.well-known/oauth-") ||
      path === "/oauth/register" ||
      path === "/oauth/token" ||
      path === "/oauth/revoke";
    if (!isOurs) return false;

    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type,authorization,mcp-protocol-version,mcp-session-id,last-event-id");
    res.setHeader("access-control-expose-headers", "www-authenticate,mcp-session-id");
    res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("cache-control", "no-store");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return true;
    }

    const base = syncBase(req);
    const ip = clientIp(req);
    const ipKey = ipBucket(ip);

    if (path.startsWith("/.well-known/oauth-protected-resource") && req.method === "GET") {
      respond(res, 200, protectedResourceMetadata(base));
      return true;
    }
    if (path.startsWith("/.well-known/oauth-authorization-server") && req.method === "GET") {
      respond(res, 200, authorizationServerMetadata(base));
      return true;
    }

    const oauthError = (err: unknown) => {
      if (err instanceof OAuthError) {
        respond(res, err.status, { error: err.code, error_description: err.description });
        return true;
      }
      throw err;
    };

    if (path === "/oauth/register" && req.method === "POST") {
      const t = await consume(handle, `mcp:register:${ipKey}`, { max: 20, windowSec: 3600 });
      if (!t.ok) return respond(res, 429, { error: "too_many_requests", error_description: "Too many registrations." }, { "retry-after": String(t.retryAfterSec) }), true;
      const raw = await readBody(req, 16 * 1024);
      if (raw == null) return respond(res, 413, { error: "invalid_client_metadata", error_description: "Too large." }), true;
      try {
        const body = JSON.parse(raw || "{}") as Record<string, unknown>;
        respond(res, 201, await registerClient(handle, body));
      } catch (err) {
        if (err instanceof SyntaxError) respond(res, 400, { error: "invalid_client_metadata", error_description: "The body is not JSON." });
        else oauthError(err);
      }
      return true;
    }

    if ((path === "/oauth/token" || path === "/oauth/revoke") && req.method === "POST") {
      const t = await consume(handle, `mcp:token:${ipKey}`, { max: 60, windowSec: 60 });
      if (!t.ok) return respond(res, 429, { error: "slow_down", error_description: "Too many requests." }, { "retry-after": String(t.retryAfterSec) }), true;
      const raw = await readBody(req, 16 * 1024);
      if (raw == null) return respond(res, 413, { error: "invalid_request", error_description: "Too large." }), true;
      let form: Record<string, string>;
      try {
        form = parseForm(raw, req.headers["content-type"]);
      } catch {
        return respond(res, 400, { error: "invalid_request", error_description: "Unreadable body." }), true;
      }
      try {
        if (path === "/oauth/token") {
          respond(res, 200, await exchangeToken(handle, req, base, form, async (userId) => (await contextForAccount(handle, userId)) != null));
        } else {
          const ended = await revokeToken(handle, req, form);
          if (ended) audit(handle, { actor: ended.userId ?? null, action: "mcp.disconnected", target: ended.grantId ?? null, ip, detail: { assistant: ended.clientName, by: "assistant" } });
          res.statusCode = 200;
          res.end();
        }
      } catch (err) {
        oauthError(err);
      }
      return true;
    }

    // ── /mcp ──
    if (req.method !== "POST") {
      respond(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: this server answers POST only." }, id: null }, { allow: "POST, OPTIONS" });
      return true;
    }
    const challenge = (status: number, error?: { code: string; description: string }, scope?: string) =>
      respond(res, status, { error: error?.code ?? "unauthorized", error_description: error?.description ?? "Connect this assistant to OpenCall first." }, {
        "www-authenticate": wwwAuthenticate(base, error, scope),
      });

    const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1]?.trim();
    if (!token) {
      const t = await consume(handle, `mcp:anon:${ipKey}`, { max: MCP_LIMITS.anonymousPerMinute, windowSec: 60 });
      if (!t.ok) return respond(res, 429, { error: "too_many_requests" }, { "retry-after": String(t.retryAfterSec) }), true;
      challenge(401);
      return true;
    }
    const caller = await verifyAccessToken(handle, token);
    if ("error" in caller) {
      const t = await consume(handle, `mcp:anon:${ipKey}`, { max: MCP_LIMITS.anonymousPerMinute, windowSec: 60 });
      if (!t.ok) return respond(res, 429, { error: "too_many_requests" }, { "retry-after": String(t.retryAfterSec) }), true;
      challenge(401, { code: "invalid_token", description: caller.error });
      return true;
    }
    const ctx = await contextForAccount(handle, caller.userId);
    if (!ctx) {
      challenge(401, { code: "invalid_token", description: "The account behind this connection no longer exists." });
      return true;
    }
    for (const [key, max, windowSec] of [
      [`mcp:min:${caller.userId}`, MCP_LIMITS.perMinute, 60],
      [`mcp:day:${caller.userId}`, MCP_LIMITS.perDay, 86400],
    ] as const) {
      const t = await consume(handle, key, { max, windowSec });
      if (!t.ok) {
        respond(res, 429, { jsonrpc: "2.0", error: { code: -32000, message: `Too many requests. Try again in ${t.retryAfterSec} seconds.` }, id: null }, { "retry-after": String(t.retryAfterSec) });
        return true;
      }
    }

    const raw = await readBody(req, MCP_BODY_MAX);
    if (raw == null) {
      respond(res, 413, { jsonrpc: "2.0", error: { code: -32600, message: "Request too large." }, id: null });
      return true;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      respond(res, 400, { jsonrpc: "2.0", error: { code: -32700, message: "Parse error." }, id: null });
      return true;
    }
    const messages = Array.isArray(body) ? body : [body];
    if (messages.length > MCP_BATCH_MAX) {
      respond(res, 400, { jsonrpc: "2.0", error: { code: -32600, message: `At most ${MCP_BATCH_MAX} messages per request.` }, id: null });
      return true;
    }
    // A change asked for on a read-only connection: say which permission is missing.
    const wantsWrite = messages.some(
      (m) => m && typeof m === "object" && (m as { method?: string }).method === "tools/call" && WRITE_TOOLS.has(String((m as { params?: { name?: unknown } }).params?.name)),
    );
    if (wantsWrite && !caller.scopes.includes("sheets:write")) {
      challenge(403, { code: "insufficient_scope", description: "This connection may only read sheets. Reconnect and allow changes." }, "sheets:read sheets:write");
      return true;
    }

    const server = buildServer(caller, ctx, ip);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
    return true;
  };
}
