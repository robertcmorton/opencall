import { computeTiming } from "./timing";
import type { PlanRow } from "./types";

/**
 * Re-timing the sheet when its shape changes: a row struck out, a row moved.
 *
 * A sheet that came from paper carries a printed time on nearly every row, and
 * a printed time is an anchor — the rows below are measured from it. That is
 * right while the sheet is what was planned and wrong the moment the plan
 * changes. Strike a two-minute item and the item under it still said 8:47,
 * because 8:47 was written on it: the two minutes left the cascade and the
 * anchor put them straight back, so the sheet showed a hole where the struck
 * row had been and nothing below it moved. Drag a row somewhere else and every
 * row, the moved one included, kept the time of the place it used to be in.
 *
 * Both answers here are the answer the duration editor already gives: a
 * changed length ripples through every fixed time below it. Striking a row is
 * changing its length to nothing; moving a row is taking its length out of one
 * place and putting it in another.
 */

/** What a row would move the running order on by, were it in it. */
export function runningLength(row: PlanRow): number {
  if (row.parallel || row.spans || row.durationMuted || row.durationSec == null) return 0;
  return Math.max(0, row.durationSec);
}

/**
 * How far every fixed time BELOW `index` moves when the row there is struck
 * (`struck` true) or put back. Zero when nothing should move.
 *
 * A shift rather than a set of values, because a strike is often several rows
 * at once applied one after another inside one transaction: each shift is
 * added to whatever a row's time is by then, not to what it was when the
 * screen last drew.
 */
export function strikeShift(rows: readonly PlanRow[], index: number, struck: boolean, liveIndex = -1): number {
  const row = rows[index];
  if (!row) return 0;
  // An ending is one of several alternatives sharing a start. Only the longest
  // of them costs the day anything, and the timing works that out itself.
  if (row.outcome) return 0;
  // Above the live cue the question is settled: it happened or it did not, and
  // the rows below are measured from where the show actually is.
  if (liveIndex >= 0 && index < liveIndex) return 0;
  const len = runningLength(row);
  // Not `-len`: a struck row of no length answers -0, and -0 is not 0 to
  // anything that compares with Object.is — the test runner, for one.
  if (len === 0) return 0;
  return struck ? -len : len;
}

export interface FixedTime {
  id: string;
  hardStartSec: number;
}

/** Fixed times are times of day; the cascade counts on past midnight. */
/** A clock time kept on the dial: 24:10 is 00:10, and ten minutes before midnight is 23:50. */
export const wrapTimeOfDay = (sec: number): number => ((sec % 86400) + 86400) % 86400;
const timeOfDay = wrapTimeOfDay;

/**
 * The fixed times that change when the row at `from` is moved to `to` — the
 * index it ends up at, the way a list reorders.
 *
 * One principle, everywhere: the first row that now follows a different
 * neighbour STARTS WHEN THAT NEIGHBOUR ENDS, and the rows behind it keep
 * their spacing. It used to be "the jumped rows shift by the moved row's
 * length", which is the same thing only when the sheet has no holes. It had
 * one: a row with a struck ten minutes, so the row after it sat ten minutes
 * later than the cascade would put it. Move an hour-long row above that, and
 * the hole came along — 5:30 plus an hour is 6:30, when the moved row ends at
 * 6:20 and the row should start there. So the shifted block's first row is
 * re-cascaded and the block moves by whatever that turns out to be.
 *
 * Live, the cue is the anchor: whatever is on air never moves, and the past
 * is the past. A move ACROSS the cue is time leaving or joining the future —
 * the block that moves is everything below the moved row's old place (it has
 * left) or below its new place (it has arrived). Moving the cue itself, or
 * moving within the past, re-times nothing.
 *
 * Rows outside the block keep their times; a hole the block absorbs reappears
 * below it, so the show still ends when it ended.
 */
export function fixedTimesAfterMove(
  rows: readonly PlanRow[],
  from: number,
  to: number,
  plannedStartSec: number | null = null,
  liveIndex = -1,
): FixedTime[] {
  const moved = rows[from];
  if (!moved || from === to || to < 0 || to >= rows.length) return [];
  if (liveIndex >= 0 && (from === liveIndex || (from <= liveIndex && to <= liveIndex))) return [];

  const reordered: PlanRow[] = rows.slice();
  const [row] = reordered.splice(from, 1);
  reordered.splice(to, 0, row!);

  // The block that must re-time, as indices into `reordered`, and its first row.
  const crossing = liveIndex >= 0 && (from > liveIndex) !== (to > liveIndex);
  let blockStart: number;
  let blockEnd: number; // exclusive
  if (crossing) {
    blockStart = from > liveIndex ? from + 1 : to + 1;
    blockEnd = reordered.length;
  } else if (from < to) {
    blockStart = from; // the rows it jumped, now above it
    blockEnd = to;
  } else {
    blockStart = to + 1; // the rows it jumped, now below it
    blockEnd = from + 1;
  }
  const changes: FixedTime[] = [];
  const first = reordered[blockStart];
  // A sheet with no planned start begins where its first row began: a move
  // that puts a flowing row at the top would otherwise have nothing to
  // cascade from, and the whole re-timing would silently do nothing.
  const orig = computeTiming(rows.slice(), plannedStartSec);
  const startFrom = plannedStartSec ?? orig.rows[0]?.startSec ?? null;
  if (first && blockStart < blockEnd) {
    // Where the first row of the block sat, and where the cascade now puts it
    // with the moved row and itself left to flow.
    const before = orig.rows[rows.indexOf(first)]?.startSec ?? null;
    const flowing = reordered.map((r) => (r.id === moved.id || r.id === first.id ? { ...r, hardStartSec: null } : r));
    const after = computeTiming(flowing, startFrom).rows[blockStart]?.startSec ?? null;
    const delta = before != null && after != null ? Math.round(after - before) : 0;
    if (delta !== 0) {
      for (const r of reordered.slice(blockStart, blockEnd)) {
        if (r.hardStartSec != null) changes.push({ id: r.id, hardStartSec: timeOfDay(r.hardStartSec + delta) });
      }
    }
  }

  // The moved row takes the time its new place implies — a pre-record sits at
  // its own time wherever on the sheet it is written.
  if (moved.hardStartSec == null || moved.parallel) return changes;
  const shifted = new Map(changes.map((c) => [c.id, c.hardStartSec]));
  const trial: PlanRow[] = reordered.map((r) =>
    r.id === moved.id ? { ...r, hardStartSec: null } : shifted.has(r.id) ? { ...r, hardStartSec: shifted.get(r.id)! } : r,
  );
  const start = computeTiming(trial, startFrom).rows[to]?.startSec;
  if (start == null) return changes;
  const ofDay = timeOfDay(start);
  if (ofDay !== moved.hardStartSec) changes.push({ id: moved.id, hardStartSec: ofDay });
  return changes;
}
