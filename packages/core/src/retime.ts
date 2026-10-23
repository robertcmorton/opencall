import { computeTiming } from "./timing.ts";
import type { PlanRow } from "./types.ts";

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

/**
 * Adding and deleting rows re-time the sheet (23 Oct, Robert: "when adding a
 * new row — the time needs to correspond to its placement in the sheet, and
 * the duration needs to ripple to other items below. When deleting a row, it
 * should follow the same logic").
 *
 * They did not. A new item flowed from the row above — the right time for
 * where it sits — but every printed time below stayed put, so a one-minute item
 * put in after 4:15 (15:00) ran "at the same time as" the 4:30 item, and the
 * sheet said so in a tooltip instead of moving it. Deleting left a hole the
 * length of the deleted row.
 *
 * Now the time ripples — DOWN TO THE NEXT ROW THAT MUST START ON TIME, and
 * stops there (Robert: "adding a row should affect things and we should see in
 * our 'on time' window if we are correct"). Kick-off, each half and any row
 * marked "Must start on time" are set by somebody else — the broadcaster, the
 * referee — and do not move because an item was added before them. The rows
 * between take the change; if they no longer fit, they run past the fixed
 * time, and the on-time window says by how much and offers what could go. A
 * first version rippled through to the end of the sheet: kick-off moved with
 * the new item, and the window measuring lateness against kick-off had nothing
 * to say about a show that would now start a minute late.
 *
 * `mustStart` is the set of those rows' indexes in `rows` (see
 * mustStartIndexes). One with no printed time is given its current time, so
 * the rows above it moving cannot carry it along.
 */

/**
 * A yellow fixed time — DOORS OPEN 6:00 — keeps its time when the sheet
 * re-times (23 Oct, Robert: "this is a general time only. the cues work in the
 * background of doors open. it literally means that people can enter the
 * event"). The doors open at six whatever the show is doing, so a ripple goes
 * past it rather than moving it, and does not stop there either: the cues
 * around it move as they would have. An item that took its start from it —
 * no printed time of its own, straight after it — moves with the cues: it is
 * given its new time, or it would stay tied to six o'clock.
 */
export const keepsItsTime = (row: Pick<PlanRow, "type" | "hardStartSec">): boolean => row.type === "milestone" && row.hardStartSec != null;

/** What an added or deleted row puts into, or takes out of, the running order. */
const lengthInOrder = (row: PlanRow): number => (row.skipped || row.outcome ? 0 : runningLength(row));

/**
 * The rows that keep their time: each must-start row, and the rows straight in
 * front of it that start at the same moment. A sheet's "Kick-off" milestone, or
 * a FIRST HALF heading, sits just above the half that is the must-start row and
 * at its time; rippling those and holding the half put "Kick-off 6:32" over
 * "First half 6:30", measured on the first try.
 */
function heldRows(starts: readonly { startSec: number | null }[], mustStart: ReadonlySet<number>): Set<number> {
  const held = new Set<number>();
  for (const w of mustStart) for (let j = heldFrom(starts, w); j <= w; j++) held.add(j);
  return held;
}

/**
 * The first row of the run straight in front of `index` that starts at the
 * same moment as it — `index` itself when there is none. A ripple running down
 * to a must-start row stops before this, not just before the row: the on-time
 * window's own trims moved the "Kick-off" milestone to 6:31 and left the half
 * it belongs to at 6:32.
 */
export function heldFrom(starts: readonly { startSec: number | null }[], index: number): number {
  const at = starts[index]?.startSec;
  let j = index;
  if (at == null) return j;
  while (j - 1 >= 0 && starts[j - 1]?.startSec === at) j--;
  return j;
}

/**
 * Where a ripple running down from `from` stops, for the edits that move every
 * printed time below by an amount — a changed length, a strike (23 Oct: they
 * went on to the end of the sheet, kick-off included, while adding and
 * deleting a row stopped in front of it). `stop` is the first row at or after
 * `from` that keeps its time — a must-start row, or one at its moment straight
 * in front of it — or `rows.length`; shift `from` up to `stop - 1`. `pin` is
 * that row's current time when it has no printed one, so the rows above it
 * moving cannot carry it along: set it with the shift, or not at all.
 */
export function rippleStop(
  rows: readonly PlanRow[],
  from: number,
  mustStart: ReadonlySet<number>,
  plannedStartSec: number | null = null,
): { stop: number; pin: FixedTime | null } {
  if (mustStart.size === 0) return { stop: rows.length, pin: null };
  const starts = computeTiming(rows.slice(), plannedStartSec).rows;
  const held = heldRows(starts, mustStart);
  for (let i = Math.max(0, from); i < rows.length; i++) {
    if (!held.has(i)) continue;
    const now = starts[i]?.startSec;
    const pin = rows[i]!.hardStartSec == null && now != null ? { id: rows[i]!.id, hardStartSec: timeOfDay(now) } : null;
    return { stop: i, pin };
  }
  return { stop: rows.length, pin: null };
}

/**
 * How much a new length moves the rows below (23 Oct). Empty counts as no
 * length: clearing a 1:00 used to move nothing, so the minute it had added
 * stayed in the times below for good. A pre-record or a block whose items
 * carry its time moves nothing whatever its length; a muted or struck row is
 * outside the running order.
 */
export function lengthChangeShift(row: PlanRow, fromSec: number | null, toSec: number | null): number {
  if (row.durationMuted || row.skipped || row.parallel || row.spans) return 0;
  return Math.max(0, toSec ?? 0) - Math.max(0, fromSec ?? 0);
}

export interface AddRetime {
  /** Fixed times below the new rows, and what they become. */
  changes: FixedTime[];
  /**
   * A fixed time for the first new row, when it would otherwise have none: at
   * the top of a sheet with no planned start nothing above it carries a time
   * to flow from, so it takes the time of the row it pushed down. Null means it
   * flows from the row above, which is where it sits.
   */
  firstStartSec: number | null;
}

/**
 * Rows `added` going in at `at` — ahead of `rows[at]`, or at the end when `at`
 * is `rows.length`. `rows` is the sheet as it is before they go in.
 */
export function timesAfterAdd(
  rows: readonly PlanRow[],
  at: number,
  added: readonly PlanRow[],
  plannedStartSec: number | null = null,
  liveIndex = -1,
  mustStart: ReadonlySet<number> = new Set(),
): AddRetime {
  const changes: FixedTime[] = [];
  // Above the live cue is the past: what is written in there costs the show
  // nothing from here on, and the cue on air never moves.
  const shift = liveIndex >= 0 && at <= liveIndex ? 0 : added.reduce((n, r) => n + lengthInOrder(r), 0);
  if (shift !== 0) {
    const starts = computeTiming(rows.slice(), plannedStartSec).rows;
    const held = heldRows(starts, mustStart);
    let afterKept = false;
    for (let i = at; i < rows.length; i++) {
      const r = rows[i]!;
      if (held.has(i)) {
        const now = starts[i]?.startSec;
        if (r.hardStartSec == null && now != null) changes.push({ id: r.id, hardStartSec: timeOfDay(now) });
        break;
      }
      if (keepsItsTime(r)) {
        afterKept = true;
        continue;
      }
      const now = starts[i]?.startSec;
      if (r.hardStartSec != null) changes.push({ id: r.id, hardStartSec: timeOfDay(r.hardStartSec + shift) });
      else if (afterKept && !r.parallel && now != null) changes.push({ id: r.id, hardStartSec: timeOfDay(now + shift) });
      if (!r.parallel) afterKept = false;
    }
  }
  let firstStartSec: number | null = null;
  const first = added[0];
  const displaced = rows[at];
  if (first && first.hardStartSec == null && !first.parallel && displaced?.hardStartSec != null) {
    const withIt = [...rows.slice(0, at), first, ...rows.slice(at)];
    if (computeTiming(withIt, plannedStartSec).rows[at]?.startSec == null) firstStartSec = displaced.hardStartSec;
  }
  return { changes, firstStartSec };
}

/**
 * The fixed times that change when the rows in `deleted` go. Every row below a
 * deleted one, down to the next row that must start on time, starts earlier by
 * the length that left above it; the must-start row keeps its time, and the
 * time freed up waits in front of it. A row that flowed from a deleted fixed
 * row takes that row's time: its anchor is gone, and without one it would
 * start from wherever the next anchor up happened to be — or nowhere, at the
 * top of a sheet with no planned start.
 */
export function timesAfterDelete(
  rows: readonly PlanRow[],
  deleted: ReadonlySet<string>,
  liveIndex = -1,
  mustStart: ReadonlySet<number> = new Set(),
  plannedStartSec: number | null = null,
): FixedTime[] {
  const changes: FixedTime[] = [];
  const starts = computeTiming(rows.slice(), plannedStartSec).rows;
  const held = heldRows(starts, mustStart);
  let shift = 0;
  /** A deleted anchor's time, moved by what left above it, for the next row that stays. */
  let inherited: number | null = null;
  /** Straight after a yellow fixed time that kept its time — see keepsItsTime. */
  let afterKept = false;
  rows.forEach((r, i) => {
    if (deleted.has(r.id)) {
      if (r.hardStartSec != null && !r.parallel) inherited = r.hardStartSec + shift;
      if (!(liveIndex >= 0 && i < liveIndex)) shift -= lengthInOrder(r);
      return;
    }
    if (held.has(i)) {
      // It keeps its time whatever left above it — pinned if it only had one
      // by flowing from rows that have just moved.
      const now = starts[i]?.startSec;
      if (r.hardStartSec == null && (shift !== 0 || inherited != null) && now != null) changes.push({ id: r.id, hardStartSec: timeOfDay(now) });
      shift = 0;
      inherited = null;
      afterKept = false;
      return;
    }
    // A pre-record sits at its own time and is never what a row flows from.
    if (r.parallel) {
      if (r.hardStartSec != null && shift !== 0) changes.push({ id: r.id, hardStartSec: timeOfDay(r.hardStartSec + shift) });
      return;
    }
    if (keepsItsTime(r)) {
      inherited = null;
      afterKept = shift !== 0;
      return;
    }
    const now = starts[i]?.startSec;
    if (r.hardStartSec != null) {
      if (shift !== 0) changes.push({ id: r.id, hardStartSec: timeOfDay(r.hardStartSec + shift) });
    } else if (inherited != null) {
      changes.push({ id: r.id, hardStartSec: timeOfDay(inherited) });
    } else if (afterKept && now != null) {
      changes.push({ id: r.id, hardStartSec: timeOfDay(now + shift) });
    }
    inherited = null;
    afterKept = false;
  });
  return changes;
}
