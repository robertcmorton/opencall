import { describe, expect, it } from "vitest";
import { computeTiming, cueWindows, rowsOnAt } from "../src/index";

/** Bars on rows that overlap, timed from when each was really cued (20 Oct). */
const H = 3600;
const rows = [
  { id: "anthem", type: "cue" as const, durationSec: 90, hardStartSec: 19 * H },
  { id: "crowd", type: "cue" as const, durationSec: 60, hardStartSec: 19 * H + 30 },
  { id: "prerec", type: "cue" as const, durationSec: 40, hardStartSec: 19 * H + 20, parallel: true },
  { id: "sponsor", type: "cue" as const, durationSec: 60, hardStartSec: 19 * H + 60 },
];
const timing = computeTiming(rows, 19 * H);

describe("windows while a show is live", () => {
  // Called by hand, late: anthem at +10, crowd at +40; sponsor not yet.
  const cued = new Map([
    ["anthem", 19 * H + 10],
    ["crowd", 19 * H + 40],
  ]);
  const w = cueWindows(rows, timing, cued);
  it("a cued row runs from when it was cued, for its length", () => {
    expect(w.rows[0]).toMatchObject({ startSec: 19 * H + 10, endSec: 19 * H + 100 });
    expect(w.rows[1]).toMatchObject({ startSec: 19 * H + 40, endSec: 19 * H + 100 });
  });
  it("a row not cued yet has no window — no bar for something not happening", () => {
    expect(w.rows[3]).toMatchObject({ startSec: null, endSec: null });
  });
  it("a row running alongside keeps its printed window", () => {
    expect(w.rows[2]).toEqual(timing.rows[2]);
  });
  it("so at +95 s both overlapping rows are still on (printed times said the anthem ended at +90)", () => {
    expect(rowsOnAt(rows, w, 19 * H + 95).sort()).toEqual(["anthem", "crowd"]);
    expect(rowsOnAt(rows, timing, 19 * H + 95)).not.toContain("anthem");
  });
});
