import { computeTiming } from "./timing.ts";
import { findDecisionPoints } from "./goldenPoint.ts";
import { findPhases } from "./phases.ts";
import { fixedTargets } from "./runningLate.ts";
import type { PlanRow } from "./types.ts";

/** What a row needs for its must-start status to be worked out. */
export type MustStartRow = PlanRow & { title?: string; outcomeGame?: number; mustStart?: boolean };

/**
 * The rows that must start on time, by index — the way the sheet works them
 * out (23 Oct): the first row of each half, quarter and extra period, and every
 * row marked "Must start on time". The same chain the editor builds from its
 * own memos (full time → each game's end → its periods → `fixedTargets`), for
 * code that has only the rows: the assistant's edits, which re-time the sheet
 * and must stop at the same rows the editor does.
 */
export function mustStartIndexes(rows: readonly MustStartRow[], plannedStartSec: number | null = null): number[] {
  const timing = computeTiming(rows.slice(), plannedStartSec);
  const decisions = findDecisionPoints(
    rows.map((r, i) => ({ title: r.title ?? "", hardStartSec: r.hardStartSec ?? timing.rows[i]?.startSec ?? null, outcome: r.outcome, type: r.type })),
  );
  // A sheet that wrote its own endings has no full time to find; the first
  // ending of each game stands in, as in the editor.
  let ends = decisions;
  if (ends.length === 0) {
    const first: number[] = [];
    rows.forEach((r, i) => {
      const g = (r.outcomeGame ?? 1) - 1;
      if (r.outcome && first[g] == null) first[g] = i;
    });
    ends = first.filter((i) => i != null);
  }
  const phases = findPhases(rows.map((r) => ({ title: r.title ?? "", durationSec: r.durationSec })), ends);
  return fixedTargets(rows, timing.rows, phases, () => "")
    .filter((t) => !t.end)
    .map((t) => t.index);
}
