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
    // Lift the wall clock into the SHEET's frame before comparing.
    //
    // `startSec` counts past midnight — 86400 is midnight of the second day —
    // while the clock wraps to zero. Subtracting one from the other across a
    // rollover produced exactly the day it had crossed: a show sitting right
    // on its cue read "-24:00:00", on the readout a caller uses to know
    // whether they are late. Measured on a 48-hour sheet at 00:00:38: +00:00
    // before midnight, -24:00:00 after.
    //
    // The day is chosen by nearness, not by a single +1 — a three-day sheet
    // is two days out by the end. A row starts within hours of its planned
    // time, never a day from it, so the nearest offset is the right one.
    const wallSec = toSecondsOfDay(activeRowStartedAtMs);
    const actualStartSec = wallSec + Math.round((active.startSec - wallSec) / 86400) * 86400;
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
  /**
   * The last row of this game's endings, across every branch. -1 when the
   * sheet does not say. Once the show is past it the result is history.
   */
  lastEndingIndex: number;
  /** How long before the end to ask. */
  bufferSec: number;
}

export function resultDueNow(input: ResultDueInput): boolean {
  const {
    liveIndex,
    firstEndingIndex,
    lastExtraIndex,
    extraPlaying,
    remainingInRowSec,
    notBeforeIndex,
    called,
    lastEndingIndex,
    bufferSec,
  } = input;

  // Called already: keep the chooser up while the show is still IN the
  // endings, so a wrong call can be reset and the screen keeps saying what was
  // called. Once the chosen ending has played out and the show has moved past
  // the whole block, the decision is history and the bar is only taking up a
  // strip of a live screen. It used to stay for the rest of the day.
  if (called) {
    if (lastEndingIndex < 0 || liveIndex < 0) return true;
    return liveIndex <= lastEndingIndex;
  }
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

/** One row that carries words to be read aloud, with its place in the sheet. */
export interface ReadRow {
  id: string;
  /** Index of this row in the FULL sheet, not among the reads. */
  index: number;
}

export interface FollowReadInput {
  /** Index of the live cue in the full sheet; -1 when no show is running. */
  liveIndex: number;
  /** The reads, in sheet order. */
  reads: ReadRow[];
}

export interface FollowRead {
  /** A read that is on air right now — the live cue IS this read. */
  onAirId: string | null;
  /** What the prompter should be showing: on air, else the next one coming. */
  followId: string | null;
}

/**
 * Which read the prompter should be sitting on.
 *
 * The prompter renders only the rows to be READ — a handful out of a whole
 * sheet — so "scroll to the live cue" finds nothing for almost the entire
 * show. It followed on the rare tick when the cue happened to be a read, and
 * sat still through everything else while reporting that it was following.
 *
 * What the person holding it needs is the next thing they have to say. So:
 * the read on air if the show is on one, otherwise the first read at or after
 * where the show has got to; and once every read is behind us, the last one —
 * holding the words just read rather than snapping back to the top of the day.
 */
export function followRead(input: FollowReadInput): FollowRead {
  const { liveIndex, reads } = input;
  if (liveIndex < 0 || reads.length === 0) return { onAirId: null, followId: null };

  const onAir = reads.find((r) => r.index === liveIndex);
  if (onAir) return { onAirId: onAir.id, followId: onAir.id };

  const upcoming = reads.find((r) => r.index >= liveIndex);
  return { onAirId: null, followId: upcoming?.id ?? reads[reads.length - 1]!.id };
}

export interface SecondsUntilInput {
  /** Planned duration of every row, in sheet order. Skipped rows are 0. */
  durationsSec: number[];
  /** Index of the live cue; -1 when nothing is running. */
  liveIndex: number;
  /** Index of the row we are counting down to. */
  targetIndex: number;
  /**
   * Seconds left in the live row, from the live clock. Negative when it has
   * run over — the show is late, and what is next starts when it is called,
   * so an overrun contributes nothing rather than counting backwards.
   */
  remainingInRowSec: number | null;
}

/**
 * How long until a row goes on.
 *
 * For the prompter this is the only number that matters: not the clock time a
 * read is due, which is a plan, but how long the person holding the script has
 * before they are on camera. So it is measured from the show's ACTUAL position
 * — what is left of the row on air, then every planned row between here and
 * there.
 *
 * Null when there is nothing to count: no show running, or the row is already
 * on air or behind us.
 */
export function secondsUntilRow(input: SecondsUntilInput): number | null {
  const { durationsSec, liveIndex, targetIndex, remainingInRowSec } = input;
  if (liveIndex < 0 || targetIndex < 0 || targetIndex >= durationsSec.length) return null;
  if (targetIndex <= liveIndex) return null;

  // An overrun does not push the next item further away.
  let total = Math.max(0, remainingInRowSec ?? 0);
  for (let i = liveIndex + 1; i < targetIndex; i++) total += Math.max(0, durationsSec[i] ?? 0);
  return total;
}

export interface ClockTargetRow {
  id: string;
  type: string;
  skipped?: boolean;
  untimed?: boolean;
  hardStartSec?: number | null;
}

/**
 * The row the event's clock is standing on: the last one whose planned start
 * has passed.
 *
 * Groups are headings, skipped rows are not happening, and an untimed row with
 * no hard start has no moment to have passed. `nowAbsSec` is counted past
 * midnight like the sheet — a wall clock resets at 00:00 and a show running
 * into the small hours does not.
 */
export function clockTargetRow(
  rows: readonly ClockTargetRow[],
  startSecs: readonly (number | null)[],
  nowAbsSec: number,
): string | null {
  let target: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.type === "group" || r.skipped) continue;
    if (r.untimed && r.hardStartSec == null) continue;
    const start = startSecs[i] ?? null;
    if (start != null && start <= nowAbsSec) target = r.id;
  }
  return target;
}
