import { computeTiming, findTimingGaps, type TimingGap } from "./timing.ts";
import type { PlanRow } from "./types.ts";

/**
 * The timing check's answers, and which one to recommend (20 Oct, Robert:
 * "it feels very complicated and wordy… do you have a button which would be
 * the recommended option?").
 *
 * A disagreement between a printed start time and the lengths above it has
 * four possible answers. The recommendation trusts the PRINTED TIMES — on a
 * run sheet they are the plan the production agreed, and the lengths are how
 * somebody filled the space:
 *
 *  · a block that covers the rows under it (HALF TIME 15:00 over its own
 *    contents) → count it once;
 *  · the rows run past a printed time → shorten the last item before it, if
 *    it is long enough to give the time back; otherwise move the time;
 *  · a small gap (two minutes or less) → lengthen the last item to fill it —
 *    a printed sheet rounds;
 *  · a bigger gap → it is a deliberate wait (doors, a changeover): leave it.
 */

export type FixRow = PlanRow & { title?: string; acceptedGapSec?: number | null };

export type TimingFix =
  | { kind: "count-once"; index: number }
  | { kind: "resize"; index: number; fromSec: number; toSec: number }
  | { kind: "move"; index: number; deltaSec: number }
  | { kind: "accept"; index: number; gapSec: number };

export interface FixChoices {
  recommended: TimingFix;
  others: TimingFix[];
}

/** Gaps up to this size are taken as rounding on the printed sheet. */
export const SMALL_GAP_SEC = 120;

export function fixChoices(rows: readonly FixRow[], gap: TimingGap): FixChoices {
  const from = rows[gap.fromIndex]!;
  let absorbIndex = gap.toIndex - 1;
  while (absorbIndex > gap.fromIndex && rows[absorbIndex]!.durationSec == null) absorbIndex--;
  const absorb = rows[absorbIndex]!;
  const was = absorb.durationSec ?? 0;
  const overlap = gap.gapSec < 0;
  const absorbResolves = was + gap.gapSec >= 0;
  const spansContents = overlap && (from.durationSec ?? 0) > 0 && Math.abs((from.durationSec ?? 0) + gap.gapSec) < 1;

  const countOnce: TimingFix = { kind: "count-once", index: gap.fromIndex };
  const resize: TimingFix = { kind: "resize", index: absorbIndex, fromSec: was, toSec: Math.max(0, was + gap.gapSec) };
  const move: TimingFix = { kind: "move", index: gap.toIndex, deltaSec: -gap.gapSec };
  const accept: TimingFix = { kind: "accept", index: gap.toIndex, gapSec: gap.gapSec };

  const all: TimingFix[] = [...(spansContents ? [countOnce] : []), ...(absorbResolves && !spansContents ? [resize] : []), move, accept];
  const recommended = spansContents
    ? countOnce
    : overlap
      ? absorbResolves
        ? resize
        : move
      : gap.gapSec <= SMALL_GAP_SEC && absorbResolves
        ? resize
        : accept;
  return { recommended, others: all.filter((f) => f !== recommended) };
}

/** One field written on one row. */
export interface FixChange {
  index: number;
  field: "durationSec" | "durationMuted" | "hardStartSec" | "acceptedGapSec";
  value: number | boolean;
}

/** What a fix writes. "move" carries every fixed time from that row down by the same amount. */
export function fixChanges(rows: readonly FixRow[], fix: TimingFix): FixChange[] {
  switch (fix.kind) {
    case "count-once":
      return [{ index: fix.index, field: "durationMuted", value: true }];
    case "resize":
      return [{ index: fix.index, field: "durationSec", value: fix.toSec }];
    case "accept":
      return [{ index: fix.index, field: "acceptedGapSec", value: fix.gapSec }];
    case "move": {
      const out: FixChange[] = [];
      for (let i = fix.index; i < rows.length; i++) {
        const at = rows[i]!.hardStartSec;
        if (at != null) out.push({ index: i, field: "hardStartSec", value: at + fix.deltaSec });
      }
      return out;
    }
  }
}

/**
 * Every disagreement on the sheet, fixed the recommended way — one after the
 * other, because fixing one can change the next. Returns the changes to
 * write (in one go, so one undo takes them all back) and how many were fixed.
 */
export function fixAllRecommended(rows: readonly FixRow[], plannedStartSec: number | null): { changes: FixChange[]; fixed: number } {
  const work = rows.map((r) => ({ ...r }));
  const changes: FixChange[] = [];
  let fixed = 0;
  const seen = new Set<string>();
  for (let guard = 0; guard < 500; guard++) {
    const gaps = findTimingGaps(work, computeTiming(work, plannedStartSec));
    const gap = gaps[0];
    if (!gap) break;
    // The same disagreement twice means a fix didn't take: call it deliberate
    // rather than loop.
    const key = `${gap.toIndex}:${gap.gapSec}`;
    const fix = seen.has(key) ? ({ kind: "accept", index: gap.toIndex, gapSec: gap.gapSec } as TimingFix) : fixChoices(work, gap).recommended;
    seen.add(key);
    for (const c of fixChanges(work, fix)) {
      (work[c.index] as Record<string, unknown>)[c.field] = c.value;
      changes.push(c);
    }
    fixed++;
  }
  return { changes, fixed };
}
