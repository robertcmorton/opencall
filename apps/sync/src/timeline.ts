import { and, desc, eq, gte, inArray, lte, sql, type SQL } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";
import { AUDIT_WORDS, connectWords, describeDevice, disconnectWords, pageWords, showWords } from "@opencall/core";
import { placeOf } from "./place.ts";

/**
 * One person's — or one sheet's, or one device's — story, in order (24 Oct
 * 2026): pages opened, show screens joining and dropping, show actions,
 * sign-ins, edits and errors, read from the five places they are kept and
 * merged by time. For spotting what doesn't belong and for retracing the
 * steps to a fault.
 */
export interface TimelineEntry {
  at: string;
  source: "activity" | "account" | "show" | "edit" | "error";
  kind: string;
  /** What happened, in words. */
  what: string;
  who: string | null;
  userId: string | null;
  device: string | null;
  deviceId: string | null;
  ip: string | null;
  place: string | null;
  rundownId: string | null;
  sheet: string | null;
  detail?: Record<string, unknown>;
}

export interface TimelineFilter {
  userId?: string;
  /** "admin" for the server's admin code. */
  actor?: string;
  deviceId?: string;
  rundownId?: string;
  ip?: string;
  from?: Date;
  to?: Date;
  sources?: ReadonlySet<TimelineEntry["source"]>;
  limit?: number;
}

const want = (f: TimelineFilter, s: TimelineEntry["source"]) => !f.sources || f.sources.has(s);

export async function readTimeline(handle: DbHandle, f: TimelineFilter): Promise<TimelineEntry[]> {
  const { db } = handle;
  const limit = Math.min(Math.max(f.limit ?? 300, 1), 2000);
  const out: TimelineEntry[] = [];
  const range = (col: Parameters<typeof gte>[0]) => [f.from ? gte(col, f.from) : undefined, f.to ? lte(col, f.to) : undefined];
  const all = (...xs: (SQL | undefined)[]) => and(...xs.filter((x): x is SQL => x != null));

  if (want(f, "activity")) {
    const a = schema.activity;
    const rows = await db
      .select()
      .from(a)
      .where(
        all(
          f.userId ? eq(a.userId, f.userId) : undefined,
          f.actor === "admin" ? eq(a.who, "Administrator (server code)") : undefined,
          f.deviceId ? eq(a.deviceId, f.deviceId) : undefined,
          f.rundownId ? eq(a.rundownId, f.rundownId) : undefined,
          f.ip ? eq(a.ip, f.ip) : undefined,
          ...range(a.at),
        ),
      )
      .orderBy(desc(a.at))
      .limit(limit);
    for (const r of rows) {
      const d = r.detail ?? {};
      const what =
        r.kind === "page"
          ? pageWords(String(d.path ?? ""))
          : r.kind === "connect"
            ? connectWords(d.page as string | null)
            : r.kind === "disconnect"
              ? disconnectWords(d.page as string | null, d.code as number | null, d.seconds as number | null)
              : r.kind === "refused"
                ? "Was refused a show screen (wrong or switched-off code, or no access)"
                : r.kind === "show"
                  ? showWords(String(d.action ?? ""), true)
                  : r.kind === "trap"
                    ? "Touched the trap page — nothing real links there"
                    : r.kind;
      out.push({ at: r.at.toISOString(), source: "activity", kind: r.kind, what, who: r.who, userId: r.userId, device: r.device, deviceId: r.deviceId, ip: r.ip, place: r.place, rundownId: r.rundownId, sheet: null, detail: d });
    }
  }

  if (want(f, "account") && !f.deviceId && !f.rundownId) {
    const l = schema.auditLog;
    const actor = f.userId ?? (f.actor === "admin" ? "admin" : undefined);
    const rows = await db
      .select()
      .from(l)
      .where(all(actor ? eq(l.actor, actor) : undefined, f.ip ? eq(l.ip, f.ip) : undefined, ...range(l.at)))
      .orderBy(desc(l.at))
      .limit(limit);
    for (const r of rows) {
      const d = (r.detail as Record<string, unknown> | null) ?? {};
      const where = placeOf(r.ip);
      out.push({
        at: r.at.toISOString(),
        source: "account",
        kind: r.action,
        what: AUDIT_WORDS[r.action] ?? r.action,
        who: r.actor === "admin" ? "Administrator (server code)" : null,
        userId: r.actor && !r.actor.includes(":") && r.actor !== "admin" ? r.actor : null,
        device: typeof d.ua === "string" ? describeDevice(d.ua).label : null,
        deviceId: null,
        ip: r.ip,
        place: where?.place ?? null,
        rundownId: null,
        sheet: null,
        detail: d,
      });
    }
  }

  if (want(f, "show")) {
    const t = schema.showTransitions;
    const s = schema.showSessions;
    const rows = await db
      .select({ at: t.at, type: t.type, rowId: t.rowId, userId: t.actorUserId, who: t.who, deviceId: t.deviceId, device: t.device, ip: t.ip, rundownId: s.rundownId })
      .from(t)
      .innerJoin(s, eq(t.sessionId, s.id))
      .where(
        all(
          f.userId ? eq(t.actorUserId, f.userId) : undefined,
          f.actor === "admin" ? eq(t.who, "Administrator (server code)") : undefined,
          f.deviceId ? eq(t.deviceId, f.deviceId) : undefined,
          f.rundownId ? eq(s.rundownId, f.rundownId) : undefined,
          f.ip ? eq(t.ip, f.ip) : undefined,
          ...range(t.at),
        ),
      )
      .orderBy(desc(t.at))
      .limit(limit);
    for (const r of rows) {
      const byPerson = r.who != null || r.userId != null;
      const where = placeOf(r.ip);
      out.push({ at: r.at.toISOString(), source: "show", kind: r.type, what: showWords(r.type, byPerson), who: r.who ?? (byPerson ? null : "The clock"), userId: r.userId, device: r.device, deviceId: r.deviceId, ip: r.ip, place: where?.place ?? null, rundownId: r.rundownId, sheet: null, detail: { rowId: r.rowId } });
    }
  }

  if (want(f, "edit") && !f.deviceId && !f.ip && f.actor !== "admin") {
    const c = schema.sheetChanges;
    const rows = await db
      .select({ id: c.id, at: c.at, kind: c.kind, userId: c.actorUserId, who: c.actorName, assistant: c.assistant, summary: c.summary, rundownId: c.rundownId })
      .from(c)
      .where(all(f.userId ? eq(c.actorUserId, f.userId) : undefined, f.rundownId ? eq(c.rundownId, f.rundownId) : undefined, ...range(c.at)))
      .orderBy(desc(c.at))
      .limit(limit);
    for (const r of rows)
      out.push({ at: r.at.toISOString(), source: "edit", kind: r.kind, what: r.summary, who: r.assistant ? `${r.who ?? "Someone"}'s AI assistant` : r.who, userId: r.userId, device: null, deviceId: null, ip: null, place: null, rundownId: r.rundownId, sheet: null, detail: { changeId: r.id } });
  }

  if (want(f, "error") && !f.rundownId && !f.ip) {
    const e = schema.errorLogs;
    const rows = await db
      .select()
      .from(e)
      .where(
        all(
          f.userId ? sql`${e.context}->>'userId' = ${f.userId}` : undefined,
          f.deviceId ? sql`${e.context}->>'deviceId' = ${f.deviceId}` : undefined,
          f.actor === "admin" ? sql`${e.context}->>'who' = 'Administrator (server code)'` : undefined,
          ...range(e.at),
        ),
      )
      .orderBy(desc(e.at))
      .limit(limit);
    for (const r of rows) {
      const ctx = r.context ?? {};
      out.push({
        at: r.at.toISOString(),
        source: "error",
        kind: r.source,
        what: `Error: ${r.message.slice(0, 200)}`,
        who: (ctx.who as string | undefined) ?? null,
        userId: (ctx.userId as string | undefined) ?? null,
        device: r.userAgent ? describeDevice(r.userAgent).label : null,
        deviceId: (ctx.deviceId as string | undefined) ?? null,
        ip: null,
        place: (ctx.place as string | undefined) ?? null,
        rundownId: null,
        sheet: null,
        detail: { errorId: r.id, url: r.url, trail: ctx.trail ?? null },
      });
    }
  }

  out.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0));
  const page = out.slice(0, limit);

  // Names for accounts and sheets, looked up once for the whole page.
  const userIds = [...new Set(page.map((p) => p.userId).filter((x): x is string => !!x))];
  const sheetIds = [...new Set(page.map((p) => p.rundownId).filter((x): x is string => !!x))];
  const [users, sheets] = await Promise.all([
    userIds.length ? db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, userIds)) : [],
    sheetIds.length ? db.select({ id: schema.rundowns.id, name: schema.rundowns.name }).from(schema.rundowns).where(inArray(schema.rundowns.id, sheetIds)) : [],
  ]);
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const sheetName = new Map(sheets.map((s) => [s.id, s.name]));
  for (const p of page) {
    if (!p.who && p.userId) p.who = userName.get(p.userId) ?? null;
    if (p.rundownId) p.sheet = sheetName.get(p.rundownId) ?? null;
  }
  return page;
}
