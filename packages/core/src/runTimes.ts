import { formatDuration } from "./format.ts";
import type { PlanTiming } from "./types.ts";

/**
 * How long each row actually ran on the night, from the as-run log.
 *
 * Every transition the server records names the row on air AFTER it — start,
 * next, previous, jump, the clock moving on, a hold, stop (none) — so walking
 * the log in order, a row's time on air runs from the transition that put it
 * there to the next one that put something else there. Pauses inside that
 * span are taken off. A row cued twice (played, then brought back) has its
 * runs added together.
 *
 * Three kinds of entry name some OTHER row and are skipped: `fire` (a pool
 * cue's label), and `unplay` / `mark_played` (the row whose tick changed).
 */
export interface Transition {
  atMs: number;
  type: string;
  rowId: string | null;
}

export interface RowRun {
  /** Seconds on air, pauses excluded, all runs added together. */
  sec: number;
  /** How many separate times it went on air. */
  runs: number;
  /**
   * When the show JOINED this row rather than arriving at it in turn: Start
   * put it there, or the clock caught up to it the moment it was handed the
   * show back. Either can land part-way through an item, and then the record
   * only saw the rest of it — see `joinedLateSec`. First run only.
   */
  joinedAtMs?: number;
}

const NOT_THE_ACTIVE_ROW = new Set(["fire", "unplay", "mark_played"]);

/** The clock looks once a second; a move this soon after it was switched on is it catching up. */
const CATCH_UP_MS = 3000;

/**
 * Seconds on air per row. The row still on air is included up to `nowMs`
 * when given, and left out otherwise — a running total should not count an
 * item as finished while it is still going.
 */
export function runTimes(transitions: readonly Transition[], nowMs: number | null = null): Map<string, RowRun> {
  const out = new Map<string, RowRun>();
  const ordered = [...transitions].sort((a, b) => a.atMs - b.atMs);
  let current: string | null = null;
  let since = 0;
  let joinedHere = false;
  // The last entry that was about the cue, for telling a clock catch-up apart.
  let lastType = "";
  let lastAt = -Infinity;
  let pausedAt: number | null = null;
  let pausedMs = 0;
  const close = (endMs: number) => {
    if (current == null) return;
    const held = pausedAt != null ? endMs - pausedAt : 0;
    const sec = Math.max(0, Math.round((endMs - since - pausedMs - held) / 1000));
    const prev = out.get(current);
    const joined = prev ? prev.joinedAtMs : joinedHere ? since : undefined;
    out.set(current, { sec: (prev?.sec ?? 0) + sec, runs: (prev?.runs ?? 0) + 1, ...(joined != null ? { joinedAtMs: joined } : {}) });
  };
  for (const t of ordered) {
    if (NOT_THE_ACTIVE_ROW.has(t.type)) continue;
    if (t.type === "pause") {
      if (pausedAt == null) pausedAt = t.atMs;
      continue;
    }
    if (t.type === "resume") {
      if (pausedAt != null) pausedMs += t.atMs - pausedAt;
      pausedAt = null;
      continue;
    }
    const caughtUp = t.type === "jump" && lastType === "clock_on" && t.atMs - lastAt <= CATCH_UP_MS;
    lastType = t.type;
    lastAt = t.atMs;
    const next = t.type === "stop" ? null : t.rowId;
    if (next === current) continue;
    close(t.atMs);
    current = next;
    since = t.atMs;
    joinedHere = t.type === "start" || caughtUp;
    pausedMs = 0;
    pausedAt = null;
  }
  if (nowMs != null) close(nowMs);
  return out;
}

/** The fields of a row that `ranOverUnder` reads. */
export interface RanRow {
  id: string;
  type: string;
  durationSec: number | null;
  parallel?: boolean;
  durationMuted?: boolean;
  skipped?: boolean;
  /** Covers the rows beneath it — see `PlanRow.spans`. */
  spans?: boolean;
}

/**
 * Rows whose length is played by the rows inside them.
 *
 * "HALF TIME 15:00" with the wrap, the highlights and the ad reel printed
 * beneath it, inside those fifteen minutes. The show goes straight into the
 * first of them, so the block itself is on air for a second, and the record
 * read "ran 00:01" against "15:00 planned" (21 Oct 2026) — fourteen minutes
 * fifty-nine under, for a half time that ran exactly to time. Its fifteen
 * minutes are measured by its items, not by it.
 *
 * Two shapes, both from the importer: a row marked `spans`, whose contents'
 * lengths add up to its own; and a row followed by muted rows that are printed
 * inside its window (`contained` at import). Muted is the tell for the second:
 * the contents keep their lengths out of the running order because the block
 * already pays for them.
 */
export function blockRowIds(rows: readonly RanRow[], timing: PlanTiming): Set<string> {
  const out = new Set<string>();
  rows.forEach((r, i) => {
    if (r.type !== "cue" || r.parallel) return;
    if (r.spans) {
      out.add(r.id);
      return;
    }
    const start = timing.rows[i]?.startSec ?? null;
    const len = r.durationSec ?? 0;
    if (start == null || len <= 0 || r.durationMuted) return;
    for (let j = i + 1; j < rows.length; j++) {
      const c = rows[j]!;
      if (c.type === "group" || c.type === "milestone" || c.parallel || c.skipped) continue;
      if (!c.durationMuted) return; // the next real item: no contents, or they are over
      const at = timing.rows[j]?.startSec ?? null;
      if (at != null && at >= start && at < start + len - 1) {
        out.add(r.id);
        return;
      }
    }
  });
  return out;
}

/** More than this late counts as joining a row part-way through — the same allowance as "on time". */
export const JOINED_LATE_SEC = 15;

/**
 * How far into a row the show was when it JOINED it, if that cut the row
 * short.
 *
 * Starting a show after its first item was due puts it on air part-way
 * through, and the clock then ends that item at its planned end. The record
 * saw only the rest: a first half planned at 48:00, joined thirteen minutes
 * in, read "ran 34:38" and "−13:22" (21 Oct 2026), as if the half had been cut.
 * It had not; the show arrived late to it.
 *
 * `sheetSecOf` turns a moment into the sheet's own time of day (the event's
 * zone, and past midnight for a sheet that runs into the next day). Null when
 * the show arrived at the row in turn, joined it on time, or the row
 * ran its whole length anyway, which is what happens when somebody starts a
 * late show by hand and lets each item run.
 */
export function joinedLateSec(
  run: RowRun | undefined,
  plannedStartSec: number | null | undefined,
  plannedSec: number | null | undefined,
  sheetSecOf: (ms: number) => number,
): number | null {
  if (run?.joinedAtMs == null || plannedStartSec == null || plannedSec == null) return null;
  const late = Math.round(sheetSecOf(run.joinedAtMs) - plannedStartSec);
  if (late <= JOINED_LATE_SEC) return null;
  return run.sec < plannedSec - JOINED_LATE_SEC ? late : null;
}

/**
 * The running total: over (+) or under (−) across the items played, counting
 * only what counts in the running order — not rows alongside the show, muted
 * ones, or rows with no planned length. Null when nothing counted has played.
 *
 * `leaveOut` names rows whose time on air says nothing about their length:
 * blocks (`blockRowIds`) and rows the show joined part-way (`joinedLateSec`).
 *
 * Shared so the sheet's "Ran" readout and the dashboard's "last run" say the
 * same number.
 */
export function ranOverUnder(
  rows: readonly RanRow[],
  runOf: (rowId: string) => RowRun | undefined,
  leaveOut: ReadonlySet<string> = new Set(),
): number | null {
  let total = 0;
  let counted = 0;
  for (const r of rows) {
    const run = runOf(r.id);
    if (!run || r.type !== "cue" || r.durationSec == null || r.parallel || r.durationMuted) continue;
    if (leaveOut.has(r.id)) continue;
    total += run.sec - r.durationSec;
    counted++;
  }
  return counted > 0 ? total : null;
}

/** Over (+) or under (−) the planned length, as a sheet shows it: "+0:12", "−1:05". */
export function formatOverUnder(sec: number): string {
  if (sec === 0) return "±0:00";
  const abs = formatDuration(Math.abs(sec)).replace(/^0(\d:)/, "$1");
  return `${sec > 0 ? "+" : "−"}${abs}`;
}
