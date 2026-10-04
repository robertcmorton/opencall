import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket, type RawData } from "ws";
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
  calledEndingBehind,
  clockStep,
  rowStartedAtMs,
  followerMayMove,
  reportClockRefusal,
  computeTiming,
  zoneSecondsOfDay,
  type PlanTiming,
} from "@opencall/core";
import { createDb, decodeDoc, ensureSchema, projectRundownDoc, schema } from "@opencall/db";
import type { ProjectedRow } from "@opencall/db/doc";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type * as Y from "yjs";
import { ulid } from "ulid";
import { createDocServer, docStoresSettled } from "./doc-server.ts";
import { createApiHandler, GUESS_PER_IP, HttpError, LOGIN_WINDOW_SEC, logServerError } from "./api.ts";
import { createMcpRoutes } from "./mcp.ts";
import { readFileSync } from "node:fs";
import { clientIp, ipBucket } from "./clientIp.ts";
import { allowedOrigins, originAllowed } from "./origins.ts";
import { scheduleRetention } from "./retention.ts";
import { consume, release } from "./throttle.ts";
import { customEventTypeSpec } from "./eventTypes.ts";
import { ABANDON_AFTER_MS, abandonedSessions, PersistentShowStore } from "./sessions.ts";
import * as authMod from "./auth.ts";

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
  // The same port the server will listen on: PORT, else SYNC_PORT, else 8787.
  probe.listen(PORT);
});
if (PORT_IN_USE) {
  console.error(
    `[sync] port ${PORT} is already in use — another sync server is running.\n` +
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
/**
 * Settings that would leave a production server open, said out loud at boot
 * (and in the error journal) rather than discovered later. Never fatal: a
 * server that refused to start would take the show down with it.
 */
if (process.env.DATABASE_URL) {
  const warn = (msg: string) => {
    console.warn(`[sync] WARNING: ${msg}`);
    setTimeout(() => logServerError(dbHandle, "process", new Error(`startup check: ${msg}`)), 5000).unref?.();
  };
  const admin = process.env.ADMIN_TOKEN ?? "";
  if (!admin) warn("ADMIN_TOKEN is not set, so this server is OPEN: anybody is an administrator.");
  else if (admin.length < 32) warn(`ADMIN_TOKEN is only ${admin.length} characters; use at least 32 random characters.`);
  if (allowedOrigins().size === 0) warn("PUBLIC_WEB_URL is not set, so any website may call this API from a browser.");
  if (!process.env.PUBLIC_WEB_URL?.trim()) warn("PUBLIC_WEB_URL is not set, so AI assistants cannot find the page where people approve them.");
  if (process.env.ALLOW_DEV_JOIN !== "0") warn("ALLOW_DEV_JOIN is not 0, so the development join code DEV123 opens any sheet read-only.");
}

/**
 * Schema changes run as the database OWNER when MIGRATION_DATABASE_URL is set,
 * and everything else through DATABASE_URL — which can then be a restricted
 * login that reads and writes rows but cannot create, alter or drop anything
 * (packages/db/scripts/setup-app-role.ts makes one). A query that got past
 * every other check still could not drop a table. Without it set, the one
 * login does both, as before.
 */
if (process.env.MIGRATION_DATABASE_URL && process.env.DATABASE_URL) {
  const owner = await createDb(process.env.MIGRATION_DATABASE_URL);
  try {
    await ensureSchema(owner.db);
  } finally {
    await owner.close();
  }
} else {
  await ensureSchema(dbHandle.db);
}
// Credentials stored before they were hashed are hashed in place, once. See
// hashStoredCredentials: everyone signed in stays signed in.
await authMod.hashStoredCredentials(dbHandle);
// Old counters, ended sessions, aged audit and error records — see retention.ts.
scheduleRetention(dbHandle);

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
  ipKey: string,
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
        // Edits the sheet, never drives it: the editor role the join codes
        // already know, now reachable from an account.
        if (await authMod.canEditEvent(dbHandle, bearer, rundown.eventId))
          return { role: "editor", label: bearer.name };
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
    // Misses count against the address, as on every other way a code is
    // tried (see resolveJoinCodeGuarded); a hit is given back.
    const guessKey = `guess:ip:${ipKey}`;
    const t = await consume(dbHandle, guessKey, { max: GUESS_PER_IP, windowSec: LOGIN_WINDOW_SEC });
    if (!t.ok) return null;
    const row = await dbHandle.db.query.shareTokens.findFirst({
      where: and(
        eq(schema.shareTokens.joinCode, auth.code.toUpperCase()),
        eq(schema.shareTokens.rundownId, rundownId),
        eq(schema.shareTokens.kind, "join"),
        isNull(schema.shareTokens.revokedAt),
      ),
    });
    if (row) {
      await release(dbHandle, guessKey);
      return { role: row.role as Role, label: row.label || (row.role === "caller" ? "Caller" : "Crew") };
    }
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
    console.log(`[sync] ${signal} — finishing writes, then closing the database`);
    /**
     * Finish what is in flight BEFORE closing, which is what the comment above
     * has always claimed and the code did not do.
     *
     * `showStore.persist` is fire-and-forget on purpose — a transport command
     * cannot wait on Postgres while somebody is calling a show — so at any
     * moment there may be an unawaited write carrying the row that was just
     * cued. Closing the database out from under it loses exactly that: the
     * sheet comes back pointing at the previous item, after a deploy nobody
     * connected to the timing.
     *
     * Bounded, because shutdown cannot hang: a platform that sends SIGTERM
     * sends SIGKILL a few seconds later, and a flush that never settles would
     * turn a clean stop into a hard kill — the very thing this handler exists
     * to avoid. Two seconds is far longer than a handful of row writes and far
     * shorter than any grace period.
     */
    // Sheet edits wait a moment before they are written (the document
    // server debounces its saves), so a deploy landing inside that moment
    // used to drop them. Writing them now is safe whatever their state: each
    // store checks the sheet's epoch before it touches the row.
    // During startup the document server may not exist yet; nothing is
    // pending then, so there is nothing to write.
    try {
      docServer.flushPendingStores();
    } catch {
      /* not created yet */
    }
    const settled = Promise.race([
      Promise.all([showStore.flush(), docStoresSettled()]),
      new Promise<void>((resolve) => setTimeout(resolve, 2000).unref?.()),
    ]);
    void settled
      .catch((err) => console.error("[sync] flush failed:", err))
      .then(() => dbHandle.close())
      .catch((err) => console.error("[sync] close failed:", err))
      .finally(() => process.exit(0));
  });
}

const docServer = createDocServer(dbHandle);

// HTTP: JSON API for the web app.
const handleApi = createApiHandler(dbHandle, docServer, {
  // "End event" from the sheet or the dashboard: the show stops with it.
  stopShow: async (rundownId) => {
    const machine = await showStore.get(rundownId);
    const result = machine.apply("stop", undefined, Date.now());
    if (typeof result === "string") return; // not live: nothing to stop
    broadcast(rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
    showStore.persist(rundownId, result, "stop");
  },
});
// AI assistants (MCP): discovery, sign-in and the tools. Open to any origin.
const appVersion = (() => {
  try {
    return String(JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version ?? "0.0.0");
  } catch {
    return "0.0.0";
  }
})();
const handleMcp = createMcpRoutes(dbHandle, docServer, async (rundownId) => {
  const { state, activeRowId } = (await showStore.get(rundownId)).current;
  return { state, activeRowId };
}, appVersion);
const httpServer = createServer(async (req, res) => {
  /**
   * Health, for the platform and an uptime check: can this process reach its
   * database within two seconds? 200 if so, 503 if not, the reason in the
   * server log only. Answered before anything else, with no auth.
   */
  if (req.method === "GET" && (req.url === "/health" || req.url === "/healthz")) {
    const ok = await Promise.race([
      dbHandle.db.execute(sql`select 1`).then(() => true, (err) => {
        console.error("[health] database check failed:", err);
        return false;
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000).unref?.()),
    ]);
    res.statusCode = ok ? 200 : 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ ok }));
    return;
  }
  try {
    const handled = (await handleMcp(req, res)) || (await handleApi(req, res));
    if (!handled) {
      res.statusCode = 404;
      res.end("not found");
    }
  } catch (err) {
    // A request that was refused on purpose (too large, malformed) is the
    // caller's fault and says so; it is not a server error to log.
    if (err instanceof HttpError) {
      if (!res.headersSent) {
        res.statusCode = err.status;
        res.setHeader("content-type", "application/json");
      }
      res.end(JSON.stringify({ error: err.message }));
      // Stop reading a body we have already refused.
      if (err.status === 413) req.destroy();
      return;
    }
    logServerError(dbHandle, "server", err, { url: `${req.method} ${req.url}` });
    if (!res.headersSent) res.statusCode = 500;
    res.end("server error");
  }
});

// Message size caps. The library's default is 100MB per message, which lets
// any client make the server buffer that much. Show commands are a few
// hundred bytes; 256KB is generous. A sheet's document can arrive whole on
// reconnect (measured 1.7MB raw for the largest real sheet), so 16MB.
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
/**
 * The document socket compresses; the show-state socket does not.
 *
 * A run sheet's whole document is sent on every connect — the browser starts
 * from an empty doc, so there is nothing to send a delta against — and a real
 * sheet measures 1,715 KB. Deflated it is 413 KB: measured on an actual
 * 3,321-row sheet, not estimated. That is 1.3 MB removed from the wait before
 * anything appears, for one option.
 *
 * `ws` defaults `perMessageDeflate` to FALSE, so this was never on. The
 * browser has been offering it and the server declining it.
 *
 * Only this socket. The other one carries show state — a cue change, a pause,
 * a heartbeat — which is a few dozen bytes arriving often, and compressing
 * those costs more CPU than the bytes are worth. `threshold` says the same
 * thing again inside this socket: below 1 KB, send it raw.
 *
 * `concurrencyLimit` bounds what a burst of reconnects can do to the CPU —
 * an outage that drops thirty consoles at once brings them all back at once,
 * and that is exactly the moment the server must not stall.
 */
const docWss = new WebSocketServer({
  noServer: true,
  maxPayload: 16 * 1024 * 1024,
  perMessageDeflate: {
    threshold: 1024,
    concurrencyLimit: 10,
  },
});

/** Node's upgrade request as the standard Request the document server reads
 *  its headers and query parameters from. */
function toFetchRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return new Request(`http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`, { headers });
}

/** A ws frame as bytes, whichever of its three shapes it arrived in. */
function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

httpServer.on("upgrade", (req, socket, head) => {
  // A WebSocket is not protected by the browser's cross-site rules the way a
  // fetch is, so the Origin is checked here: a page on another site cannot
  // open the show or the document socket with a visitor's browser.
  if (!originAllowed(req.headers.origin, allowedOrigins())) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  if (pathname === "/doc" || pathname.startsWith("/doc/")) {
    docWss.handleUpgrade(req, socket, head, (ws) => {
      // The document server no longer listens to the socket itself (from
      // Hocuspocus 4 it takes any WebSocket-like object), so every frame and
      // the close are handed over here. Without the close, a phone that drops
      // off would hold its document open until the timeout found it.
      const conn = docServer.handleConnection(ws, toFetchRequest(req));
      ws.on("message", (data) => conn.handleMessage(toBytes(data)));
      ws.on("close", (code, reason) => conn.handleClose({ code, reason: reason.toString() } as Parameters<typeof conn.handleClose>[0]));
      ws.on("error", (err) => logServerError(dbHandle, "server", err, { context: { where: "document socket" } }));
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
      const resolved = await resolveAuth(msg.auth, rundownId, ipBucket(clientIp(req)));
      if (!resolved) {
        ws.close(CloseCodes.AUTH_FAILED, "invalid credentials");
        return;
      }
      clients.set(ws, { role: resolved.role, rundownId, device: msg.device });
      // The event's location decides the timezone every clock renders in.
      const rundownRow = await dbHandle.db.query.rundowns.findFirst({
        where: eq(schema.rundowns.id, rundownId),
        columns: { eventId: true, sport: true, homeImage: true, awayImage: true },
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
        homeImage: rundownRow?.homeImage ?? null,
        awayImage: rundownRow?.awayImage ?? null,
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
      /**
       * Handing the show to the clock does not leave it timing an item that
       * has not begun.
       *
       * The report: a sheet opening at 1:15 PM, started that morning, sitting
       * there counting down an item hours away and declaring the show four
       * hours ahead of itself.
       *
       * The path is start, THEN switch the follower on — and it has to be that
       * way round, because the follower cannot be switched on before a show is
       * live. Start cues the first row, which is right while a person is in
       * charge. Switching the follower on then changed who is in charge without
       * changing what was cued, and the follower had nothing to say about it: a
       * clock that has not reached the sheet yet returns no target, and the
       * loop below leaves the cue alone rather than clearing it.
       *
       * So the correction belongs at the handover. If the clock has not reached
       * the sheet at all, it would have cued nothing, and nothing is what the
       * show should be holding — live, waiting, with the first item cued at its
       * own time. That is the whole promise of giving the clock the show.
       *
       * NOT applied to `start`: it cannot help there. `clock_on` is refused
       * unless the show is already live and `stop` clears the flag, so the
       * follower is off at every start there is. A guard there would be a
       * comment pretending to be code. If that ever changes — if the follower
       * can be armed before a show goes live — this belongs on `start` too.
       */
      let clearCue = false;
      if (msg.action === "clock_on") {
        sheet ??= await sheetNow(ctx.rundownId);
        if (sheet && clockTargetRow(sheet.rows, sheet.timing, sheet.nowSec) == null) clearCue = true;
      }
      const result = (await showStore.get(ctx.rundownId)).apply(
        msg.action,
        msg.rowId,
        undefined,
        startedAtMs,
        clearCue,
      );
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

/**
 * Which clock refusal has already been reported, per rundown: rundownId → the
 * target row we declined to move to. The decision itself is
 * `reportClockRefusal` in core, where it can be tested; this loop cannot be.
 * Cleared below wherever the follower is NOT refusing.
 */
const refusedClockTarget = new Map<string, string>();

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
      if (current.state !== "running" || !current.clockFollow) {
        refusedClockTarget.delete(rundownId);
        continue;
      }

      const sheet = await sheetNow(rundownId);
      if (!sheet) continue;
      const { rows, timing, nowMs, nowSec } = sheet;

      /**
       * ROWS THE SHEET NEVER TIMED come first, because the clock cannot see
       * them and must not step over them.
       *
       * Extra time is made of them: nobody knows when golden point will
       * happen, so nobody writes a time against it. With only the clock to go
       * on, calling golden point left the cue on the second half — the block
       * beneath it being invisible — so the half overran in red with its bar
       * pinned, the big timer counted up, and the result chooser never came
       * back, because it returns when the cue reaches the LAST row of the
       * extra period. Then the next match's first printed row came round and
       * the clock jumped to it, taking the show out of the game with the
       * result still uncalled and no way left to call it. All four of those
       * were reported at once, and they are one fault.
       *
       * A row with no printed time is played for its LENGTH instead — the only
       * honest thing it has — and the clock is not allowed past one that has
       * not been played.
       */
      const elapsedSec =
        current.activeRowStartedAtMs == null
          ? 0
          : Math.max(0, (nowMs - current.activeRowStartedAtMs - current.pausedAccumMs) / 1000);
      const played = new Set(current.playedRowIds);
      const step = clockStep(
        rows,
        rows.map((r) => r.durationSec ?? null),
        current.activeRowId,
        elapsedSec,
        played,
      );
      if (step.kind === "hold") {
        refusedClockTarget.delete(rundownId);
        continue;
      }
      const target = step.kind === "advance" ? step.rowId : clockTargetRow(rows, timing, nowSec);
      /**
       * A null target means the clock has not reached the first item yet, and
       * this leaves the cue alone rather than clearing it.
       *
       * Deliberate, and worth knowing: it means the follower cannot UNDO a cue
       * that is ahead of the clock. A show started before its sheet begins used
       * to land in exactly that state and stay there until its first item came
       * round. The start path above no longer creates it — but a show already
       * parked that way, by an older build or by a start made before the
       * follower was switched on, still needs a Stop to clear. Clearing it from
       * here would mean the follower yanking a row out from under whoever cued
       * it, and `jump` cannot express "cue nothing" anyway (`rowId ?? current`
       * keeps what is there), so it would take a protocol change to say it
       * properly.
       */
      if (!target || target === current.activeRowId) {
        refusedClockTarget.delete(rundownId);
        continue;
      }

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
      // Going back for a called ending is the one backwards move that is not
      // the clock misbehaving: the result was called, and the branch is above.
      const goingBackForResult = calledEndingBehind(rows, current.activeRowId, played).some((r) => r.id === target);
      if (!goingBackForResult && !followerMayMove(rows, current.activeRowId, target)) {
        // Once per state, not once per tick — see `reportClockRefusal`.
        if (reportClockRefusal(refusedClockTarget, rundownId, target)) {
          console.warn(
            `[clock] not moving ${rundownId} back to ${target} — the clock stepped backwards in the running order`,
          );
        }
        continue;
      }

      // Backdated to the planned start when the CLOCK reached the row, stamped
      // NOW when `clockStep` stepped into one the sheet never timed. The rule
      // and the reason live in core, where they can be tested.
      const startedAtMs = rowStartedAtMs(
        step,
        plannedStartMs(timing, targetIndex, nowMs, nowSec),
        nowMs,
      );
      const result = machine.apply("jump", target, nowMs, startedAtMs);
      if (typeof result === "string") continue;
      refusedClockTarget.delete(rundownId);
      broadcast(rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
      showStore.persist(rundownId, result, "jump", target);
    }
  } catch (err) {
    console.error("[sync] clock-follow tick failed:", err);
  } finally {
    clockTicking = false;
  }
}
/**
 * A show nobody ever stopped.
 *
 * The dashboard has flagged these since the beginning — six hours without a
 * command and a session gets a "stale" chip — and deliberately did no more
 * than flag them, on the reasoning that ending somebody's show from a timer
 * is the kind of helpfulness that stops a real one sitting quiet through a
 * long interval.
 *
 * That reasoning holds at six hours and stops holding at twenty-four. Nothing
 * this app is for runs for a day: the longest sheet in the sample corpus is a
 * twenty-four-hour festival test, and even that moves constantly. A session
 * with no command in it for a full day was abandoned — the tab was closed, the
 * laptop went home — and leaving it open costs something real, because
 * `one_live_session_per_rundown` means the forgotten one BLOCKS the next
 * genuine show on that sheet until somebody finds and stops it.
 *
 * So: flagged at six hours for a person to judge, ended at twenty-four when
 * there is no longer a judgement to make. The four-times gap is the margin.
 *
 * Ended through the state machine rather than by writing `ended` into the
 * table, so the as-run record gets its closing entry, the in-memory machine
 * agrees with the row, and anybody still watching sees the show stop.
 */
let sweeping = false;
async function abandonedSessionSweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const open = await dbHandle.db.query.showSessions.findMany({
      where: ne(schema.showSessions.state, "ended"),
      columns: { id: true, rundownId: true, startedAt: true },
    });
    if (open.length === 0) return;
    const moves = await dbHandle.db.query.showTransitions.findMany({
      where: inArray(schema.showTransitions.sessionId, open.map((s) => s.id)),
      columns: { sessionId: true, at: true },
    });
    // Last sign of life: the newest command, or the start for one that never
    // moved at all — the same measure the dashboard's chip uses.
    const lastMove = new Map<string, number>();
    for (const m of moves) {
      const at = m.at.getTime();
      if (at > (lastMove.get(m.sessionId) ?? 0)) lastMove.set(m.sessionId, at);
    }
    const now = Date.now();
    const gone = abandonedSessions(
      open.map((s) => ({ ...s, lastMoveAt: lastMove.get(s.id) ?? s.startedAt.getTime() })),
      now,
      ABANDON_AFTER_MS,
    );
    for (const session of gone) {
      const last = session.lastMoveAt;
      const machine = await showStore.get(session.rundownId);
      const result = machine.apply("stop", undefined, now);
      if (typeof result === "string") continue; // already not live
      broadcast(session.rundownId, { v: PROTOCOL_VERSION, t: "show_state", ...result });
      showStore.persist(session.rundownId, result, "stop");
      const hours = Math.round((now - last) / 3_600_000);
      console.warn(`[sessions] ended abandoned session on ${session.rundownId} — no command for ${hours}h`);
    }
  } catch (err) {
    console.error("[sync] abandoned-session sweep failed:", err);
  } finally {
    sweeping = false;
  }
}
// Hourly. The threshold is a day, so the sweep's own resolution is irrelevant
// to when a session ends; it only decides how long after the day is up.
const abandonLoop = setInterval(() => void abandonedSessionSweep(), 60 * 60 * 1000);
abandonLoop.unref();
void abandonedSessionSweep();

const clockLoop = setInterval(() => void clockTick(), 1000);
clockLoop.unref();

// A client that sends its headers slowly, or a body slower still, is cut off
// instead of holding a connection open indefinitely. Two minutes covers a
// 24MB import on poor venue wifi.
httpServer.headersTimeout = 20_000;
httpServer.requestTimeout = 120_000;

httpServer.listen(PORT, () => {
  console.log(`[sync] api + show channel + /doc channel on :${PORT}  (protocol v${PROTOCOL_VERSION})`);
});
