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
      clockHold: false,
      walkRowId: null,
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
        // Row ordering lives in the doc; the caller supplies the target row id.
        return next({
          activeRowId: rowId ?? s.activeRowId,
          activeRowStartedAtMs: startedAtMs ?? now,
          pausedAccumMs: 0,
          pausedAtMs: s.state === "paused" ? now : null,
        });
      }
      case "stop": {
        if (s.state === "idle" || s.state === "ended") return "not live";
        return next({ state: "ended", activeRowId: null, activeRowStartedAtMs: null, pausedAtMs: null, clockFollow: false, clockHold: false });
      }
      // Server-driven clock-follow: while on (and the show is RUNNING, not
      // paused), the server's scheduler advances the active row along the
      // TIME column — no console needs to stay open. Pause holds the show.
      case "clock_on": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        // Turning it back on always starts unheld — a hold is a moment, not a
        // setting, and inheriting one from an hour ago would look like a fault.
        return next({ clockFollow: true, clockHold: false });
      }
      case "clock_off": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        return next({ clockFollow: false, clockHold: false });
      }
      // Take the wheel without giving up clock-follow. Pause stops the SHOW —
      // the item clock freezes and everyone downstream sees a held show. This
      // stops only the automatic advance: the show runs on, the timers run on,
      // and the showcaller steps the cue with Next. Releasing hands it back,
      // and the clock picks the show up wherever it now is.
      case "clock_hold": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        if (!s.clockFollow) return "the clock is not driving this show";
        return next({ clockHold: true });
      }
      case "clock_release": {
        if (s.state !== "running" && s.state !== "paused") return "not live";
        if (!s.clockFollow) return "the clock is not driving this show";
        return next({ clockHold: false });
      }
      // "fire" is handled by the server before the state machine — it logs to
      // the as-run record and never transitions state.
      case "fire":
        return "fire is not a state transition";
    }
  }
}
