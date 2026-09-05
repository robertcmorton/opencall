import { and, eq, ne } from "drizzle-orm";
import { ulid } from "ulid";
import type { CmdAction, ShowStatePayload } from "@opencall/protocol";
import { schema, type DbHandle } from "@opencall/db";
import { ShowStateMachine } from "./show";

/**
 * Show-state machines with Postgres write-through: every accepted command
 * upserts `show_sessions` and appends `show_transitions` (the as-run log) in
 * one transaction, so the record can never advance without its as-run entry.
 * On first access after a restart, any non-ended session is hydrated back.
 * Writes are chained per rundown so they land in command order.
 */
export class PersistentShowStore {
  private machines = new Map<string, ShowStateMachine>();
  private loaded = new Set<string>();
  private writeChains = new Map<string, Promise<void>>();

  constructor(private handle: DbHandle) {}

  async get(rundownId: string): Promise<ShowStateMachine> {
    let machine = this.machines.get(rundownId);
    if (!machine) {
      machine = new ShowStateMachine();
      this.machines.set(rundownId, machine);
    }
    if (!this.loaded.has(rundownId)) {
      this.loaded.add(rundownId);
      const row = await this.handle.db.query.showSessions.findFirst({
        where: and(eq(schema.showSessions.rundownId, rundownId), ne(schema.showSessions.state, "ended")),
      });
      if (row) {
        machine.hydrate({
          seq: row.seq,
          state: row.state,
          sessionId: row.id,
          activeRowId: row.activeRowId,
          activeRowStartedAtMs: row.activeRowStartedAt?.getTime() ?? null,
          pausedAtMs: row.pausedAt?.getTime() ?? null,
          pausedAccumMs: row.pausedAccumMs,
          sessionStartedAtMs: row.startedAt.getTime(),
          clockFollow: row.clockFollow,
          playedRowIds: row.playedRowIds ?? [],
          walkRowId: null,
        });
      }
    }
    return machine;
  }

  /**
   * Logs a fired pool cue into the as-run record of the live session without
   * touching the state machine. No-op when no session is live.
   */
  async logFire(rundownId: string, label: string): Promise<boolean> {
    const machine = await this.get(rundownId);
    const { sessionId, state } = machine.current;
    if (!sessionId || (state !== "running" && state !== "paused")) return false;
    await this.handle.db.insert(schema.showTransitions).values({
      id: ulid(),
      sessionId,
      at: new Date(),
      type: "fire",
      rowId: label,
    });
    return true;
  }

  /** Queue the DB write-through for an accepted command. Walkthrough moves
   *  ("walk") are rehearsal, not history — they are never persisted, and the
   *  type says so. */
  persist(rundownId: string, state: ShowStatePayload, action: Exclude<CmdAction, "walk">, rowId?: string): void {
    const prev = this.writeChains.get(rundownId) ?? Promise.resolve();
    const next = prev
      .then(() => this.write(rundownId, state, action, rowId))
      .catch((err) => console.error("[sync] session persist failed:", err));
    this.writeChains.set(rundownId, next);
  }

  /**
   * Wait for every queued write to land.
   *
   * `persist` is deliberately fire-and-forget — a transport command must not
   * wait on Postgres, because the showcaller pressed a button and the sheet
   * has to move now. The cost is that at any instant there may be a write in
   * flight that nobody is awaiting, and on shutdown that write is racing the
   * database being closed underneath it.
   *
   * Which is a real loss, not a tidy-up: the row that was just cued, or the
   * fact that the show was stopped. A deploy sends SIGTERM, the process exits
   * in milliseconds, and the sheet comes back pointing at the previous item.
   *
   * `allSettled`, not `all`: a chain that has already failed has logged, and
   * one bad rundown must not stop the others from finishing.
   */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.writeChains.values()]);
  }

  private async write(rundownId: string, state: ShowStatePayload, action: Exclude<CmdAction, "walk">, rowId?: string): Promise<void> {
    const { db } = this.handle;
    // Read once into a const: the two statements below run inside a closure,
    // where TypeScript drops the narrowing on a property access.
    const sessionId = state.sessionId;
    if (!sessionId) return;
    const values = {
      id: sessionId,
      rundownId,
      state: state.state === "idle" ? ("ended" as const) : state.state,
      activeRowId: state.activeRowId,
      activeRowStartedAt: state.activeRowStartedAtMs != null ? new Date(state.activeRowStartedAtMs) : null,
      pausedAt: state.pausedAtMs != null ? new Date(state.pausedAtMs) : null,
      pausedAccumMs: state.pausedAccumMs,
      startedAt: new Date(state.sessionStartedAtMs ?? Date.now()),
      endedAt: state.state === "ended" ? new Date() : null,
      seq: state.seq,
      clockFollow: state.clockFollow,
      playedRowIds: state.playedRowIds,
    };
    /**
     * One transaction, because the two rows are one fact. The session row says
     * where the show is; the transition says how it got there, and that as-run
     * entry is the record of what happened on air. Written separately, anything
     * that ends the process between the two statements — SIGKILL, an OOM kill,
     * a throw inside the second insert — leaves a session claiming row 12 with
     * nothing saying it was ever cued. `flush()` covers the orderly SIGTERM
     * case only; it cannot do anything about the gap between two statements.
     *
     * Nothing else in this repo uses a transaction, so both drivers were
     * checked: node-postgres takes a dedicated client out of the pool for the
     * duration, and PGlite (the dev database) runs `transaction()` behind the
     * same exclusive lock as every other query, so a concurrent write for a
     * different rundown queues rather than interleaving a second BEGIN on the
     * one connection.
     *
     * The caller's contract is unchanged: drizzle rolls back and rethrows, so
     * `write` still rejects exactly where it used to and `persist`'s existing
     * catch logs it. What changes is that a failed transition no longer leaves
     * the session row advanced — both rows are lost together, and the next
     * accepted command re-upserts the session row from the live machine.
     */
    await db.transaction(async (tx) => {
      await tx
        .insert(schema.showSessions)
        .values(values)
        .onConflictDoUpdate({ target: schema.showSessions.id, set: values });
      await tx.insert(schema.showTransitions).values({
        id: ulid(),
        sessionId,
        at: new Date(),
        type: action,
        rowId: rowId ?? state.activeRowId,
      });
    });
  }
}

/**
 * How long a session may go without a command before it is treated as
 * abandoned rather than quiet.
 *
 * The dashboard flags a session "stale" at SIX hours and deliberately stops
 * there, because ending somebody's show from a timer would stop a real one
 * sitting through a long interval. That reasoning holds at six hours and stops
 * holding at twenty-four: nothing this app is for runs for a day without a
 * single command, and a forgotten session is not free — one live session is
 * allowed per rundown, so it BLOCKS the next real show on that sheet.
 */
export const ABANDON_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Which open sessions have been abandoned, given when each last moved.
 *
 * Separated from the sweep that acts on it so the rule can be checked without
 * a database, a server or a clock — the same reason the access rules live in
 * `scope.ts`. The sweep's job is then only to fetch, call this, and stop what
 * it names.
 *
 * `lastMoveAt` is the newest command in the as-run log, or the session's start
 * for one that never moved at all. That is the same measure the dashboard's
 * stale chip uses, so the two can never disagree about which session is quiet.
 */
export function abandonedSessions<T extends { id: string; lastMoveAt: number }>(
  open: readonly T[],
  nowMs: number,
  afterMs: number = ABANDON_AFTER_MS,
): T[] {
  return open.filter((s) => nowMs - s.lastMoveAt >= afterMs);
}
