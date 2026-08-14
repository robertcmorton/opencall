import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  CloseCodes,
  PROTOCOL_VERSION,
  parseClientMsg,
  type Role,
  type ServerMsg,
} from "@opencall/protocol";
import {
  absoluteNow,
  clockTargetRow as coreClockTargetRow,
  followerMayMove,
  computeTiming,
  zoneSecondsOfDay,
  type PlanTiming,
} from "@opencall/core";
import { createDb, decodeDoc, ensureSchema, projectRundownDoc, schema } from "@opencall/db";
import type { ProjectedRow } from "@opencall/db/doc";
import { and, eq, isNull, ne } from "drizzle-orm";
import type * as Y from "yjs";
import { ulid } from "ulid";
import { createDocServer } from "./doc-server";
import { createApiHandler, logServerError } from "./api";
import { customEventTypeSpec } from "./eventTypes";
import { PersistentShowStore } from "./sessions";
import * as authMod from "./auth";

// One public port for everything: HTTP API, the show channel (default ws
// path), and Yjs doc sync (ws path /doc). PORT is what PaaS hosts inject.
const PORT = Number(process.env.PORT ?? process.env.SYNC_PORT ?? 8787);
const HELLO_TIMEOUT_MS = 5000;
const HEARTBEAT_MS = 15000;

/**
 * Refuse to start if something is already on the port — BEFORE touching the
 * database.
 *
 * The old order opened the database first and discovered the clash afterwards,
 * so a second instance would get as far as initialising the store and then die
 * on `listen`. In development that store is an embedded PGlite directory, and
 * one abandoned half-way through initdb will not open again — the next start
 * fails inside WASM with nothing that names the cause. Three dev databases
 * were lost to exactly this before the check existed.
 */
const PORT_IN_USE = await new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once("error", (err: NodeJS.ErrnoException) => resolve(err.code === "EADDRINUSE"));
  probe.once("listening", () => probe.close(() => resolve(false)));
  probe.listen(Number(process.env.PORT ?? 8787));
});
if (PORT_IN_USE) {
  console.error(
    `[sync] port ${process.env.PORT ?? 8787} is already in use — another sync server is running.\n` +
      `       Stop it first (Ctrl-C, or kill -INT <pid>) so it can close its database cleanly.\n` +
      `       Nothing has been opened, so nothing is at risk.`,
  );
  process.exit(1);
}

// PGlite lives at the repo root so seed + sync share one database in dev.
// PGLITE_DIR points a second instance at its own database — one directory can
// only be opened by one process, so test instances (the auth matrix) need it.
const dbHandle = await createDb(
  process.env.DATABASE_URL,
  process.env.PGLITE_DIR || fileURLToPath(new URL("../../../.pglite", import.meta.url)),
);
// Fresh databases self-initialize (idempotent DDL).
await ensureSchema(dbHandle.db);

interface ClientCtx {
  role: Role;
  rundownId: string;
  device: "console" | "companion";
}

const showStore = new PersistentShowStore(dbHandle);
const clients = new Map<WebSocket, ClientCtx>();
const seenCmdIds = new Map<string, string[]>(); // rundownId → last 100 command ids

const send = (ws: WebSocket, msg: ServerMsg): void => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
};

const broadcast = (rundownId: string, msg: ServerMsg): void => {
  for (const [ws, ctx] of clients) if (ctx.rundownId === rundownId) send(ws, msg);
};

const broadcastPresence = (rundownId: string): void => {
  const counts: Partial<Record<Role, number>> = {};
  for (const ctx of clients.values())
    if (ctx.rundownId === rundownId) counts[ctx.role] = (counts[ctx.role] ?? 0) + 1;
  broadcast(rundownId, { v: PROTOCOL_VERSION, t: "presence", counts });
};

/**
 * Auth: join codes and guest tokens validate against share_tokens; the
 * ADMIN_TOKEN env var (sent as a session token) grants "admin". When
 * ADMIN_TOKEN is unset the deployment is dev-open and session tokens fall
 * back to "caller" (the pre-accounts stub). The literal join code DEV123
 * stays as a local-dev fallback unless disabled via ALLOW_DEV_JOIN=0.
 */
async function resolveAuth(
  auth: { kind: "session"; token: string } | { kind: "join"; code: string } | { kind: "guest"; token: string },
  rundownId: string,
): Promise<{ role: Role; label: string } | null> {
  if (auth.kind === "session") {
    if (auth.token && auth.token === authMod.adminToken()) return { role: "admin", label: "Admin" };
    if (authMod.isOpenAccess()) return { role: "caller", label: "Caller" };
    // Company (showcaller) tokens call shows within their own company only.
    const bearer = await authMod.resolveBearer(dbHandle, auth.token);
    // An account holding the admin grant is an admin here too — the check
    // above only recognises the literal ADMIN_TOKEN string.
    if (bearer?.kind === "admin") return { role: "admin", label: bearer.name ?? "Admin" };
    if (bearer?.kind === "company" && (await authMod.teamIdForRundown(dbHandle, rundownId)) === bearer.teamId)
      return { role: "caller", label: bearer.teamName };
    // User accounts: managers call, view-grants follow.
    if (bearer?.kind === "user") {
      const rundown = await dbHandle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, rundownId),
        columns: { eventId: true },
      });
      if (rundown) {
        if (await authMod.canManageEvent(dbHandle, bearer, rundown.eventId))
          return { role: "caller", label: bearer.name };
        const event = await dbHandle.db.query.events.findFirst({
          where: eq(schema.events.id, rundown.eventId),
          columns: { teamId: true },
        });
        if (event && (await authMod.canSeeEvent(dbHandle, bearer, rundown.eventId, event.teamId)))
          return { role: "follower", label: bearer.name };
      }
    }
    return null;
  }
  if (auth.kind === "join") {
    const row = await dbHandle.db.query.shareTokens.findFirst({
      where: and(
        eq(schema.shareTokens.joinCode, auth.code.toUpperCase()),
        eq(schema.shareTokens.rundownId, rundownId),
        eq(schema.shareTokens.kind, "join"),
        isNull(schema.shareTokens.revokedAt),
      ),
    });
    if (row) return { role: row.role as Role, label: row.label || (row.role === "caller" ? "Caller" : "Crew") };
    if (auth.code === "DEV123" && process.env.ALLOW_DEV_JOIN !== "0") return { role: "follower", label: "Crew (dev)" };
    return null;
  }
  const row = await dbHandle.db.query.shareTokens.findFirst({
    where: and(
      eq(schema.shareTokens.token, auth.token),
      eq(schema.shareTokens.kind, "guest"),
      isNull(schema.shareTokens.revokedAt),
    ),
  });
  return row && row.rundownId === rundownId ? { role: "guest", label: "Guest" } : null;
}

// Crash-level errors land in the same journal the admin dashboard reads.
process.on("uncaughtException", (err) => {
  console.error("[sync] uncaught exception:", err);
  logServerError(dbHandle, "process", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[sync] unhandled rejection:", reason);
  logServerError(dbHandle, "process", reason);
});

/**
 * Close the database before going.
 *
 * Nothing did, so every stop was effectively pulling the plug. Postgres
 * survives that; the embedded PGlite used in development does not — killed
 * mid-write it leaves a directory that will not open again, and the next run
 * aborts inside initdb with nothing that names the cause. Two dev databases
 * were lost that way before this existed.
 *
 * Also the right thing in production: a deploy sends SIGTERM, and a clean
 * close finishes whatever write is in flight rather than abandoning it.
 */
let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (closing) return; // a second Ctrl-C should not race the first
    closing = true;
    console.log(`[sync] ${signal} — closing the database`);
    void dbHandle
      .close()
      .catch((err) => console.error("[sync] close failed:", err))
      .finally(() => process.exit(0));
  });
}

const docServer = createDocServer(dbHandle);

// HTTP: JSON API for the web app.
const handleApi = createApiHandler(dbHandle, docServer);
const httpServer = createServer(async (req, res) => {
  try {
    const handled = await handleApi(req, res);
    if (!handled) {
      res.statusCode = 404;
      res.end("not found");
    }
  } catch (err) {
    logServerError(dbHandle, "server", err, { url: `${req.method} ${req.url}` });
    if (!res.headersSent) res.statusCode = 500;
    res.end("server error");
  }
});

const wss = new WebSocketServer({ noServer: true });
const docWss = new WebSocketServer({ noServer: true });

httpServer.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/doc" || pathname.startsWith("/doc/")) {
    docWss.handleUpgrade(req, socket, head, (ws) => {
      docServer.handleConnection(ws, req);
    });
  } else {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }
});

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const rundownId = url.searchParams.get("rundown") ?? "";

  const helloTimer = setTimeout(() => ws.close(CloseCodes.AUTH_FAILED, "hello timeout"), HELLO_TIMEOUT_MS);

  ws.on("message", async (raw) => {
    const msg = parseClientMsg(String(raw));
    if (!msg) return; // unknown/invalid frames are ignored (forward compatibility)

    const ctx = clients.get(ws);

    if (msg.t === "hello") {
      if (ctx) return;
      clearTimeout(helloTimer);
      if (!rundownId) {
        ws.close(CloseCodes.UNKNOWN_RUNDOWN, "missing rundown");
        return;
      }
      const resolved = await resolveAuth(msg.auth, rundownId);
      if (!resolved) {
        ws.close(CloseCodes.AUTH_FAILED, "invalid credentials");
        return;
      }
      clients.set(ws, { role: resolved.role, rundownId, device: msg.device });
      // The event's location decides the timezone every clock renders in.
      const rundownRow = await dbHandle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, rundownId),
        columns: { eventId: true, sport: true },
      });
      const eventRow = rundownRow
        ? await dbHandle.db.query.events.findFirst({
            where: eq(schema.events.id, rundownRow.eventId),
            columns: { teamId: true, timezone: true, sport: true },
          })
        : null;
      // THIS sheet's kind of show, falling back to the event's for sheets made
      // before a sheet could have its own. A match day running netball on one
      // sheet and rugby league on another needs the answer per sheet.
      const sport = rundownRow?.sport ?? eventRow?.sport ?? undefined;
      // Sent whole rather than as a code, so a type a company invented behaves
      // live exactly like a built-in one without the screen fetching anything.
      const eventTypeSpec = await customEventTypeSpec(dbHandle.db, sport, eventRow?.teamId);
      send(ws, {
        v: PROTOCOL_VERSION,
        t: "welcome",
        role: resolved.role,
        userLabel: resolved.label,
        serverTimeMs: Date.now(),
        show: (await showStore.get(rundownId)).current,
        doc: { mode: resolved.role === "guest" ? "projection" : "sync" },
        timezone: eventRow?.timezone,
        sport,
        ...(eventTypeSpec ? { eventTypeSpec } : {}),
      });
      broadcastPresence(rundownId);
      return;
    }

    if (!ctx) return; // everything else requires a completed hello

    if (msg.t === "ping") {
      send(ws, { v: PROTOCOL_VERSION, t: "pong", t0: msg.t0, t1: Date.now() });
      return;
    }

    if (msg.t === "cmd") {
      if (ctx.role !== "caller" && ctx.role !== "admin") {
        send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: CloseCodes.FORBIDDEN, msg: "caller role required" });
        return;
      }
      const seen = seenCmdIds.get(ctx.rundownId) ?? [];
      if (seen.includes(msg.id)) return; // idempotent retry
      seen.push(msg.id);
      if (seen.length > 100) seen.shift();
      seenCmdIds.set(ctx.rundownId, seen);

      // Pool-cue fire: as-run log entry only, never a state transition.
      if (msg.action === "fire") {
        const logged = await showStore.logFire(ctx.rundownId, msg.rowId!);
        if (!logged)
          send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: 400, msg: "no live session to fire into" });
        return;
      }

      /**
       * "Put the show where the sheet says it is" — not "take this row now".
       *
       * An ordinary jump starts the row at the moment it is pressed, because
       * the showcaller is taking it now. Sync cue is a claim about where the
       * show ALREADY was, so the row inherits its planned start. Without this
       * the button reported the show as late by exactly however overdue the
       * row it had just synced to was — press sync, watch the show go +1:19.
       */
      /**
       * The cue timer represents the LIVE show, and nothing else.
       *
       * A pre-record is shot while the show goes on around it, and a bell is a
       * warning: they belong on the sheet, they occupy people and cameras, and
       * NEITHER is ever called by the showcaller. So neither may ever become
       * the active row — the moment one does, the item countdown is counting
       * something that is not on air, and the show's drift is measured against
       * it. That is exactly how a show came to sit on a nine-second insert
       * with the readout climbing into the red.
       *
       * Refused here, on the server, rather than only hidden in the console:
       * this holds for every client, every device and every replayed command,
       * and there is one answer to "may this row be cued" instead of one per
       * surface. A row that runs alongside can still be FIRED — that logs it
       * to the as-run record without taking the show off air, which is the
       * affordance these rows actually want.
       */
      const movesTheShow =
        msg.action === "jump" || msg.action === "next" || msg.action === "prev" || msg.action === "start";
      let sheet = movesTheShow && msg.rowId ? await sheetNow(ctx.rundownId) : null;
      if (sheet?.rows.find((r) => r.id === msg.rowId)?.parallel) {
        send(ws, {
          v: PROTOCOL_VERSION,
          t: "cmd_error",
          id: msg.id,
          code: 400,
          msg: "that row runs alongside the show and is never cued",
        });
        return;
      }

      let startedAtMs: number | undefined;
      if (msg.action === "jump" && msg.atPlanned && msg.rowId) {
        sheet ??= await sheetNow(ctx.rundownId);
        if (sheet) {
          const idx = sheet.rows.findIndex((r) => r.id === msg.rowId);
          if (idx >= 0) startedAtMs = plannedStartMs(sheet.timing, idx, sheet.nowMs, sheet.nowSec);
        }
      }
      const result = (await showStore.get(ctx.rundownId)).apply(msg.action, msg.rowId, undefined, startedAtMs);
      if (typeof result === "string") {
        send(ws, { v: PROTOCOL_VERSION, t: "cmd_error", id: msg.id, code: 400, msg: result });
        return;
      }
      // No fast path for the caller: everyone (including the sender) gets the broadcast.
      broadcast(ctx.rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
      // Walkthrough moves are rehearsal, not history — never written to the
      // as-run record (and "walk" isn't a transition type).
      if (msg.action !== "walk") showStore.persist(ctx.rundownId, result, msg.action, msg.rowId);

      // Automatic safety snapshot the moment a show goes live.
      if (msg.action === "start") {
        void (async () => {
          const rundown = await dbHandle.db.query.rundowns.findFirst({
            where: eq(schema.rundowns.id, ctx.rundownId),
            columns: { doc: true },
          });
          if (rundown?.doc)
            await dbHandle.db.insert(schema.rundownSnapshots).values({
              id: ulid(),
              rundownId: ctx.rundownId,
              doc: rundown.doc,
              label: "Show start",
            });
        })().catch((err) => console.error("[sync] show-start snapshot failed:", err));
      }
    }
  });

  ws.on("close", () => {
    const ctx = clients.get(ws);
    clients.delete(ws);
    if (ctx) broadcastPresence(ctx.rundownId);
  });
});

const heartbeat = setInterval(() => {
  for (const [ws] of clients) send(ws, { v: PROTOCOL_VERSION, t: "hb" });
}, HEARTBEAT_MS);
heartbeat.unref();

// ── Server-driven clock-follow ────────────────────────────────────────────────
// While a session has clockFollow on and is RUNNING, the SERVER advances it
// along the TIME column — no console needs to stay open (live fail-safe).
// Sessions are discovered from the DB each tick, so follow survives restarts
// and resumes with zero clients. The showcaller steers it on the fly: doc
// edits re-project immediately (live doc preferred over stored bytes), pause
// holds the position, manual jumps are corrected at the next tick, and
// clock_off returns full manual control.

const projectionCache = new Map<string, { key: string; rows: ProjectedRow[]; timing: PlanTiming }>();
const timezoneCache = new Map<string, { tz: string | null; at: number }>();

/**
 * Where the event's clock says the show should be.
 *
 * A thin wrapper over the shared `clockTargetRow` rather than a copy of it.
 * There used to be two implementations of this — one here driving the live
 * show, one in core driving the prompter — which is two answers to the same
 * question waiting to disagree, and a fix applied to one of them silently
 * leaving the other wrong.
 */
function clockTargetRow(rows: ProjectedRow[], timing: PlanTiming, wallSec: number): string | null {
  // The sheet counts on past midnight; the wall clock resets. Put them on the
  // same scale or a show running into the small hours stops dead at 23:59.
  return coreClockTargetRow(
    rows,
    timing.rows.map((r) => r.startSec),
    absoluteNow(wallSec, timing),
  );
}

/**
 * The rows, their timing and the event's clock — as the follower sees them.
 *
 * Shared with the sync-cue jump so both agree about where the sheet says the
 * show is. Two readings of that would be two answers to the same question, and
 * the one the button gives has to match the one the follower would.
 */
async function sheetNow(
  rundownId: string,
): Promise<{ rows: ProjectedRow[]; timing: PlanTiming; nowMs: number; nowSec: number } | null> {
  const rundown = await dbHandle.db.query.rundowns.findFirst({
    where: eq(schema.rundowns.id, rundownId),
    columns: { doc: true, docEpoch: true, docUpdatedAt: true, eventId: true, plannedStartSec: true },
  });
  if (!rundown?.doc) return null;

  // The live in-memory doc (when anyone is editing) beats the debounced
  // store — on-the-fly time changes take effect within a tick.
  const liveDoc = docServer.documents.get(`${rundownId}@${rundown.docEpoch}`) as Y.Doc | undefined;
  let rows: ProjectedRow[];
  let timing: PlanTiming;
  if (liveDoc) {
    const projected = projectRundownDoc(liveDoc);
    rows = projected.rows;
    timing = computeTiming(rows, projected.meta.plannedStartSec ?? rundown.plannedStartSec);
  } else {
    const key = `${rundown.docEpoch}:${rundown.docUpdatedAt?.getTime() ?? 0}`;
    let cached = projectionCache.get(rundownId);
    if (!cached || cached.key !== key) {
      const projected = projectRundownDoc(decodeDoc(rundown.doc));
      cached = {
        key,
        rows: projected.rows,
        timing: computeTiming(projected.rows, projected.meta.plannedStartSec ?? rundown.plannedStartSec),
      };
      projectionCache.set(rundownId, cached);
    }
    rows = cached.rows;
    timing = cached.timing;
  }

  let tzEntry = timezoneCache.get(rundown.eventId);
  if (!tzEntry || Date.now() - tzEntry.at > 60_000) {
    const event = await dbHandle.db.query.events.findFirst({
      where: eq(schema.events.id, rundown.eventId),
      columns: { timezone: true },
    });
    tzEntry = { tz: event?.timezone ?? null, at: Date.now() };
    timezoneCache.set(rundown.eventId, tzEntry);
  }

  const nowMs = Date.now();
  return { rows, timing, nowMs, nowSec: zoneSecondsOfDay(nowMs, tzEntry.tz ?? undefined) };
}

/**
 * When a row that is due to be on air NOW should be recorded as having begun.
 *
 * The sheet's own start, whenever that has already passed. Following the clock
 * means the show is ON the clock: a row stamped with the moment somebody
 * noticed it reports the show as late by exactly however overdue the row was.
 */
function plannedStartMs(
  timing: PlanTiming,
  targetIndex: number,
  nowMs: number,
  nowSec: number,
): number {
  const plannedStartSec = targetIndex >= 0 ? (timing.rows[targetIndex]?.startSec ?? null) : null;
  const absNow = absoluteNow(nowSec, timing);
  return plannedStartSec != null && plannedStartSec <= absNow ? nowMs - (absNow - plannedStartSec) * 1000 : nowMs;
}

let clockTicking = false;
async function clockTick(): Promise<void> {
  if (clockTicking) return; // never overlap slow ticks
  clockTicking = true;
  try {
    const live = await dbHandle.db.query.showSessions.findMany({
      where: and(eq(schema.showSessions.clockFollow, true), ne(schema.showSessions.state, "ended")),
      columns: { rundownId: true },
    });
    for (const { rundownId } of live) {
      const machine = await showStore.get(rundownId);
      const current = machine.current;
      // Paused holds the whole show. Otherwise the clock advances it.
      if (current.state !== "running" || !current.clockFollow) continue;

      const sheet = await sheetNow(rundownId);
      if (!sheet) continue;
      const { rows, timing, nowMs, nowSec } = sheet;
      const target = clockTargetRow(rows, timing, nowSec);
      if (!target || target === current.activeRowId) continue;

      const targetIndex = rows.findIndex((r) => r.id === target);

      /**
       * A show never goes backwards.
       *
       * On the night the clocks go back, 02:00 to 02:59 happens TWICE — the
       * wall clock really does return to 02:00 — so a sheet with rows in that
       * hour would be called a second time, dragging the cue back an hour
       * while the show carried on forwards. The same guard covers any other
       * clock that steps back under a running show: a corrected server time, a
       * machine coming off a bad NTP source, an operator fixing the timezone.
       *
       * Only the automatic follower is held to this. A person can still jump
       * wherever they like — going back is sometimes exactly what is wanted,
       * and they can see what they are doing.
       *
       * Measured in the RUNNING ORDER, not in sheet rows. A pre-record is
       * written on the sheet near where it is SHOT, not where it airs, so it
       * can sit well below the rows that follow it on air. Comparing raw row
       * numbers therefore made a pre-record a TRAP: once the show was sitting
       * on one, every legitimate target counted as "backwards", the follower
       * refused to move for the rest of the night, and the overrun on a
       * nine-second insert climbed until the drift readout went red. Four of
       * the six pre-records on the last match sheet would hold a show that
       * way. A row that runs alongside the order has no place in it, so a show
       * sitting on one is not ahead of anything and the clock may take it back.
       */
      if (!followerMayMove(rows, current.activeRowId, target)) {
        console.warn(
          `[clock] not moving ${rundownId} back to ${target} — the clock stepped backwards in the running order`,
        );
        continue;
      }

      // The row began when the SHEET says it began, not at the moment the
      // follower noticed. Following the clock means the show is on the clock:
      // backdating keeps the item's countdown honest and the drift at zero,
      // instead of reporting however long ago the row was due to start.
      const result = machine.apply("jump", target, nowMs, plannedStartMs(timing, targetIndex, nowMs, nowSec));
      if (typeof result === "string") continue;
      broadcast(rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
      showStore.persist(rundownId, result, "jump", target);
    }
  } catch (err) {
    console.error("[sync] clock-follow tick failed:", err);
  } finally {
    clockTicking = false;
  }
}
const clockLoop = setInterval(() => void clockTick(), 1000);
clockLoop.unref();

httpServer.listen(PORT, () => {
  console.log(`[sync] api + show channel + /doc channel on :${PORT}  (protocol v${PROTOCOL_VERSION})`);
});
