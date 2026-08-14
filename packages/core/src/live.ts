import { OUT_OF_ORDER_SEC } from "./timing";
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

  /**
   * How long this row is meant to last.
   *
   * Its own duration, when the sheet gives it one. When it does not, the row
   * runs until the next one starts — which the sheet DOES say, by anchoring
   * that next row to a time.
   *
   * Without this, a row with no duration is treated as zero seconds long, so
   * every second spent on it is overrun. That is wrong for exactly the rows it
   * matters most on: a period of play. "STANDBY FOR HALF TIME" covers the
   * forty minutes of a first half and carries no duration, because no sheet
   * writes one for a game. Twelve minutes into the half, a show sitting
   * precisely where the clock said it should be reported itself twelve
   * minutes behind, with its projected end pushed out to match — and by the
   * hooter it would have claimed forty.
   *
   * Only the gap to the NEXT row is used, never a guess: if the next row is
   * unanchored it inherits this row's start, the gap is zero, and nothing
   * changes.
   */
  const nextStart = timing.rows[index + 1]?.startSec ?? null;
  const implied =
    active.effectiveDurationSec === 0 && active.startSec != null && nextStart != null && nextStart > active.startSec
      ? nextStart - active.startSec
      : active.effectiveDurationSec;

  const planned = implied;
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
  /**
   * The latest start seen so far, so a row that contradicts the sheet's order
   * cannot become the clock's target.
   *
   * "The last row whose start has passed" assumes the sheet runs forwards, and
   * it does — until one cell is wrong. A real sheet had "5:26:00 am" typed for
   * a bell at row 13, between rows at 5:25 PM and 5:26 PM. Its time has
   * "passed" from twenty-six minutes after five in the morning onward, and it
   * sits further down the sheet than anything genuinely current, so it won an
   * afternoon outright: pressing Follow clock parked the show on a bell twelve
   * hours out of place and every readout on the page went with it.
   *
   * The tolerance is the same one the timing check uses, and it was measured
   * the same way — legitimate rows are listed 1 to 22 minutes out of order,
   * mistakes by twelve hours.
   */
  let highWater = -Infinity;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.type === "group" || r.skipped) continue;
    if (r.untimed && r.hardStartSec == null) continue;
    const start = startSecs[i] ?? null;
    if (start == null) continue;
    if (start < highWater - OUT_OF_ORDER_SEC) continue;
    highWater = Math.max(highWater, start);
    if (start <= nowAbsSec) target = r.id;
  }
  return target;
}

/** One row's window on the clock, for working out what runs with what. */
export interface WindowRow {
  id: string;
  type: string;
  skipped?: boolean;
  /** Alternate ending this row belongs to — branches are alternatives, not concurrency. */
  outcome?: string | null;
  outcomeGame?: number;
  /** Shot alongside the running order — always concurrent by definition. */
  parallel?: boolean;
}

/** A set of rows whose times genuinely overlap, in sheet order. */
export interface ConcurrentGroup {
  /** Indexes of the rows that are on together, ascending. */
  indexes: number[];
  /** When the first of them starts and the last of them ends. */
  startSec: number;
  endSec: number;
}

/**
 * Every place the sheet has more than one thing happening at once.
 *
 * A run sheet is not a queue. A pre-record is shot while the game is on, an
 * announcer reads over a music bed, a sponsor activation runs through a
 * quarter. Read as a queue those rows look like faults — each one appears to
 * start before the row above it has finished — and the app had only one word
 * for that, "overlap", which means "somebody has made a mistake".
 *
 * Overlapping is a fact about the sheet; whether it is a mistake is a
 * judgement about the sheet. This reports the fact. It is what lets a
 * progress bar advance along several rows at once, and what lets the timing
 * check offer "these run together" as an answer rather than only "one of
 * these numbers is wrong".
 *
 * Rows that merely TOUCH — one ending exactly where the next begins, which is
 * every ordinary row in a chained sheet — are not concurrent. Alternate
 * endings are not concurrent either: only one of them is ever played, and
 * they share a start precisely because they are alternatives.
 */
export function findConcurrentRows(
  rows: readonly WindowRow[],
  timing: PlanTiming,
): ConcurrentGroup[] {
  const window = (i: number): { i: number; start: number; end: number } | null => {
    const r = rows[i];
    const t = timing.rows[i];
    if (!r || !t || r.skipped || r.type === "group") return null;
    if (t.startSec == null) return null;
    const end = t.endSec ?? t.startSec;
    if (end <= t.startSec) return null; // a moment cannot overlap anything
    return { i, start: t.startSec, end };
  };
  /** Two branches of the same game are alternatives; they never run together. */
  const alternatives = (a: WindowRow, b: WindowRow): boolean =>
    !!a.outcome && !!b.outcome && (a.outcomeGame ?? 1) === (b.outcomeGame ?? 1) && a.outcome !== b.outcome;

  // BY START, not by sheet position. A pre-record is written where it belongs
  // in the reading order — after the block it was shot during, or before —
  // and sweeping in sheet order let a row be tested against a window that had
  // not opened yet: a pre-record ending at 5:46 was grouped with a buffer
  // starting at 6:10 purely because the buffer had been seen first.
  const wins = [...rows.keys()]
    .map(window)
    .filter((w): w is { i: number; start: number; end: number } => w !== null)
    .sort((a, b) => a.start - b.start || a.i - b.i);

  const groups: ConcurrentGroup[] = [];
  let current: typeof wins = [];
  let currentEnd = -Infinity;
  const flush = () => {
    if (current.length > 1) {
      groups.push({
        indexes: current.map((w) => w.i).sort((a, b) => a - b),
        startSec: Math.min(...current.map((w) => w.start)),
        endSec: currentEnd,
      });
    }
  };

  for (const w of wins) {
    // Sorted by start, so anything still open when this one begins genuinely
    // overlaps it. Touching exactly — one ending where the next begins, which
    // is every ordinary row of a chained sheet — is not overlapping.
    const joins =
      current.length > 0 &&
      w.start < currentEnd - 0.001 &&
      current.some((m) => m.end > w.start + 0.001 && !alternatives(rows[m.i]!, rows[w.i]!));
    if (joins) {
      current.push(w);
      currentEnd = Math.max(currentEnd, w.end);
      continue;
    }
    flush();
    current = [w];
    currentEnd = w.end;
  }
  flush();
  return groups;
}

/**
 * Which rows are ON at this moment — the live cue and anything running with it.
 *
 * The progress bar used to be a property of "the" active row, because there
 * was only ever one. There is not: at 7:02 the coin toss is being recorded in
 * the tunnel while the second half is being played, and both are running.
 */
export function rowsOnAt(
  rows: readonly WindowRow[],
  timing: PlanTiming,
  nowAbsSec: number,
): string[] {
  const on: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const t = timing.rows[i];
    if (!t || r.skipped || r.type === "group" || t.startSec == null) continue;
    const end = t.endSec ?? t.startSec;
    if (end <= t.startSec) continue;
    if (t.startSec <= nowAbsSec && nowAbsSec < end) on.push(r.id);
  }
  return on;
}
