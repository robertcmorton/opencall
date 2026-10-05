import { formatDuration } from "./format.ts";

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
}

const NOT_THE_ACTIVE_ROW = new Set(["fire", "unplay", "mark_played"]);

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
  let pausedAt: number | null = null;
  let pausedMs = 0;
  const close = (endMs: number) => {
    if (current == null) return;
    const held = pausedAt != null ? endMs - pausedAt : 0;
    const sec = Math.max(0, Math.round((endMs - since - pausedMs - held) / 1000));
    const prev = out.get(current);
    out.set(current, { sec: (prev?.sec ?? 0) + sec, runs: (prev?.runs ?? 0) + 1 });
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
    const next = t.type === "stop" ? null : t.rowId;
    if (next === current) continue;
    close(t.atMs);
    current = next;
    since = t.atMs;
    pausedMs = 0;
    pausedAt = null;
  }
  if (nowMs != null) close(nowMs);
  return out;
}

/** Over (+) or under (−) the planned length, as a sheet shows it: "+0:12", "−1:05". */
export function formatOverUnder(sec: number): string {
  if (sec === 0) return "±0:00";
  const abs = formatDuration(Math.abs(sec)).replace(/^0(\d:)/, "$1");
  return `${sec > 0 ? "+" : "−"}${abs}`;
}
