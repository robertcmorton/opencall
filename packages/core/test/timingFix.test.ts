import { describe, expect, it } from "vitest";
import { computeTiming, findTimingGaps } from "../src/timing";
import { fixAllRecommended, fixChanges, fixChoices, type FixRow } from "../src/timingFix";

/** The timing check's recommended answer (20 Oct). */
const H = 3600;
const r = (id: string, durationSec: number | null, hardStartSec: number | null = null, extra: Partial<FixRow> = {}): FixRow => ({ id, type: "cue", durationSec, hardStartSec, ...extra });
const firstGap = (rows: FixRow[]) => findTimingGaps(rows, computeTiming(rows, null))[0]!;

describe("which fix to recommend", () => {
  it("rows run past a printed time: shorten the last item before it", () => {
    const rows = [r("a", 300, 19 * H), r("b", 400), r("c", 60, 19 * H + 600)]; // 700 s of rows in 600
    const c = fixChoices(rows, firstGap(rows));
    expect(c.recommended).toMatchObject({ kind: "resize", index: 1, fromSec: 400, toSec: 300 });
    expect(c.others.map((o) => o.kind)).toEqual(["move", "accept"]);
  });
  it("too much to absorb: move the printed time instead", () => {
    const rows = [r("a", 300, 19 * H), r("b", 30), r("c", 60, 19 * H + 60)]; // 330 s of rows in 60
    expect(fixChoices(rows, firstGap(rows)).recommended.kind).toBe("move");
  });
  it("a small gap is rounding: lengthen to fill it", () => {
    const rows = [r("a", 300, 19 * H), r("b", 240), r("c", 60, 19 * H + 600)]; // 60 s short
    expect(fixChoices(rows, firstGap(rows)).recommended).toMatchObject({ kind: "resize", toSec: 300 });
  });
  it("a bigger gap is a deliberate wait: leave it", () => {
    const rows = [r("a", 300, 19 * H), r("b", 60), r("c", 60, 19 * H + 1800)];
    expect(fixChoices(rows, firstGap(rows)).recommended.kind).toBe("accept");
  });
  it("a block covering the rows under it: count it once", () => {
    const rows = [r("ht", 900, 20 * H), r("wrap", 300), r("review", 600), r("2h", 2400, 20 * H + 900)];
    expect(fixChoices(rows, firstGap(rows)).recommended.kind).toBe("count-once");
  });
  it("moving carries every fixed time below by the same amount", () => {
    const rows = [r("a", 300, 19 * H), r("b", 30), r("c", 60, 19 * H + 60), r("d", 60, 19 * H + 120)];
    const changes = fixChanges(rows, fixChoices(rows, firstGap(rows)).recommended);
    expect(changes.map((c) => [c.index, c.value])).toEqual([
      [2, 19 * H + 330],
      [3, 19 * H + 390],
    ]);
  });
});

describe("fix all the recommended way", () => {
  it("works through the sheet until it adds up, as one set of changes", () => {
    const rows = [
      r("a", 300, 19 * H),
      r("b", 400),
      r("c", 60, 19 * H + 600), // 100 s over → shorten b
      r("d", 240),
      r("e", 60, 19 * H + 960), // 60 s short → lengthen d
      r("f", 60),
      r("g", 60, 19 * H + 3000), // big gap → leave it
    ];
    const { changes, fixed } = fixAllRecommended(rows, null);
    expect(fixed).toBe(3);
    const after = rows.map((x) => ({ ...x }));
    for (const c of changes) (after[c.index] as Record<string, unknown>)[c.field] = c.value;
    expect(findTimingGaps(after, computeTiming(after, null))).toEqual([]);
    expect(after[1]!.durationSec).toBe(300);
    expect(after[3]!.durationSec).toBe(300);
    expect(after[6]!.acceptedGapSec).toBeGreaterThan(0);
  });
  it("nothing to fix: no changes", () => {
    expect(fixAllRecommended([r("a", 60, 19 * H), r("b", 60, 19 * H + 60)], null)).toEqual({ changes: [], fixed: 0 });
  });
});
