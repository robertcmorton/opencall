import { describe, expect, it } from "vitest";
import { secondsUntilRow } from "../src/live";

// A short sheet: the live row, two items between, then the read.
const durationsSec = [60, 30, 45, 20, 90];

describe("secondsUntilRow", () => {
  it("counts what is left of the live row plus everything between", () => {
    // 12s left of row 0, then rows 1 and 2 in full, to reach row 3.
    expect(secondsUntilRow({ durationsSec, liveIndex: 0, targetIndex: 3, remainingInRowSec: 12 })).toBe(12 + 30 + 45);
  });

  it("is just the rest of the live row when the target is next", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: 1, targetIndex: 2, remainingInRowSec: 8 })).toBe(8);
  });

  // Running over does not push the next item further away — it starts when it
  // is called. Counting the overrun backwards would grow the number.
  it("treats an overrun as zero, not as negative time", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: 1, targetIndex: 3, remainingInRowSec: -25 })).toBe(45);
  });

  it("has nothing to count for the row on air", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: 2, targetIndex: 2, remainingInRowSec: 10 })).toBeNull();
  });

  it("has nothing to count for a row already behind", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: 3, targetIndex: 1, remainingInRowSec: 10 })).toBeNull();
  });

  it("has nothing to count with no show running", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: -1, targetIndex: 3, remainingInRowSec: null })).toBeNull();
  });

  it("has nothing to count for a row off the end of the sheet", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: 0, targetIndex: 99, remainingInRowSec: 10 })).toBeNull();
  });

  // A skipped row arrives as a zero duration, so it must not add time.
  it("skips over rows that take no time", () => {
    expect(secondsUntilRow({ durationsSec: [10, 0, 0, 40], liveIndex: 0, targetIndex: 3, remainingInRowSec: 5 })).toBe(5);
  });

  it("copes with a missing live remaining", () => {
    expect(secondsUntilRow({ durationsSec, liveIndex: 0, targetIndex: 2, remainingInRowSec: null })).toBe(30);
  });
});
