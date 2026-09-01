import { describe, expect, it } from "vitest";
import { compressSegment } from "../lib/compressTimes";

describe("compressSegment", () => {
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);

  it("lands on the target exactly", () => {
    const out = compressSegment([300, 45, 45, 60, 90], 10, 54);
    expect(sum(out)).toBe(54);
  });

  it("keeps every row within a second of its own scaled length", () => {
    const lengths = [300, 45, 45, 60, 90];
    const out = compressSegment(lengths, 10, null);
    lengths.forEach((len, i) => expect(Math.abs(out[i]! - len / 10)).toBeLessThanOrEqual(1));
  });

  /**
   * THE BUG THIS EXISTS FOR. The old code put the whole remainder on the last
   * row and floored it at one second, so a remainder bigger than that row could
   * give back was dropped and the stretch stayed too long.
   */
  it("gives back more than the last row alone could", () => {
    const out = compressSegment([600, 600, 600, 20], 10, 100);
    expect(sum(out)).toBe(100);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(1);
  });

  it("never returns a row of no length", () => {
    const out = compressSegment([1, 1, 1, 1], 10, 4);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(1);
  });

  it("does not drift over many rows", () => {
    // A hundred rows of 45s at a tenth: naive rounding gives 100 x 5 = 500,
    // against a true 450. Cumulative rounding cannot drift like that.
    const out = compressSegment(new Array(100).fill(45), 10, null);
    expect(sum(out)).toBe(450);
  });
});
