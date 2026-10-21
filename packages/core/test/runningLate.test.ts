import { describe, expect, it } from "vitest";
import { arrivalAtNextFixed, arrivalsAhead, fixedTargets, lateLevel, trimOptions, type LateRow, type LateTiming } from "../src/runningLate";

/** Running late into a period that must start on time (20 Oct). */
const row = (id: string, extra: Partial<LateRow & { durationSec: number; canDrop: boolean }> = {}) => ({ id, type: "cue", ...extra });
// 7:00 walk-in (5m), anthem (2m), sponsor read (1m, can drop), crowd cam (3m), 2nd half 7:11 (40m), bell alongside.
const rows = [
  row("walk", { durationSec: 300 }),
  row("anthem", { durationSec: 120 }),
  row("sponsor", { durationSec: 60, canDrop: true }),
  row("crowd", { durationSec: 180 }),
  row("bell", { durationSec: 30, parallel: true }),
  row("half2", { durationSec: 2400 }),
  row("ad", { durationSec: 60, mustStart: true }),
];
const H = 3600;
const timing: LateTiming[] = [
  { startSec: 19 * H, effectiveDurationSec: 300 },
  { startSec: 19 * H + 300, effectiveDurationSec: 120 },
  { startSec: 19 * H + 420, effectiveDurationSec: 60 },
  { startSec: 19 * H + 480, effectiveDurationSec: 180 },
  { startSec: 19 * H + 500, effectiveDurationSec: 30 },
  { startSec: 19 * H + 660, effectiveDurationSec: 2400 },
  { startSec: 19 * H + 3060, effectiveDurationSec: 60 },
];
const periods = [{ from: 5, kind: "second-half", label: "2nd half" }];
const targets = fixedTargets(rows, timing, periods, (i) => rows[i]!.id);

describe("running late into a fixed time", () => {
  it("finds the periods that must start on time, and rows marked by hand", () => {
    expect(targets.map((t) => [t.index, t.name])).toEqual([
      [5, "2nd half"],
      [6, "ad"],
    ]);
  });
  it("on plan: arrives exactly on time", () => {
    // Anthem on air at 7:05, all of it still to run.
    const a = arrivalAtNextFixed(rows, timing, targets, 1, 120, 19 * H + 300)!;
    expect(a.target.name).toBe("2nd half");
    expect(a.overSec).toBe(0);
  });
  it("an item running over pushes the arrival — the bell alongside doesn't", () => {
    // Anthem started late, at 7:06:20, and is 20 s over at 7:08:40.
    const a = arrivalAtNextFixed(rows, timing, targets, 1, -20, 19 * H + 520)!;
    expect(a.overSec).toBe(520 + 60 + 180 - 660); // now + sponsor + crowd − fixed = +100
    expect(a.overSec).toBe(100);
  });
  it("struck rows give their time back", () => {
    const struck = rows.map((r) => (r.id === "crowd" ? { ...r, skipped: true } : r));
    expect(arrivalAtNextFixed(struck, timing, targets, 1, -20, 19 * H + 520)!.overSec).toBe(-80);
  });
  it("moves on to the next fixed time once one has started", () => {
    expect(arrivalAtNextFixed(rows, timing, targets, 5, 2400, 19 * H + 660)!.target.name).toBe("ad");
  });
  it("says it louder as it gets close", () => {
    const at = (overSec: number, untilSec: number) => lateLevel({ target: targets[0]!, arrivesSec: 0, overSec, untilSec });
    expect(at(90, 20 * 60)).toBe("far");
    expect(at(-30, 10 * 60)).toBe("spare");
    expect(at(20, 10 * 60)).toBe("over");
    expect(at(20, 4 * 60)).toBe("over"); // under 30 s: still just amber
    expect(at(45, 4 * 60)).toBe("urgent");
  });
  it("lists what could be trimmed: can-drop first, then the longest; nothing alongside", () => {
    expect(trimOptions(rows, 1, targets[0]!).map((t) => t.id)).toEqual(["sponsor", "crowd"]);
  });
});

describe("every fixed time ahead (21 Oct)", () => {
  it("lists them all, in order, the first being the next one", () => {
    const all = arrivalsAhead(rows, timing, targets, 1, 120, 19 * H + 300);
    expect(all.map((a) => a.target.name)).toEqual(["2nd half", "ad"]);
    expect(all[0]).toEqual(arrivalAtNextFixed(rows, timing, targets, 1, 120, 19 * H + 300));
  });
  it("carries lateness on: 100 s late into the 2nd half is 100 s late into the next", () => {
    const all = arrivalsAhead(rows, timing, targets, 1, -20, 19 * H + 520);
    expect(all.map((a) => a.overSec)).toEqual([100, 100]);
  });
  it("does not carry time to spare: a period starts at its time, not before", () => {
    const struck = rows.map((r) => (r.id === "crowd" ? { ...r, skipped: true } : r));
    const all = arrivalsAhead(struck, timing, targets, 1, -20, 19 * H + 520);
    expect(all.map((a) => a.overSec)).toEqual([-80, 0]);
  });
  it("is empty with nothing on air", () => {
    expect(arrivalsAhead(rows, timing, targets, -1, null, 0)).toEqual([]);
  });
  it("names the game each fixed time belongs to", () => {
    const two = fixedTargets(rows, timing, [{ from: 2, kind: "first-half", label: "1st half", game: 1 }, { from: 5, kind: "first-half", label: "1st half", game: 2 }], (i) => rows[i]!.id);
    expect(two.map((t) => [t.name, t.game])).toEqual([
      ["1st half", 1],
      ["1st half", 2],
      ["ad", 2],
    ]);
  });

  it("never counts an ending as a fixed time — golden point may not happen", () => {
    const withGp = [...rows, row("gp", { durationSec: 300, outcome: "golden" })];
    const t2 = [...timing, { startSec: 19 * H + 3120, effectiveDurationSec: 300 }];
    const got = fixedTargets(withGp, t2, [...periods, { from: 7, kind: "extra-time", label: "Golden point" }], (i) => withGp[i]!.id);
    expect(got.map((t) => t.name)).toEqual(["2nd half", "ad"]);
  });
});

