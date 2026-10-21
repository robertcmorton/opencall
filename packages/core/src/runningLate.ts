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
  return [...out.values()].sort((a, b) => a.index - b.index);
}

/** Does this row take time on the way to the target? */
export const countsOnTheWay = (r: LateRow): boolean =>
  r.type !== "group" && !r.parallel && !r.skipped && !r.durationMuted && !r.outcome;

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
 * When the show reaches the next must-start row.
 *
 * Now, plus what is left of the item on air (nothing once it is over — its
 * overrun is already in "now"), plus the planned length of every item still
 * to play before the target. Null when nothing is on air or no target lies
 * ahead.
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
  let arrives = nowSec + Math.max(0, remainingInRowSec ?? 0);
  for (let i = activeIndex + 1; i < target.index; i++) if (countsOnTheWay(rows[i]!)) arrives += timing[i]?.effectiveDurationSec ?? 0;
  return { target, arrivesSec: arrives, overSec: Math.round(arrives - target.atSec), untilSec: target.atSec - nowSec };
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
    let arrives = Math.max(prev.arrivesSec, prev.target.atSec);
    for (let i = prev.target.index; i < target.index; i++) if (countsOnTheWay(rows[i]!)) arrives += timing[i]?.effectiveDurationSec ?? 0;
    const next: Arrival = { target, arrivesSec: arrives, overSec: Math.round(arrives - target.atSec), untilSec: target.atSec - nowSec };
    out.push(next);
    prev = next;
  }
  return out;
}

export type LateLevel = "far" | "spare" | "over" | "urgent";

/**
 * How loudly to say it. Nothing to shout about more than fifteen minutes out;
 * amber when over inside that; red in the last five minutes once it is more
 * than thirty seconds — the point where the show can't simply absorb it.
 */
export function lateLevel(a: Arrival): LateLevel {
  if (a.untilSec > 15 * 60) return "far";
  if (a.overSec <= 0) return "spare";
  if (a.untilSec <= 5 * 60 && a.overSec > 30) return "urgent";
  return "over";
}

export interface TrimOption {
  index: number;
  id: string;
  /** Its planned length now. */
  durationSec: number;
  canDrop: boolean;
}

/**
 * What could be trimmed before the target, most useful first: rows marked
 * "Can drop if running late", then the longest. Only items still to play.
 */
export function trimOptions(
  rows: readonly (LateRow & { durationSec?: number | null; canDrop?: boolean })[],
  activeIndex: number,
  target: FixedTarget,
): TrimOption[] {
  const out: TrimOption[] = [];
  for (let i = activeIndex + 1; i < target.index; i++) {
    const r = rows[i]!;
    if (!countsOnTheWay(r) || r.type === "milestone" || !(r.durationSec && r.durationSec > 0)) continue;
    out.push({ index: i, id: r.id, durationSec: r.durationSec, canDrop: r.canDrop === true });
  }
  return out.sort((a, b) => Number(b.canDrop) - Number(a.canDrop) || b.durationSec - a.durationSec);
}
