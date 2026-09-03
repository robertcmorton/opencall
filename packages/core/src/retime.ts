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
const timeOfDay = (sec: number): number => ((sec % 86400) + 86400) % 86400;

/**
 * The fixed times that change when the row at `from` is moved to `to` — the
 * index it ends up at, the way a list reorders.
 *
 * The rows it jumped over move by its length: earlier when it went down past
 * them, later when it came up past them. The moved row itself takes the time
 * its new place implies — the end of the row now above it — worked out with
 * its own old time out of the way. Rows outside the span keep their times,
 * because the running order before and after them is unchanged.
 */
export function fixedTimesAfterMove(
  rows: readonly PlanRow[],
  from: number,
  to: number,
  plannedStartSec: number | null = null,
): FixedTime[] {
  const moved = rows[from];
  if (!moved || from === to || to < 0 || to >= rows.length) return [];
  const changes: FixedTime[] = [];
  const len = moved.skipped || moved.outcome ? 0 : runningLength(moved);
  const jumped = from < to ? rows.slice(from + 1, to + 1) : rows.slice(to, from);
  const delta = from < to ? -len : len;
  if (delta !== 0) {
    for (const r of jumped) {
      if (r.hardStartSec != null) changes.push({ id: r.id, hardStartSec: timeOfDay(r.hardStartSec + delta) });
    }
  }
  // A pre-record sits at its own time wherever on the sheet it is written.
  if (moved.hardStartSec == null || moved.parallel) return changes;
  const shifted = new Map(changes.map((c) => [c.id, c.hardStartSec]));
  const trial: PlanRow[] = rows.map((r) =>
    r.id === moved.id
      ? { ...r, hardStartSec: null }
      : shifted.has(r.id)
        ? { ...r, hardStartSec: shifted.get(r.id)! }
        : r,
  );
  const [row] = trial.splice(from, 1);
  trial.splice(to, 0, row!);
  const start = computeTiming(trial, plannedStartSec).rows[to]?.startSec;
  if (start == null) return changes;
  const ofDay = timeOfDay(start);
  if (ofDay !== moved.hardStartSec) changes.push({ id: moved.id, hardStartSec: ofDay });
  return changes;
}
