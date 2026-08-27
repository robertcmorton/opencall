import { describe, expect, it } from "vitest";
import {
  GOLDEN_HALF_SEC,
  HOLDING_SEC,
  goldenPointBlock,
  goldenPointDurationSec,
  shiftAnchorsAfter,
} from "../src/index";

describe("the block a sheet never wrote down", () => {
  it("holds before each half, not just between the halves", () => {
    // The laws give no break; the SHOW needs one either side — cameras reset,
    // commentary comes back, the crowd is told what is happening.
    expect(goldenPointBlock().map((r) => r.title)).toEqual([
      "HOLDING",
      "Golden point — first half",
      "HOLDING",
      "Golden point — second half",
    ]);
  });

  it("plays five minutes a side", () => {
    const halves = goldenPointBlock().filter((r) => /first half|second half/.test(r.title));
    expect(halves).toHaveLength(2);
    for (const h of halves) expect(h.durationSec).toBe(GOLDEN_HALF_SEC);
    expect(GOLDEN_HALF_SEC).toBe(5 * 60);
  });

  it("costs the night both halves and both holds", () => {
    expect(goldenPointDurationSec()).toBe(2 * GOLDEN_HALF_SEC + 2 * HOLDING_SEC);
  });

  it("takes the competition's own word for the period", () => {
    // Not every competition calls it golden point, and the sheet should say
    // what the people in the room say.
    expect(goldenPointBlock("Extra time").map((r) => r.title)).toContain("Extra time — first half");
  });
});

describe("what moves below it", () => {
  const rows = [
    { id: "kickoff", hardStartSec: 19 * 3600 },
    { id: "second-half", hardStartSec: 20 * 3600 },
    { id: "full-time", hardStartSec: null },
    { id: "presentation", hardStartSec: 21 * 3600 + 30 * 60 },
    { id: "sponsor", hardStartSec: null },
    { id: "off-air", hardStartSec: 21 * 3600 + 50 * 60 },
  ];

  it("moves every printed time after the insertion by the whole block", () => {
    const moved = shiftAnchorsAfter(rows, 2, goldenPointDurationSec());
    expect(moved.map((m) => m.id)).toEqual(["presentation", "off-air"]);
    expect(moved[0]!.to - moved[0]!.from).toBe(goldenPointDurationSec());
  });

  it("never touches a time before the insertion", () => {
    // Kick-off and the second half have already gone to air. Their times are
    // the record of when that happened, and moving them would rewrite history —
    // quite apart from kick-off being the one time broadcast holds us to.
    const moved = shiftAnchorsAfter(rows, 2, goldenPointDurationSec());
    expect(moved.map((m) => m.id)).not.toContain("kickoff");
    expect(moved.map((m) => m.id)).not.toContain("second-half");
  });

  it("leaves rows without a printed time alone", () => {
    // They follow from the durations above them and need no help; rewriting
    // them would invent an anchor the sheet never had.
    const moved = shiftAnchorsAfter(rows, 2, goldenPointDurationSec());
    expect(moved.map((m) => m.id)).not.toContain("sponsor");
  });

  it("does nothing at all when nothing is added", () => {
    expect(shiftAnchorsAfter(rows, 2, 0)).toEqual([]);
  });

  it("moves nothing when the block goes on the end", () => {
    expect(shiftAnchorsAfter(rows, rows.length - 1, goldenPointDurationSec())).toEqual([]);
  });
});
