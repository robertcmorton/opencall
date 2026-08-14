import { describe, expect, it } from "vitest";
import { checkStartTimes } from "../src/index";

const H = 3600;
const at = (...secs: (number | null)[]) => secs.map((startSec) => ({ startSec }));

describe("checkStartTimes", () => {
  it("names an am typed for a pm, and what it should be", () => {
    // The real one: a bell between 5:25 PM and 5:26 PM.
    const w = checkStartTimes(at(13 * H, 17 * H + 25 * 60, 5 * H + 26 * 60, 17 * H + 26 * 60));
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ index: 2, kind: "meridiem", suggestSec: 17 * H + 26 * 60 });
  });

  it("calls an elapsed offset what it is, not a midnight time", () => {
    // Cue sheets write position within a segment in the same column.
    const w = checkStartTimes(at(13 * H, 14 * H, 15, 75, 16 * H));
    expect(w.map((x) => x.kind)).toEqual(["offset", "offset"]);
    expect(w[0]!.suggestSec).toBeUndefined();
  });

  it("says nothing about a sheet that simply runs forwards", () => {
    expect(checkStartTimes(at(9 * H, 10 * H, 11 * H, 20 * H))).toEqual([]);
  });

  it("allows a row listed a few minutes out of order", () => {
    // Bells and team entries are written near, not exactly at, their moment.
    expect(checkStartTimes(at(18 * H + 23 * 60, 18 * H + 22 * 60, 18 * H + 25 * 60))).toEqual([]);
  });

  it("stays quiet on a sheet that genuinely runs through midnight", () => {
    // If most of the rows look wrong, the rule is wrong — not the sheet.
    const overnight = at(23 * H, 0, 30 * 60, 60 * 60, 90 * 60, 2 * H, 3 * H);
    expect(checkStartTimes(overnight)).toEqual([]);
  });

  it("skips rows with no time of their own", () => {
    expect(checkStartTimes(at(13 * H, null, null, 14 * H))).toEqual([]);
  });
});
