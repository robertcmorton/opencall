import { OUT_OF_ORDER_SEC } from "./timing";
import type { PlanTiming } from "./types";
import { isOpenEndedPeriodRow } from "./goldenPoint";

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
  /**
   * WHICH ROW these numbers describe.
   *
   * Without it a reader cannot tell whether what it is holding is still about
   * the row on screen. It usually is; for up to a second after the show moves
   * on it is not, because the active row changes the moment the server says so
   * while these are recomputed on their own beat. In that window the previous
   * row's elapsed was being divided by the new row's length, which on a sheet
   * of short items pins the progress bar full — so every handover showed a
   * finished bar, held it, and then dropped back to nothing.
   */
  rowId: string;
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

  return { rowId: activeRowId, elapsedInRowSec, remainingInRowSec, rowOverSec, showDriftSec, projectedEndSec };
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
  /**
   * The first row of the SUDDEN-DEATH stretch of the extra period — the part
   * the first score ends. -1 when the extra period is played out in full.
   *
   * In the regular season that is the whole of golden point, so this is the
   * block's first playing row. In a final the ten minutes of extra time are
   * played out whatever the score and only the unlimited period after them is
   * sudden death, so this points at that row instead.
   */
  suddenDeathFromIndex?: number;
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
    suddenDeathFromIndex = -1,
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
    /**
     * SUDDEN DEATH IS THE EXCEPTION, and it is most of the extra time this app
     * will ever see. Golden point ends on the first score: a try goes down in
     * the second minute and the match is over, with nine minutes of block still
     * printed below the cue. Waiting for the last half-minute of the last row
     * would leave the one result that actually happened uncallable for as long
     * as it took somebody to notice and cue past it.
     *
     * So inside a period the first score ends, the chooser is up throughout.
     * The cost is real and is why this is not simply the rule everywhere: the
     * chooser is a bar across the foot of a live screen, and it is now covering
     * rows for up to ten minutes. Extra time that is PLAYED OUT keeps the late
     * rule, because a score in the second minute of it settles nothing.
     */
    if (suddenDeathFromIndex >= 0 && liveIndex >= suddenDeathFromIndex) return true;
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
  /** Runs alongside the order — never becomes the cue. See `PlanRow.parallel`. */
  parallel?: boolean;
  /** The row's words, for telling an open-ended period from a caption. */
  title?: string;
}

/**
 * Could the show ever stand on this row?
 *
 * A heading is not an item, a skipped row is not happening, and an untimed row
 * with no hard start has no moment to arrive at. Two of the exclusions cost
 * real shows to find:
 *
 * A SECOND TRACK is never cued — not by the transport, and not by the clock
 * either. A pre-record runs and finishes on its own; parking the show on one
 * would take the running order off air to watch it.
 *
 * NEITHER IS A MILESTONE. It is a reminder with a time on it — team sheets
 * due, comms check, doors — something the showcaller has to GET DONE by then.
 * It is not an item that goes to air and there is nothing to call, so it has
 * no business becoming the cue. It did, and the damage was not only the wrong
 * row highlighted: a milestone carries no duration, so a show parked on one
 * can only ever read as overrunning. The big timer took its name, counted up
 * and went red, while the item actually on air kept running below with nothing
 * pointing at it — three rows signalling at once and none of them the show.
 * Reported on a real sheet where a deadline listed at 6:30 PM sat between rows
 * at 7:06 and 7:02: late enough in the sheet, and early enough on the clock,
 * to beat the second half that was genuinely on air.
 *
 * One predicate, because the answer has to be the same everywhere. "Which row
 * does the clock want" and "which row does the show open on" are the same
 * question asked at two moments, and two copies of this list would drift the
 * first time a sixth kind of row appeared.
 */
export function cueable(r: ClockTargetRow): boolean {
  if (r.type === "group" || r.type === "milestone") return false;
  if (r.skipped || r.parallel) return false;
  if (r.untimed && r.hardStartSec == null) return false;
  return true;
}

/**
 * The first row the show can open on, and when it is due.
 *
 * Needed because "start the show" and "start the first item" are not the same
 * instruction, and treating them as one is how a sheet whose first cue is at
 * 8pm ends up counting that item as on air from 11am — nine hours of a timer
 * that says the show is running late before anybody has arrived.
 *
 * Returns null when no row qualifies or none carries a start, which is a sheet
 * with no scheduled beginning: the show opens whenever somebody says it does,
 * and there is nothing to count down to.
 */
export function firstCueRow(
  rows: readonly ClockTargetRow[],
  startSecs: readonly (number | null)[],
): { id: string; index: number; startSec: number } | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!cueable(r)) continue;
    const startSec = startSecs[i] ?? null;
    if (startSec == null) continue;
    return { id: r.id, index: i, startSec };
  }
  return null;
}

/**
 * How long until the show is due to begin, or null if it is already due.
 *
 * Null means "no reason to wait" — the first cue's time has arrived, or the
 * sheet never gave one. Both are the same answer to the only question the
 * caller is asking: is there still something to count down to?
 */
export function secondsUntilShow(
  rows: readonly ClockTargetRow[],
  startSecs: readonly (number | null)[],
  nowAbsSec: number,
): number | null {
  const first = firstCueRow(rows, startSecs);
  if (first == null) return null;
  const wait = first.startSec - nowAbsSec;
  return wait > 0 ? wait : null;
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
/**
 * What the clock should do when the sheet gives it nothing to aim at.
 *
 * `clockTargetRow` only ever answers with a row the sheet gave a TIME. That is
 * right for choosing between printed rows and wrong for getting through the
 * ones with no time at all, which is what extra time is made of: nobody knows
 * when golden point will happen, so nobody writes a time against it.
 *
 * The consequence was severe and was reported four ways at once. Call golden
 * point on a live show and the cue stays on the second half, because the block
 * beneath it is invisible to the clock — so the half runs over, its bar pins
 * full and turns red, the big timer counts up in red, and the result chooser
 * never returns, because it comes back when the cue reaches the LAST row of
 * the extra period and the cue never gets there. Then the clock reaches the
 * next match's first printed row and jumps to it, carrying the show out of the
 * game with the result still uncalled and no way left to call it.
 *
 * So: a row with no printed time is played for its LENGTH, which is the only
 * honest thing it has, and the clock may not step over one that has not been
 * played. A row with no time AND no length stops the clock and waits for a
 * person — the sheet is saying "this takes as long as it takes", and guessing
 * would be worse than holding.
 */
export type ClockStep =
  | { kind: "clock" }
  | { kind: "hold"; reason: "running" | "unknowable" }
  | { kind: "advance"; rowId: string };

export function clockStep(
  rows: readonly ClockTargetRow[],
  durations: readonly (number | null)[],
  activeRowId: string | null,
  elapsedInRowSec: number,
): ClockStep {
  if (!activeRowId) return { kind: "clock" };
  const at = rows.findIndex((r) => r.id === activeRowId);
  if (at < 0) return { kind: "clock" };
  /**
   * `cueable` is the wrong test here, and deliberately so: it excludes rows the
   * sheet never timed, because the CLOCK can never aim at one. This function
   * exists precisely to play those rows, so it asks the other question — is
   * this somewhere the show can stand? A heading is not, a struck row is not,
   * a pre-record runs beside the order, and a milestone is a deadline with no
   * length that would park the show reading as overrun. An untimed row with a
   * length is none of those things.
   */
  const playable = (r: ClockTargetRow): boolean =>
    r.type !== "group" && r.type !== "milestone" && !r.skipped && !r.parallel;
  const nextAt = rows.findIndex((r, i) => i > at && playable(r));
  const next = nextAt >= 0 ? rows[nextAt] : null;
  const onUntimed = rows[at]!.hardStartSec == null;
  // Only two situations are ours: standing ON a row the sheet never timed, or
  // standing immediately before one. Everywhere else the clock knows best.
  if (!onUntimed && (!next || next.hardStartSec != null)) return { kind: "clock" };
  const planned = durations[at];
  if (!next) return { kind: "hold", reason: "unknowable" };
  /**
   * No length means no time in the running order — which is what a null
   * duration means everywhere else in this app, where `effDur` counts it as
   * zero. So it is passed straight through rather than stalling the show on
   * it. The row this matters for is the head of an ending block, "FULL TIME —
   * SCORES LEVEL, GOLDEN POINT EXTRA TIME": a label for what follows, carrying
   * no length because nothing about it takes time. Holding there would have
   * left the cue on a caption while the extra period ran underneath it, and
   * the result chooser waits for the cue to reach the LAST row of that period.
   *
   * KNOWN LIMIT, written down rather than papered over: a genuinely open-ended
   * period — the unlimited golden point of a drawn final, which `goldenPointBlock`
   * builds with no duration precisely because a sheet cannot put a length on it
   * — is indistinguishable from a caption by these fields alone, and will be
   * passed through too. A showcaller would have to cue it back. Telling the two
   * apart wants a flag from the importer, the way `extraTime` was added.
   */
  if (planned == null || planned <= 0) {
    /**
     * Unless it is a PERIOD with no knowable end, which is a different thing
     * from a label that takes no time. A drawn final goes to golden point
     * played with no change of ends and no time limit, until somebody scores —
     * so the sheet carries a row with no length, and passing through it walks
     * the show out of the match while it is still being played. Held instead,
     * which is what this function already says it does for a row the sheet is
     * describing as "as long as it takes".
     */
    if (isOpenEndedPeriodRow(rows[at]!.title)) return { kind: "hold", reason: "unknowable" };
    return { kind: "advance", rowId: next.id };
  }
  if (elapsedInRowSec < planned) return { kind: "hold", reason: "running" };
  return { kind: "advance", rowId: next.id };
}

/**
 * When the row the follower just moved to BEGAN.
 *
 * Two kinds of move, and they need opposite answers.
 *
 * A row the CLOCK reached began when the sheet says it began, not when the
 * follower noticed. Following the clock means the show is on the clock:
 * backdating to the planned start keeps the item's countdown honest and the
 * drift at zero, instead of reporting however long ago the row was due.
 *
 * A row `clockStep` reached begins NOW. It was not reached because a printed
 * time came round — it has no printed time, which is the only reason it needed
 * stepping into at all. Asking the timing model where it was PLANNED to start
 * gets the answer "at full time", which was minutes ago, so the row is stamped
 * as having begun before it began. The next tick finds it already past its
 * length and advances again, and again, one row per tick at 1Hz.
 *
 * Measured on a live show on 1 September, before this existed: a twelve-second
 * HOLDING lasted one second, a thirty-second half lasted two, and the whole
 * golden-point block was gone in five seconds — the show coming out the far
 * side into the next match with the result still uncalled. The chooser did
 * appear on the way past, for a single second.
 */
export const rowStartedAtMs = (step: ClockStep, plannedMs: number, nowMs: number): number =>
  step.kind === "advance" ? nowMs : plannedMs;

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
    if (!cueable(r)) continue;
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
  /**
   * When a row ends, including the ones the sheet gives no length.
   *
   * A period of play, a standby, a hold: they run until the next row starts,
   * which the sheet says by giving that next row a time. Treated as zero
   * seconds long they were never "on" at all, so four rows sharing a moment —
   * the half, the standby, the block and its first cue — showed a progress
   * bar on one of them and nothing on the rest.
   */
  /**
   * The forward scan above is quadratic, and the sheets that trigger it worst
   * are the ordinary ones.
   *
   * Every row with no length of its own scans forward for the next later
   * start, and this runs inside the loop over all rows — so a sheet where many
   * rows share a moment (untimed sub-rows, standbys, a block and its first
   * cue) makes each scan cover a long stretch of the sheet. That is exactly
   * the shape of a real run sheet, and it happens on every tick of the clock.
   *
   * When the sheet's start times run forwards, which is what a running order
   * normally means, the same answer comes out of one backward pass: rows
   * sharing a start are contiguous, so each one's end is either the next
   * distinct start or, if the neighbour shares its start, the neighbour's
   * answer.
   *
   * A sheet whose starts go BACKWARDS somewhere is a real case — there is a
   * whole warning kind for it — and the shortcut would quietly give a
   * different answer there. So it is used only when the starts are checked to
   * run forwards, and the original scan still handles the rest. Same answers,
   * both ways; the fast path just covers nearly every sheet.
   */
  let forwards = true;
  let prev: number | null = null;
  for (let i = 0; i < rows.length && forwards; i++) {
    const s = timing.rows[i]?.startSec;
    if (s == null) continue;
    if (prev != null && s < prev) forwards = false;
    prev = s;
  }

  const nextLaterStart: (number | null)[] = new Array(rows.length).fill(null);
  if (forwards) {
    let nextIdx: number | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const s = timing.rows[i]?.startSec;
      if (s != null) {
        if (nextIdx != null) {
          const ns = timing.rows[nextIdx]!.startSec!;
          nextLaterStart[i] = ns > s ? ns : (nextLaterStart[nextIdx] ?? null);
        }
        nextIdx = i;
      }
    }
  }

  const endOf = (i: number): number | null => {
    const t = timing.rows[i];
    if (!t?.startSec) return null;
    const own = t.endSec ?? t.startSec;
    if (own > t.startSec) return own;
    if (forwards) return nextLaterStart[i] ?? null;
    for (let j = i + 1; j < rows.length; j++) {
      const n = timing.rows[j];
      if (n?.startSec != null && n.startSec > t.startSec) return n.startSec;
    }
    return null;
  };

  const on: string[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const t = timing.rows[i];
    if (!t || r.skipped || t.startSec == null) continue;
    // A group is a heading, not a thing that happens — it has no progress to
    // show. Everything else that occupies time does, including the rows the
    // sheet leaves untimed.
    if (r.type === "group") continue;
    const end = endOf(i);
    if (end == null || end <= t.startSec) continue;
    if (t.startSec <= nowAbsSec && nowAbsSec < end) on.push(r.id);
  }
  return on;
}

/** A start time the sheet's own order says cannot be right. */
/**
 * Does editing a row's start time move the rest of the show with it?
 *
 * Changing a start time shifts every fixed time below it by the same amount,
 * which is right for the thing it was built for: the show is running ten
 * minutes late, so everything after moves ten minutes later.
 *
 * It is badly wrong for the other reason people edit a time — fixing one that
 * was already wrong. Correcting an "am" typed for a "pm" is a twelve-hour
 * change, so every row below it moved twelve hours too, and an 8 PM item came
 * back as 8 AM. The rows below were CORRECT before the edit; the whole point
 * of the edit was that this one row was not.
 *
 * The two are told apart by order. A run sheet is chronological, so:
 *
 *  · a row that sits in order, moved to somewhere still in order, is the show
 *    being re-planned — everything after it follows;
 *  · a row that was out of order, or one being moved out of order, is a value
 *    being corrected — nothing else is touched.
 *
 * Same reading of "wrong" that `checkStartTimes` uses, which is what makes a
 * meridiem repair land here without needing a rule of its own: putting 5:26 AM
 * back to 5:26 PM between rows at 5:25 PM and 5:26 PM restores the order, so
 * it corrects rather than shifts.
 */
export function startEditRipples(
  starts: readonly (number | null)[],
  index: number,
  fromSec: number | null,
  toSec: number,
): boolean {
  if (fromSec == null) return false; // a row given its first time moves nothing
  let above: number | null = null;
  for (let i = index - 1; i >= 0; i--) {
    const s = starts[i];
    if (s != null) {
      above = s;
      break;
    }
  }
  let below: number | null = null;
  for (let i = index + 1; i < starts.length; i++) {
    const s = starts[i];
    if (s != null) {
      below = s;
      break;
    }
  }
  // Equal is in order: rows sharing a moment are ordinary on a run sheet.
  const inOrder = (sec: number): boolean => (above == null || sec >= above) && (below == null || sec <= below);
  return inOrder(fromSec) && inOrder(toSec);
}

export interface StartTimeWarning {
  /** Row index in the sheet. */
  index: number;
  /** What the row currently starts at. */
  startSec: number;
  /** Why it looks wrong, and therefore what to do about it. */
  kind: "meridiem" | "offset" | "out-of-order";
  /** The time it probably meant, when that can be worked out. */
  suggestSec?: number;
}

/** How far a start may sit behind the sheet's high-water mark before it is suspect. */
const START_SLACK_SEC = 3600;

/**
 * Every start time that contradicts the order of the sheet it is in.
 *
 * A run sheet is chronological, so a row that starts hours before the one
 * above it is not early — it is wrong. The two ways it goes wrong are worth
 * telling apart, because they need different answers:
 *
 *  · **meridiem** — an "am" typed for a "pm". Adding twelve hours puts the row
 *    exactly back in order, which is the giveaway. One sheet had "5:26:00 am"
 *    on a two-minute bell between rows at 5:25 PM and 5:26 PM, and it parked a
 *    live show twelve hours out of place.
 *
 *  · **offset** — not a time of day at all. Cue sheets write elapsed position
 *    in the same column: "0:00:15", "0:09:00", meaning fifteen seconds and
 *    nine minutes into the segment. Read as clock times they become a quarter
 *    past midnight in the middle of a Saturday afternoon. Flipping the
 *    meridiem does not rescue these, which is how they are told apart.
 *
 * Reported, never corrected. Both readings are things the sheet's author can
 * settle in a second and no rule can settle safely: "0:00:15" really is a
 * valid time of day on a sheet that runs through midnight.
 */
export function checkStartTimes(
  rows: readonly { startSec: number | null; parallel?: boolean; skipped?: boolean }[],
): StartTimeWarning[] {
  const out: StartTimeWarning[] = [];
  let highWater = -Infinity;
  let seen = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.skipped || r.startSec == null) continue;
    const start = r.startSec;
    seen += 1;
    if (highWater === -Infinity || start >= highWater - START_SLACK_SEC) {
      highWater = Math.max(highWater, start);
      continue;
    }
    // Out of order. Does adding twelve hours put it back?
    const flipped = start + 12 * 3600;
    if (flipped >= highWater - START_SLACK_SEC && flipped < 24 * 3600) {
      out.push({ index: i, startSec: start, kind: "meridiem", suggestSec: flipped });
      continue;
    }
    // Not a meridiem slip. Inside the first hour of the day it is far more
    // likely to be an elapsed offset than a genuine 12:0x AM on a sheet that
    // has already reached the afternoon.
    out.push({ index: i, startSec: start, kind: start < 3600 ? "offset" : "out-of-order" });
  }
  // A sheet that genuinely runs through midnight trips every rule here, and
  // its rows are right. If most of the timed rows look wrong, the rule is.
  return out.length > 0 && out.length > seen / 2 ? [] : out;
}

/** The shape `followerMayMove` needs: identity, and whether it runs alongside. */
export interface OrderedRow {
  id: string;
  /** Runs alongside the running order rather than in it — see `PlanRow.parallel`. */
  parallel?: boolean;
}

/**
 * May the clock's follower move the show from where it is to where the clock
 * says it should be?
 *
 * A show never goes backwards on its own: when the clocks go back, 02:00 to
 * 02:59 happens twice, and a sheet with rows in that hour would be called a
 * second time. The same guard covers a corrected server time or a machine
 * coming off a bad NTP source. (A person may still jump anywhere — going back
 * is sometimes exactly what is wanted, and they can see what they are doing.)
 *
 * The comparison is made in the RUNNING ORDER, not in sheet rows, and that
 * distinction is the whole reason this is a function. A pre-record is written
 * on the sheet near where it is SHOT, not where it airs, so it can sit well
 * below the rows that follow it on air. Comparing raw row numbers made a
 * pre-record a TRAP: once the show sat on one, every legitimate target counted
 * as backwards, the follower refused to move for the rest of the night, and
 * the overrun on a nine-second insert climbed until the drift readout went
 * red. Four of the six pre-records on one match sheet would hold a show that
 * way. A row running alongside the order has no place in it, so a show sitting
 * on one is not ahead of anything and the clock may take it back.
 */
export function followerMayMove(
  rows: readonly OrderedRow[],
  fromId: string | null | undefined,
  toId: string | null | undefined,
): boolean {
  const pos = (id: string | null | undefined): number => {
    if (!id) return -1;
    let at = -1;
    for (const r of rows) {
      if (r.parallel) continue;
      at += 1;
      if (r.id === id) return at;
    }
    return -1;
  };
  const from = pos(fromId);
  const to = pos(toId);
  if (from < 0 || to < 0) return true;
  return to >= from;
}

/**
 * Whether a refusal by `followerMayMove` is worth saying out loud this time.
 *
 * The refusal is correct. Reporting it was not: the follower runs once a
 * second, so a show parked in that state wrote the same line 3,600 times an
 * hour — about 14,400 across a four-hour show. A host that treats stderr as
 * error then buries its own error filter under one stuck show, on the log
 * somebody is meant to read to find real faults. Noise there does not merely
 * waste attention; it hides the thing you opened the log to find.
 *
 * So: once per state, not once per tick. `seen` remembers which target was
 * last reported for each show, and the caller clears the entry whenever the
 * follower is NOT refusing — the show stops, the clock catches up, or the
 * follower moves. A genuine recurrence is therefore reported again, and a
 * refusal against a DIFFERENT target is a different state and says so.
 *
 * Kept here, beside the rule it reports on, because it is pure and testable
 * and the loop it runs in is neither.
 */
export function reportClockRefusal(
  seen: Map<string, string>,
  rundownId: string,
  target: string,
): boolean {
  if (seen.get(rundownId) === target) return false;
  seen.set(rundownId, target);
  return true;
}

/** Which game the chooser is asking about. */
export interface ActiveGameInput {
  /** Every game on the sheet that has endings, in sheet order. */
  games: readonly number[];
  /** For each row: the game whose endings it belongs to, or null. */
  endingGameAt: readonly (number | null)[];
  /** Where the live cue is; -1 when no show is running. */
  liveIndex: number;
  /** Has this game's result been called? */
  called: (game: number) => boolean;
}

/**
 * The match the result chooser is about.
 *
 * Ordinarily the first game whose endings still lie ahead of the cue: a
 * double-header asks about the game being played, not the one already won.
 *
 * A MATCH THE SHOW WALKED PAST WITHOUT A RESULT outranks that, and losing it
 * is what made a called golden point unanswerable. Calling golden point strikes
 * the win, lose and draw rows — that is how the app records extra time being
 * played rather than a result — so the block ENDS at the last golden row, and
 * the instant the cue steps off it every ending of that game is behind the cue.
 * The question moved on to the next match and the result of the one just played
 * became uncallable: no chooser, and no way to get one back. Watched happening
 * on 1 September, golden point running its full ten minutes and the show going
 * straight into the next walk-in with nobody ever asked who won.
 *
 * Bounded deliberately. The unfinished match holds the question only until the
 * NEXT game's endings come into view. A showcaller who never calls a result
 * should be asked again — but not at the cost of the chooser for the match
 * actually on air, which is the one whose answer still changes what plays.
 */
export function activeOutcomeGame(input: ActiveGameInput): number | null {
  const { games, endingGameAt, liveIndex, called } = input;
  if (games.length === 0) return null;
  if (games.length === 1) return games[0]!;
  if (liveIndex < 0) return games.find((g) => !called(g)) ?? games[0]!;

  const firstOf = (g: number) => endingGameAt.findIndex((x) => x === g);
  const lastOf = (g: number): number =>
    endingGameAt.reduce<number>((acc, x, i) => (x === g ? i : acc), -1);

  const passedUncalled = [...games]
    .reverse()
    .find((g) => firstOf(g) >= 0 && liveIndex > lastOf(g) && !called(g));
  if (passedUncalled != null) {
    const next = games.find((g) => firstOf(g) > lastOf(passedUncalled));
    if (liveIndex < (next == null ? Infinity : firstOf(next))) return passedUncalled;
  }

  for (const g of games) if (lastOf(g) >= liveIndex) return g;
  return games[games.length - 1]!;
}

/**
 * When the offer to BUILD an extra period is due.
 *
 * On a sheet with no ending rows written — most real sheets — the result is
 * called at the row that reads as full time, and the extra period is built
 * there if it is needed. The offer used to appear on that row and on the one
 * that hands over to it, with no notion of time: measured live on the
 * regular-game sheet, it was on screen four and a half minutes before full
 * time, from the moment the second half went to air. On a real sheet that is
 * forty-seven minutes of a bar across the foot of a live screen, which is the
 * exact thing `resultDueNow` was built not to do for the tagged endings, and
 * for the same reason — up for the whole half it is just something covering
 * rows, and the showcaller stops seeing it.
 *
 * So it keeps the chooser's rule: on the decision row itself, always; on the
 * row before it, only in the last half-minute. A half that has run over counts
 * as due, not as not-yet.
 */
export function buildOfferDue(input: {
  liveIndex: number;
  decisionIndex: number;
  remainingInRowSec: number | null;
  bufferSec: number;
}): boolean {
  const { liveIndex, decisionIndex, remainingInRowSec, bufferSec } = input;
  if (liveIndex < 0 || decisionIndex < 0) return false;
  if (liveIndex === decisionIndex) return true;
  if (liveIndex !== decisionIndex - 1) return false;
  return remainingInRowSec != null && remainingInRowSec <= bufferSec;
}

/**
 * May this viewer change the sheet from the show console?
 *
 * The show console deliberately sits outside the edit lock — whoever is
 * calling the show keeps every control — and that was written as "everyone in
 * show mode may edit", which let a crew member holding a join code re-time a
 * live show. Measured on 3 September: a follower's -30 took the on-air row
 * from 00:30 to 00:00 with no refusal and no message.
 *
 * On a locked deployment the server makes a follower's document connection
 * read-only, so the room never saw that edit — but the follower did. The
 * change applied to their own copy and was silently dropped upstream, leaving
 * their sheet drifting from everyone else's with nothing to say so. That is
 * the bug this closes: the controls that write to the sheet are for the roles
 * that may drive it, and nobody else is offered them.
 */
export const mayEditShow = (role: string | null | undefined): boolean => role === "caller" || role === "admin";

/** One row of a game's endings, as the result rules see it. */
export interface EndingRow {
  id: string;
  /** Position in the full sheet. */
  index: number;
  outcome: string;
  skipped: boolean;
}

const isGolden = (r: EndingRow) => r.outcome === "golden";

/**
 * Is the extra period under way for this game?
 *
 * Two shapes of sheet answer it differently. A sheet with RESULT rows written
 * (win, lose, draw) records "golden point has been called" by striking those
 * results — before anything is called nothing is struck, so every ending is
 * technically playing, golden included, and the period only counts as under
 * way once the results are out of the running order. A sheet with NO result
 * rows — the block was built at full time on a sheet that never wrote any —
 * has nothing to strike, and the only honest signal is the cue: the period is
 * under way once the show has reached it.
 */
export function extraUnderWay(rows: readonly EndingRow[], liveIndex: number): boolean {
  const golden = rows.filter(isGolden);
  if (golden.length === 0 || golden.some((r) => r.skipped)) return false;
  const results = rows.filter((r) => !isGolden(r));
  if (results.length > 0) return results.every((r) => r.skipped);
  return liveIndex >= Math.min(...golden.map((r) => r.index));
}

/**
 * The result that has been called for this game, or null while it is open.
 *
 * With result rows on the sheet it is the one whose rows all play while every
 * other result is struck; golden point is skipped over, because once the
 * period is playing the question is still open, and once a result is called
 * after it the golden block STAYS in the order — it happened.
 *
 * A built block has no result rows to read. There the tell is the block
 * itself: a result called mid-period strikes the part of it that was never
 * played, and a struck golden row means the match has been decided. Which
 * result it was is not recorded anywhere on such a sheet — there is nothing
 * for it to select between — so the answer is only that one HAS been called.
 */
export function resultCalled(rows: readonly EndingRow[]): string | null {
  const results = rows.filter((r) => !isGolden(r));
  if (results.length === 0) return rows.some((r) => isGolden(r) && r.skipped) ? "settled" : null;
  const outcomes = [...new Set(results.map((r) => r.outcome))];
  for (const o of outcomes) {
    const mine = results.filter((r) => r.outcome === o);
    const others = results.filter((r) => r.outcome !== o);
    if (mine.every((r) => !r.skipped) && others.length > 0 && others.every((r) => r.skipped)) return o;
  }
  return null;
}

/**
 * Which ending rows stay in the running order once a result is called.
 *
 * The chosen ending plays. Everything else is struck — except the extra
 * period, which is the part this used to get wrong. "Extra time that has
 * already been played stays played" is right, and it had been written as
 * "keep every golden row", which on a sudden-death period is wrong by the
 * length of whatever had not been played yet: a try in the second minute
 * ended the match, and the show then walked the rest of the first half, the
 * change of ends and the whole second half before it reached the winning
 * song. The first score wins and the match stops there — so the rows of the
 * period at or before the cue stay (they happened, or are happening), and the
 * rows after it are struck (they never will).
 *
 * Called at full time, before the period has begun, nothing of it has been
 * played and all of it is struck, which is what a match decided at the siren
 * needs. Called after the period has run its length, all of it stays.
 */
export function keepAfterResult(rows: readonly EndingRow[], chosen: string, liveIndex: number): Set<string> {
  const underWay = extraUnderWay(rows, liveIndex);
  const keep = new Set<string>();
  for (const r of rows) {
    if (r.outcome === chosen) keep.add(r.id);
    else if (isGolden(r) && chosen !== "golden" && underWay && r.index <= liveIndex) keep.add(r.id);
  }
  return keep;
}
