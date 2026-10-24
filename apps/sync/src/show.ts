import { ulid } from "ulid";
import type { CmdAction, ShowStatePayload } from "@opencall/protocol";

/**
 * In-memory show-state machine, one per rundown. The server is the single
 * authority; every accepted command bumps `seq` (Phase 4 adds Postgres
 * write-through and transition persistence).
 */
export class ShowStateMachine {
  private state: ShowStatePayload = ShowStateMachine.idle(0);

  static idle(seq: number): ShowStatePayload {
    return {
      seq,
      state: "idle",
      sessionId: null,
      activeRowId: null,
      activeRowStartedAtMs: null,
      pausedAtMs: null,
      pausedAccumMs: 0,
      sessionStartedAtMs: null,
      clockFollow: false,
      walkRowId: null,
      playedRowIds: [],
    };
  }

  get current(): ShowStatePayload {
    return this.state;
  }

  /** Restore a persisted session (server restart resilience). */
  hydrate(state: ShowStatePayload): void {
    this.state = state;
  }

  /**
   * Apply a transport command. Returns the new state, or an error string.
   *
   * `startedAtMs` backdates the row's start. Three callers want it: the clock
   * follower, a sync-cue jump, and a Start the clock has already reached (it
   * opens on the clock's row). All are saying the same thing — the show
   * is where the SHEET says it is — and moving onto a row that way does NOT
   * mean the row has just begun. The sheet may say it started half an hour
   * ago, and recording it as beginning now makes the item countdown and the
   * show's drift both wrong by that amount.
   */
  apply(
    action: CmdAction,
    rowId: string | undefined,
    now = Date.now(),
    startedAtMs?: number,
    /**
     * `clock_on` only: the clock has not reached the sheet's first item yet,
     * so there is nothing it would have cued — clear the cue rather than let
     * the show carry on timing a row that has not begun. The server decides
     * this, because only the server can see the sheet's times.
     */
    clearCue = false,
  ): ShowStatePayload | string {
    const s = this.state;
    const next = (patch: Partial<ShowStatePayload>): ShowStatePayload => {
      this.state = { ...s, ...patch, seq: s.seq + 1 };
      return this.state;
    };

    switch (action) {
      case "start": {
        if (s.state === "running" || s.state === "paused") return "show already live";
        return next({
          state: "running",
          sessionId: ulid(),
          activeRowId: rowId ?? null,
          activeRowStartedAtMs: rowId != null ? (startedAtMs ?? now) : now,
          pausedAtMs: null,
          pausedAccumMs: 0,
          sessionStartedAtMs: now,
          walkRowId: null,
          playedRowIds: [],
        });
      }
      // Pre-show walkthrough: a shared cursor for rehearsing the sheet with
      // the crew. No timers, no session — just a highlight every device sees.
      case "walk": {
        if (s.state === "running" || s.state === "paused") return "show is live — use the transport";
        return next({ walkRowId: rowId ?? null });
      }
      case "pause": {
        if (s.state !== "running") return "not running";
        return next({ state: "paused", pausedAtMs: now });
      }
      case "resume": {
        if (s.state !== "paused") return "not paused";
        return next({
          state: "running",
          pausedAtMs: null,
          pausedAccumMs: s.pausedAccumMs + (now - (s.pausedAtMs ?? now)),
        });
      }
      case "next":
      case "prev":
      case "jump": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        // The row leaving air has been played. Recorded as it LEAVES, not as
        // it arrives, so the cue itself is never in the list and "played"
        // means exactly "was on air and is no longer".
        const leaving = s.activeRowId;
        const target = rowId ?? s.activeRowId;
        const playedRowIds =
          leaving && leaving !== target && !s.playedRowIds.includes(leaving) ? [...s.playedRowIds, leaving] : s.playedRowIds;
        // Row ordering lives in the doc; the caller supplies the target row id.
        return next({
          activeRowId: target,
          activeRowStartedAtMs: startedAtMs ?? now,
          pausedAccumMs: 0,
          pausedAtMs: s.state === "paused" ? now : null,
          playedRowIds,
        });
      }
      case "stop": {
        if (s.state === "idle" || s.state === "ended") return "not live";
        return next({ state: "ended", activeRowId: null, activeRowStartedAtMs: null, pausedAtMs: null, clockFollow: false });
      }
      // Server-driven clock-follow: while on (and the show is RUNNING, not
      // paused), the server's scheduler advances the active row along the
      // TIME column — no console needs to stay open. Pause holds the show.
      case "clock_on": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        /**
         * Handing the show to the clock hands it the cue as well — including
         * the case where the clock's answer is "nothing yet".
         *
         * This is the path that produced a show reporting itself four hours
         * ahead of itself: start (which cues the first item, correctly, since
         * with no follower a person is in charge), then switch the follower
         * on. The follower then had nothing to say, because a clock that has
         * not reached the sheet returns no target and the loop leaves the cue
         * alone — so the show sat timing an item that would not begin for
         * hours, and said so in red.
         *
         * ONLY when the clock has not reached the sheet at all. A cue that is
         * merely ahead of the clock mid-show is left exactly where it is: the
         * follower refuses to drag a running show backwards, deliberately, and
         * switching the follower on must not do what the follower itself would
         * not.
         */
        return next(
          clearCue
            ? { clockFollow: true, activeRowId: null, activeRowStartedAtMs: null, pausedAccumMs: 0 }
            : { clockFollow: true },
        );
      }
      case "clock_off": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        return next({ clockFollow: false });
      }
      // "fire" is handled by the server before the state machine — it logs to
      // the as-run record and never transitions state.
      case "unplay": {
        // "Play it again": the tick comes off, so Next and the clock offer the
        // row in its turn. Live only — ticks are a thing of a running show.
        if (s.state !== "running" && s.state !== "paused") return "not live";
        if (!rowId || !s.playedRowIds.includes(rowId)) return s;
        return next({ playedRowIds: s.playedRowIds.filter((id) => id !== rowId) });
      }
      case "mark_played": {
        // A row the show stepped over, ticked by hand so it never comes back
        // as "next". The cue itself cannot be ticked — it is on air.
        if (s.state !== "running" && s.state !== "paused") return "not live";
        if (!rowId || rowId === s.activeRowId || s.playedRowIds.includes(rowId)) return s;
        return next({ playedRowIds: [...s.playedRowIds, rowId] });
      }
      case "fire":
        return "fire is not a state transition";
    }
  }
}

/**
 * A command from a PERSON, with the clock rules around it (21 Oct, Robert:
 * "shouldn't being live follow the clock regardless?" — decided: a live show
 * follows the clock by default, and Next takes over).
 *
 *  · `start` hands the show to the clock straight away — the same `clock_on`
 *    the old Follow clock button sent, with its `clearCue` when the clock has
 *    not reached the sheet yet, so the show waits on its countdown.
 *  · `next`, `prev` or `jump` from a person while the clock has the show
 *    takes it back by hand first (`clock_off`): pressing Next means "I am
 *    calling this now". "Back to clock" hands it back.
 *
 * The server's own follower moves the show with `machine.apply` directly and
 * never comes through here, so it cannot switch itself off.
 *
 * Returns every transition that happened, in order, for broadcasting and the
 * as-run record — or the refusal, with nothing changed.
 */
export function applyAsPerson(
  machine: ShowStateMachine,
  action: CmdAction,
  rowId: string | undefined,
  opts: { now?: number; startedAtMs?: number; clearCue?: boolean; clockNotReached?: boolean } = {},
): { action: CmdAction; state: ShowStatePayload }[] | string {
  const now = opts.now ?? Date.now();
  const steps: { action: CmdAction; state: ShowStatePayload }[] = [];
  const live = machine.current.state === "running" || machine.current.state === "paused";
  if ((action === "next" || action === "prev" || action === "jump") && live && machine.current.clockFollow) {
    const off = machine.apply("clock_off", undefined, now);
    if (typeof off !== "string") steps.push({ action: "clock_off", state: off });
  }
  const result = machine.apply(action, rowId, now, opts.startedAtMs, opts.clearCue ?? false);
  if (typeof result === "string") return result;
  steps.push({ action, state: result });
  if (action === "start") {
    const on = machine.apply("clock_on", undefined, now, undefined, opts.clockNotReached ?? false);
    if (typeof on !== "string") steps.push({ action: "clock_on", state: on });
  }
  return steps;
}

/**
 * How long until the clock should next look: just after the coming whole
 * second (22 Oct 2026).
 *
 * Printed times are whole seconds, so an item is due on the turn of a second.
 * The clock used to look once a second counted from whenever the server
 * started, and Node's timer drifts as it goes: on one server, unrestarted, it
 * looked 0.8 s after each second during one test show and 0.2 s after five
 * minutes later. The show record was exact either way (a clock move is dated
 * to when the item was due), but every screen showed the cue change that much
 * late, and a test of the bars failed on it by a tenth of a second.
 *
 * `afterMs` makes sure the second has turned when it looks — a timer can fire
 * a millisecond early, and the scheduler waits out one that does. It was 20 ms
 * until 24 Oct, which was most of the time between a bar reaching its end and
 * the cue moving on (measured on a production build: 33–39 ms in all).
 */
export const msUntilClockTick = (nowMs: number, afterMs = 3): number => 1000 - (nowMs % 1000) + afterMs;
