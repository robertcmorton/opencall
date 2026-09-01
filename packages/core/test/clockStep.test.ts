import { describe, expect, it } from "vitest";
import { clockStep, type ClockTargetRow, rowStartedAtMs } from "../src/live";

/**
 * Extra time is the case this exists for: nobody knows when golden point will
 * happen, so nobody writes a time against it, and a clock that only aims at
 * printed times can neither enter the block nor be stopped from stepping over
 * it. The reported symptoms were all one fault — the second half pinned red
 * and overrunning, the big timer stuck counting up, the result chooser never
 * returning, and finally the show jumping into the next match with the result
 * still uncalled.
 */
const row = (id: string, hardStartSec: number | null, extra: Partial<ClockTargetRow> = {}): ClockTargetRow => ({
  id,
  type: "cue",
  hardStartSec,
  untimed: hardStartSec == null,
  ...extra,
});

describe("clockStep", () => {
  // second half, then a golden-point block with no times, then the next match
  const sheet = [row("half2", 43_200), row("gpHead", null), row("hold", null), row("gp1", null), row("nextKick", 44_100)];
  const durations = [240, 0, 12, 30, 60];

  it("leaves the clock alone where every row has a time", () => {
    expect(clockStep([row("a", 100), row("b", 200)], [60, 60], "a", 10)).toEqual({ kind: "clock" });
  });

  it("holds on the row before an untimed block until that row has run", () => {
    expect(clockStep(sheet, durations, "half2", 100)).toEqual({ kind: "hold", reason: "running" });
  });

  /** The jump that carried the show into the next match with the result uncalled. */
  it("steps into the untimed block rather than over it", () => {
    expect(clockStep(sheet, durations, "half2", 240)).toEqual({ kind: "advance", rowId: "gpHead" });
  });

  it("plays an untimed row for its length and moves on", () => {
    expect(clockStep(sheet, durations, "hold", 5)).toEqual({ kind: "hold", reason: "running" });
    expect(clockStep(sheet, durations, "hold", 12)).toEqual({ kind: "advance", rowId: "gp1" });
  });

  /**
   * A branch head is a label for what follows and carries no length. Stalling
   * on it would leave the cue on a caption while the extra period ran beneath,
   * and the chooser waits for the cue to reach the period's LAST row.
   */
  it("passes straight through a row with no length of its own", () => {
    expect(clockStep(sheet, durations, "gpHead", 0)).toEqual({ kind: "advance", rowId: "hold" });
  });

  it("hands back to the clock once the block is behind it", () => {
    expect(clockStep(sheet, durations, "gp1", 30)).toEqual({ kind: "advance", rowId: "nextKick" });
    expect(clockStep(sheet, durations, "nextKick", 5)).toEqual({ kind: "clock" });
  });

  it("steps over a heading and a pre-record to find the next real row", () => {
    const rows = [row("a", 100), row("head", null, { type: "group" }), row("vt", null, { parallel: true }), row("b", null)];
    expect(clockStep(rows, [60, null, 45, 30], "a", 60)).toEqual({ kind: "advance", rowId: "b" });
  });

  it("waits when there is nowhere left to go", () => {
    const rows = [row("a", 100), row("openEnded", null)];
    expect(clockStep(rows, [60, null], "openEnded", 999)).toEqual({ kind: "hold", reason: "unknowable" });
  });
});

/**
 * The stamp that says when the row began — and the bug it was written for.
 *
 * Every clock move used to be backdated to the planned start, which is right
 * for a printed row and catastrophic for one the sheet never timed: the plan
 * puts the whole extra-time block at full time, so the row is stamped as
 * having begun minutes before it did, and the very next tick finds it over its
 * length and advances again.
 */
describe("when the row it moved to began", () => {
  const nowMs = 1_700_000_000_000;
  const plannedMs = nowMs - 4 * 60 * 1000; // full time, four minutes ago

  it("backdates a row the clock reached", () => {
    expect(rowStartedAtMs({ kind: "clock" }, plannedMs, nowMs)).toBe(plannedMs);
  });

  it("starts a stepped-into row now", () => {
    expect(rowStartedAtMs({ kind: "advance", rowId: "r7" }, plannedMs, nowMs)).toBe(nowMs);
  });

  /**
   * The whole point, stated as the loop that broke: stamp the row with the
   * plan and it is instantly older than its own length, so `clockStep` says
   * advance — every tick, all the way through the block.
   */
  it("does not hand back a start that is already past the row's length", () => {
    const rows = [
      { id: "hold", type: "cue" as const, hardStartSec: null },
      { id: "half", type: "cue" as const, hardStartSec: null },
    ];
    const durations = [120, 300];
    const backdated = (nowMs - plannedMs) / 1000; // 240s elapsed on a 120s hold
    expect(clockStep(rows, durations, "hold", backdated)).toEqual({ kind: "advance", rowId: "half" });

    const stampedNow = (nowMs - rowStartedAtMs({ kind: "advance", rowId: "hold" }, plannedMs, nowMs)) / 1000;
    expect(clockStep(rows, durations, "hold", stampedNow)).toEqual({ kind: "hold", reason: "running" });
  });
});
