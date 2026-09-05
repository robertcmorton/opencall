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
   * `startedAtMs` backdates the row's start. Two callers want it: the clock
   * follower, and a sync-cue jump. Both are saying the same thing — the show
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
          activeRowStartedAtMs: now,
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
