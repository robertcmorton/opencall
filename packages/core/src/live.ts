import type { PlanTiming } from "./types";

export interface LiveShowInput {
  /** Planned timing for the rundown (computeTiming output). */
  timing: PlanTiming;
  /** Planned duration of the active row (effective seconds). */
  activeRowId: string;
  /** Server-clock ms when the active row started. */
  activeRowStartedAtMs: number;
  /** Accumulated paused ms inside the active row. */
  pausedAccumMs: number;
  /** Ms frozen at pause time, null while running. */
  pausedAtMs: number | null;
  /** Current server-clock ms (Date.now() + measured offset). */
  nowMs: number;
  /** Converts server-clock ms → seconds since local midnight (show timezone). */
  toSecondsOfDay: (ms: number) => number;
}

export interface LiveShowTiming {
  /** Seconds spent in the active row (pause-adjusted). */
  elapsedInRowSec: number;
  /** Planned duration minus elapsed; negative once over. */
  remainingInRowSec: number | null;
  /** How far over the active row is running (0 while under). */
  rowOverSec: number;
  /**
   * Cumulative show drift: how late (+) or early (−) the show is running,
   * measured at the active row's actual vs planned start, plus any overrun
   * inside the active row. Null when the active row has no planned start.
   */
  showDriftSec: number | null;
  /** Planned end shifted by the current drift. */
  projectedEndSec: number | null;
}

/** All countdown math is local: derived from timestamps, never from streamed ticks. */
export function computeLiveTiming(input: LiveShowInput): LiveShowTiming | null {
  const { timing, activeRowId, activeRowStartedAtMs, pausedAccumMs, pausedAtMs, nowMs, toSecondsOfDay } = input;
  const index = timing.rows.findIndex((r) => r.id === activeRowId);
  if (index < 0) return null;
  const active = timing.rows[index]!;

  const effectiveNowMs = pausedAtMs ?? nowMs;
  const elapsedInRowSec = Math.max(0, (effectiveNowMs - activeRowStartedAtMs - pausedAccumMs) / 1000);

  const planned = active.effectiveDurationSec;
  const remainingInRowSec = planned > 0 || active.startSec != null ? planned - elapsedInRowSec : null;
  const rowOverSec = Math.max(0, elapsedInRowSec - planned);

  let showDriftSec: number | null = null;
  let projectedEndSec: number | null = null;
  if (active.startSec != null) {
    const actualStartSec = toSecondsOfDay(activeRowStartedAtMs);
    showDriftSec = actualStartSec - active.startSec + rowOverSec;
    if (timing.endSec != null) projectedEndSec = timing.endSec + showDriftSec;
  }

  return { elapsedInRowSec, remainingInRowSec, rowOverSec, showDriftSec, projectedEndSec };
}

/** Default show-timezone mapping: local seconds since midnight. */
export function localSecondsOfDay(ms: number): number {
  const d = new Date(ms);
  return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
}

/**
 * When the result chooser is due.
 *
 * Pulled out of the show screen because it is a rule about a live moment with
 * a thirty-second boundary in it, and the only way to check that in a browser
 * is to sit and watch a clock — which is exactly the kind of test that gets
 * run once and never again.
 *
 * The shape of the rule: the chooser is a bar across the foot of a live
 * screen. Up for the whole second half it is just something covering rows, so
 * it appears for the last half-minute of whatever is running into the
 * decision, and not before.
 */
export interface ResultDueInput {
  /** Where the live cue is in the sheet. */
  liveIndex: number;
  /** The first row of this game's endings. */
  firstEndingIndex: number;
  /** The last row of the extra period, when one is being played. */
  lastExtraIndex: number;
  /** The extra period is in the running order and under way. */
  extraPlaying: boolean;
  /** Seconds left on the row that is on air; null when it has no duration. */
  remainingInRowSec: number | null;
  /**
   * The period before which a result cannot be asked for at all — the second
   * half, the final quarter. -1 when the sheet does not name one.
   */
  notBeforeIndex: number;
  /** A result has already been called for this game. */
  called: boolean;
  /** How long before the end to ask. */
  bufferSec: number;
}

export function resultDueNow(input: ResultDueInput): boolean {
  const { liveIndex, firstEndingIndex, lastExtraIndex, extraPlaying, remainingInRowSec, notBeforeIndex, called, bufferSec } =
    input;

  // Called already: the chooser stays, so it can be reset and so the screen
  // keeps saying what was called.
  if (called) return true;
  if (liveIndex < 0 || firstEndingIndex < 0) return false;

  // Negative counts as due: a half that has run over is past the point of
  // asking, not before it.
  const withinBuffer = remainingInRowSec != null && remainingInRowSec <= bufferSec;

  // The extra period is under way, so the question is the SECOND layer and it
  // is due at the END of that period — not for the whole twenty minutes of it.
  if (extraPlaying) {
    if (lastExtraIndex < 0) return true;
    if (liveIndex > lastExtraIndex) return true; // past it: it must be callable
    return liveIndex === lastExtraIndex && withinBuffer;
  }

  // Past the point where the endings begin with nothing called: the chooser
  // has to be there, or there is no way to call the result at all.
  if (liveIndex >= firstEndingIndex) return true;
  // Not before the period in which a result is possible. A sheet with an ad
  // break between the second half and the endings would otherwise be asked
  // for the result at the end of the ad break.
  if (notBeforeIndex >= 0 && liveIndex < notBeforeIndex) return false;
  // Otherwise: only on the row running into the endings, in its last seconds.
  return liveIndex === firstEndingIndex - 1 && withinBuffer;
}
