/**
 * Running late into something that must start on time (20 Oct, Robert).
 *
 * "If 1st half and 2nd half have specific times they need to start and we
 * start to run over, we need a way to tell the showcaller by how much, leading
 * up to that period." The sheet already knows the periods of a game (see
 * phases.ts); a row can also be marked "Must start on time". From the row on
 * air, this works out when the show will REACH the next such row if every item
 * from here runs to plan — and how far that is from the time it must start.
 */

export interface LateRow {
  id: string;
  type: string;
  parallel?: boolean;
  skipped?: boolean;
  durationMuted?: boolean;
  /** A branch of the endings: played only if chosen, so not counted on the way. */
  outcome?: string | null;
  /** Its own length, which a MUTED row still has — see `lengthOnTheWay`. */
  durationSec?: number | null;
  mustStart?: boolean;
}

export interface LateTiming {
  /** The sheet's start for the row (seconds from midnight, past 24h allowed). */
  startSec: number | null;
  /** The length it counts for in the running order. */
  effectiveDurationSec: number;
}

/** Which kinds of period must start on time: each half, quarter and extra period. */
export const MUST_START_PERIODS = new Set(["first-half", "second-half", "quarter", "extra-time"]);

export interface FixedTarget {
  index: number;
  /** "2nd half", or the row's own title for one marked by hand. */
  name: string;
  /** The time it must start, on the sheet's scale. */
  atSec: number;
  /** Which game on the day it belongs to, from 1 (a double-header has two first halves). */
  game?: number;
  /** The end of the show itself — the last target, after every half. */
  end?: boolean;
}

/**
 * Every row that must start on time, in order: the first row of each period
 * that counts, and every row marked by hand. Rows with no time are left out —
 * there is nothing to be late for.
 */
export function fixedTargets(
  rows: readonly LateRow[],
  timing: readonly LateTiming[],
  periods: readonly { from: number; to?: number; kind: string; label: string; game?: number }[],
  titleOf: (index: number) => string,
  /**
   * When the show is planned to end (21 Oct, Robert: "keep it to the end of
   * the show"). After the last half the line had nothing left to say and
   * disappeared; with this it carries on — "Show ends · 9:46 PM · on time" —
   * and it is the last line of the list. Sits past the last row.
   */
  showEndSec?: number | null,
): FixedTarget[] {
  const out = new Map<number, FixedTarget>();
  for (const p of periods) {
    if (!MUST_START_PERIODS.has(p.kind)) continue;
    // An ENDING is not a fixed time: golden point happens only if the scores
    // are level (21 Oct — it was listed as "Game 58 · Golden point must
    // start at 2:27"). Only the halves of the game itself must be made.
    if (rows[p.from]?.outcome) continue;
    const at = timing[p.from]?.startSec;
    if (at != null) out.set(p.from, { index: p.from, name: p.label, atSec: at, ...(p.game != null ? { game: p.game } : {}) });
  }
  // A row marked by hand belongs to the game of the period it sits in, or the
  // one before it.
  const gameAt = (i: number): number | undefined => {
    let g: number | undefined;
    for (const p of periods) if (p.from <= i && p.game != null) g = p.game;
    return g;
  };
  rows.forEach((r, i) => {
    const at = timing[i]?.startSec;
    const game = gameAt(i);
    if (r.mustStart && at != null && !out.has(i)) out.set(i, { index: i, name: titleOf(i) || "Fixed time", atSec: at, ...(game != null ? { game } : {}) });
  });
  const sorted = [...out.values()].sort((a, b) => a.index - b.index);
  const last = sorted[sorted.length - 1];
  if (showEndSec != null && (!last || showEndSec > last.atSec)) sorted.push({ index: rows.length, name: "Show ends", atSec: showEndSec, end: true });
  return sorted;
}

/**
 * Does this row take time on the way to the target?
 *
 * MUTED ROWS DO (21 Oct). A muted row is out of the cascade's sum because
 * something else carries its time — the half-time items printed inside a
 * HALF TIME 15:00 block, a stoppage buffer — but it is still on the plan, at
 * its printed time, for its own length. Leaving it out made those items empty
 * air: with the cue on a half-time item, the next fixed time read "12:21 to
 * spare" — every minute to the 2nd half — on a show running to time. Counted
 * by its own start and length, the overlap rule in `carry` keeps a block and
 * its contents from ever counting twice.
 */
export const countsOnTheWay = (r: LateRow): boolean => r.type !== "group" && !r.parallel && !r.skipped && !r.outcome;

/** How long a row holds the plan: its own length if muted, else what the cascade gives it. */
const lengthOnTheWay = (r: LateRow, t: LateTiming | undefined): number =>
  r.durationMuted ? Math.max(0, r.durationSec ?? 0) : (t?.effectiveDurationSec ?? 0);

export interface Arrival {
  target: FixedTarget;
  /** When the show reaches it if everything from now runs to plan. */
  arrivesSec: number;
  /** Arrival minus the fixed time: positive is late, negative is time to spare. */
  overSec: number;
  /** How long until the fixed time. */
  untilSec: number;
}

/**
 * How late the show will be at `target`, carried forward from a lateness
 * already known at a point on the plan.
 *
 * Measured against the sheet's PLANNED times, not by adding lengths up. The
 * first version added the length of every item between here and the target,
 * and a run sheet is not a list of lengths: "HALF TIME 13:00" is a block with
 * the half-time items printed INSIDE it, each with its own time. Adding them
 * counted those thirteen minutes twice, and Robert's 2nd half read "13:00
 * OVER" on a show running exactly on time (21 Oct). The plan already knows
 * which items overlap; lateness only changes where it has room to:
 *
 *  · a GAP in the plan before an item (nothing scheduled — a deliberate wait,
 *    or time given back by a strike or a trim) takes lateness up, or adds to
 *    the time in hand;
 *  · an OVERLAP (an item printed inside the one before) changes nothing.
 */
function carry(
  rows: readonly LateRow[],
  timing: readonly LateTiming[],
  fromIndex: number,
  frontierSec: number,
  lateSec: number,
  target: FixedTarget,
): number {
  let frontier = frontierSec;
  let late = lateSec;
  for (let i = fromIndex; i < target.index; i++) {
    if (!countsOnTheWay(rows[i]!)) continue;
    const start = timing[i]?.startSec;
    if (start == null) continue;
    if (start > frontier) late -= start - frontier;
    frontier = Math.max(frontier, start + lengthOnTheWay(rows[i]!, timing[i]));
  }
  // Room before the fixed time takes lateness up; items PRINTED to run past
  // it are late by that much even if every one runs to plan.
  if (target.atSec > frontier) late -= target.atSec - frontier;
  else late += frontier - target.atSec;
  return late;
}

/**
 * When the show reaches the next must-start row.
 *
 * How late it is NOW — when the item on air will end (now plus what is left of
 * it; its overrun is already in "now") against when the plan has it ending —
 * carried forward to the target through the gaps in the plan (see `carry`).
 * Null when nothing is on air or no target lies ahead.
 */
export function arrivalAtNextFixed(
  rows: readonly LateRow[],
  timing: readonly LateTiming[],
  targets: readonly FixedTarget[],
  activeIndex: number,
  remainingInRowSec: number | null,
  nowSec: number,
): Arrival | null {
  if (activeIndex < 0) return null;
  const target = targets.find((t) => t.index > activeIndex);
  if (!target) return null;
  // What is left of the item on air. The cue timer measures a muted row by
  // its own length (live.ts — it once measured it against the cascade's zero
  // and read "+3:00 over" three minutes into a five-minute item), so its
  // figure is used as it stands.
  const activeRow = rows[activeIndex] ?? { id: "", type: "cue" };
  const ownLen = lengthOnTheWay(activeRow, timing[activeIndex]);
  const endsSec = nowSec + Math.max(0, remainingInRowSec ?? ownLen);
  const plannedStart = timing[activeIndex]?.startSec ?? nowSec;
  const plannedEnd = plannedStart + ownLen;
  const late = carry(rows, timing, activeIndex + 1, plannedEnd, endsSec - plannedEnd, target);
  const arrives = target.atSec + late;
  return { target, arrivesSec: arrives, overSec: Math.round(late), untilSec: target.atSec - nowSec };
}

/**
 * Every fixed time still ahead, in order, with how the show will arrive at
 * each (21 Oct, Robert: "game 1 – 1st half start and time, and how much
 * running over; game 1 – 2nd half…; game 2…").
 *
 * The first is `arrivalAtNextFixed`. Each one after starts from the one
 * before: from when the show reaches it if that is LATE (the lateness carries
 * on), from its fixed time if early (nothing starts before its time — the
 * show holds), then adds the items between.
 */
export function arrivalsAhead(
  rows: readonly LateRow[],
  timing: readonly LateTiming[],
  targets: readonly FixedTarget[],
  activeIndex: number,
  remainingInRowSec: number | null,
  nowSec: number,
): Arrival[] {
  const first = arrivalAtNextFixed(rows, timing, targets, activeIndex, remainingInRowSec, nowSec);
  if (!first) return [];
  const out: Arrival[] = [first];
  let prev = first;
  for (const target of targets) {
    if (target.index <= prev.target.index) continue;
    // Lateness carries on into the next; time in hand does not — a half
    // never starts before its time.
    const late = carry(rows, timing, prev.target.index, prev.target.atSec, Math.max(0, prev.overSec), target);
    const next: Arrival = { target, arrivesSec: target.atSec + late, overSec: Math.round(late), untilSec: target.atSec - nowSec };
    out.push(next);
    prev = next;
  }
  return out;
}

/**
 * The plan checked against its fixed times, before the show (23 Oct, Robert:
 * "we should also have on time up pre-show too"). Nothing is on air, so
 * nothing is running late yet — but a plan can already be: items printed to
 * run past a fixed time, which is what adding an item in front of kick-off now
 * does (retime.ts), or time to spare in front of it. Carried from the sheet's
 * first timed row to each fixed time the way `arrivalsAhead` carries the live
 * show: lateness goes on into the next, time in hand does not.
 */
export function planArrivals(
  rows: readonly LateRow[],
  timing: readonly LateTiming[],
  targets: readonly FixedTarget[],
  nowSec: number,
): Arrival[] {
  const startIdx = timing.findIndex((t) => t?.startSec != null);
  if (startIdx < 0) return [];
  const out: Arrival[] = [];
  let fromIndex = startIdx;
  let frontier = timing[startIdx]!.startSec!;
  let late = 0;
  for (const target of targets) {
    if (target.index < fromIndex) continue;
    const l = carry(rows, timing, fromIndex, frontier, late, target);
    const a: Arrival = { target, arrivesSec: target.atSec + l, overSec: Math.round(l), untilSec: target.atSec - nowSec };
    out.push(a);
    fromIndex = target.index;
    frontier = target.atSec;
    late = Math.max(0, a.overSec);
  }
  return out;
}

export type LateLevel = "far" | "spare" | "over" | "urgent";

/**
 * How loudly to say it. Nothing to shout about more than fifteen minutes out;
 * amber when over inside that; red in the last five minutes once it is more
 * than thirty seconds — the point where the show can't simply absorb it.
 */
/**
 * Within this much either way, the show is ON TIME (21 Oct, Robert: "game 1 –
 * 1st half keeps flashing orange — the Show light flashes green, then it
 * flashes orange"). The arrival is worked out each second from two clocks that
 * tick separately — now, and what is left of the item on air — so on time it
 * wobbles a second either side of zero, and "over by anything" turned the
 * line amber and back on every update. Fifteen seconds is noise no showcaller
 * would act on.
 */
export const ON_TIME_SEC = 15;
/** The verdict, with the same allowance: positive is over, negative to spare, 0 on time. */
export const lateBy = (overSec: number): number => (Math.abs(overSec) <= ON_TIME_SEC ? 0 : overSec);

export function lateLevel(a: Arrival): LateLevel {
  if (a.untilSec > 15 * 60) return "far";
  if (a.overSec <= ON_TIME_SEC) return "spare";
  if (a.untilSec <= 5 * 60 && a.overSec > 30) return "urgent";
  return "over";
}

/**
 * How loudly to say it before the show: amber when the plan runs over, quiet
 * otherwise. The time until it does not matter yet — a plan that cannot make
 * kick-off is wrong whether kick-off is in ten minutes or tomorrow.
 */
export const planLevel = (a: Arrival): LateLevel => (a.overSec > ON_TIME_SEC ? "over" : "spare");

export interface TrimOption {
  index: number;
  id: string;
  /** Its planned length now. */
  durationSec: number;
  canDrop: boolean;
  /** Already struck from here — kept in the list, crossed out, so it can be put back. */
  struck: boolean;
}

/**
 * What could be trimmed before the target, most useful first: rows marked
 * "Can drop if running late", then the longest. Only items still to play, and
 * only those in the target's own CHUNK — after the fixed time before it
 * (`chunkFrom`), so "Game 2 · 1st half" offers what runs between game 1's
 * second half and game 2, not the half-time items of game 1 again (21 Oct,
 * Robert: "explore the chunks between each game").
 *
 * Struck rows stay in the list, marked, in the place they had (21 Oct: "when
 * clicking Strike it disappears — maybe just put a strike through it so it can
 * be undone"). Sorted by their length either way, so striking one does not
 * move the others under the pointer.
 */
export function trimOptions(
  rows: readonly (LateRow & { durationSec?: number | null; canDrop?: boolean })[],
  activeIndex: number,
  target: FixedTarget,
  chunkFrom = -1,
): TrimOption[] {
  const out: TrimOption[] = [];
  for (let i = Math.max(activeIndex, chunkFrom) + 1; i < target.index; i++) {
    const r = rows[i]!;
    const struck = !!r.skipped;
    if (!countsOnTheWay({ ...r, skipped: false }) || r.type === "milestone" || !(r.durationSec && r.durationSec > 0)) continue;
    out.push({ index: i, id: r.id, durationSec: r.durationSec, canDrop: r.canDrop === true, struck });
  }
  return out.sort((a, b) => Number(b.canDrop) - Number(a.canDrop) || b.durationSec - a.durationSec);
}
