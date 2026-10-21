import { describe, expect, it } from "vitest";
import { arrivalAtNextFixed, arrivalsAhead, fixedTargets, lateBy, lateLevel, ON_TIME_SEC, trimOptions, type LateRow, type LateTiming } from "../src/runningLate";

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

  it("does not flicker: a second or two either side of on time is on time (21 Oct)", () => {
    const at = (overSec: number) => lateLevel({ target: targets[0]!, arrivesSec: 0, overSec, untilSec: 10 * 60 });
    for (const wobble of [-2, -1, 0, 1, 2, ON_TIME_SEC]) expect(at(wobble)).toBe("spare");
    expect(at(ON_TIME_SEC + 1)).toBe("over");
    expect([lateBy(1), lateBy(-14), lateBy(16), lateBy(-40)]).toEqual([0, 0, 16, -40]);
  });

});

describe("a block with its contents printed inside it (21 Oct: '13:00 OVER' on time)", () => {
  // 1st half to 6:15, a 5:00 buffer to 6:20, then HALF TIME 13:00 (6:20–6:33)
  // with the half-time items printed INSIDE it at their own times, then the
  // 2nd half at 6:33. Adding lengths counted the 13 minutes twice.
  const M = 60;
  const r = [
    row("half1", { durationSec: 35 * M }),
    row("buffer", { durationSec: 5 * M }),
    row("halftime", { durationSec: 13 * M }),
    row("wrap", { durationSec: 30 }),
    row("reel", { durationSec: 60 }),
    row("relay", { durationSec: 4 * M }),
    row("entry", { durationSec: 30 }),
    row("half2", { durationSec: 40 * M }),
  ];
  const T = 17 * H + 40 * M; // 5:40 pm
  const tm: LateTiming[] = [
    { startSec: T, effectiveDurationSec: 35 * M },
    { startSec: T + 35 * M, effectiveDurationSec: 5 * M },
    { startSec: T + 40 * M, effectiveDurationSec: 13 * M },
    { startSec: T + 40 * M, effectiveDurationSec: 30 },
    { startSec: T + 40 * M + 30, effectiveDurationSec: 60 },
    { startSec: T + 41 * M + 30, effectiveDurationSec: 4 * M },
    { startSec: T + 45 * M + 30, effectiveDurationSec: 30 },
    { startSec: T + 53 * M, effectiveDurationSec: 40 * M },
  ];
  const tg = fixedTargets(r, tm, [{ from: 0, kind: "first-half", label: "1st half" }, { from: 7, kind: "second-half", label: "2nd half" }], (i) => r[i]!.id);
  it("on time, it says on time — the half-time items are not counted on top of the block", () => {
    // In the buffer at 6:17, three minutes of it left.
    const a = arrivalAtNextFixed(r, tm, tg, 1, 180, T + 37 * M)!;
    expect(a.target.name).toBe("2nd half");
    expect(a.overSec).toBe(0);
  });
  it("two minutes late in the buffer is two minutes late at the 2nd half", () => {
    const a = arrivalAtNextFixed(r, tm, tg, 1, 180, T + 39 * M)!;
    expect(a.overSec).toBe(120);
  });
  it("striking the buffer gives its five minutes back", () => {
    const struck = r.map((x) => (x.id === "buffer" ? { ...x, skipped: true } : x));
    // Still in the 1st half at 6:10, on time; the buffer will not be played.
    const a = arrivalAtNextFixed(struck, tm, tg, 0, 5 * M, T + 30 * M)!;
    expect(a.overSec).toBe(-5 * M);
  });
});

describe("what could be trimmed (21 Oct)", () => {
  it("keeps a struck item in the list, marked, where it was", () => {
    const struck = rows.map((r) => (r.id === "crowd" ? { ...r, skipped: true } : r));
    const got = trimOptions(struck, 1, targets[0]!);
    expect(got.map((t) => [t.id, t.struck])).toEqual([
      ["sponsor", false],
      ["crowd", true],
    ]);
  });
  it("offers only the target's own chunk — after the fixed time before it", () => {
    // From the anthem, everything before the ad is on the way; the ad's own
    // chunk starts at the 2nd half.
    expect(trimOptions(rows, 1, targets[1]!).map((t) => t.id)).toEqual(["sponsor", "half2", "crowd"]);
    // From the 2nd half on: the half itself is a fixed time, not a trim, and
    // nothing else sits between it and the ad.
    expect(trimOptions(rows, 1, targets[1]!, targets[0]!.index)).toEqual([]);
  });
});

describe("muted items inside a block still hold the plan (21 Oct: '12:21 to spare' on time)", () => {
  // HALF TIME 15:00 from 8:38 carries the time; the items printed inside it
  // are MUTED (out of the cascade's sum) but keep their printed times and
  // their own lengths. The live cue is on one of them.
  const M = 60;
  const T = 20 * H + 38 * M; // 8:38 pm
  const r = [
    row("halftime", { durationSec: 15 * M }),
    row("relay", { durationSec: 5 * M, durationMuted: true }),
    row("reel", { durationSec: 105, durationMuted: true }),
    row("intro", { durationSec: 15, durationMuted: true }),
    row("squat", { durationSec: 2 * M, durationMuted: true }),
    row("bell", { durationSec: 4 * M, parallel: true }),
    row("entry", { durationSec: 4 * M + 30, durationMuted: true }),
    row("half2", { durationSec: 45 * M }),
  ];
  const tm: LateTiming[] = [
    { startSec: T, effectiveDurationSec: 15 * M },
    { startSec: T + 3 * M + 30, effectiveDurationSec: 0 }, // 8:41:30
    { startSec: T + 8 * M + 30, effectiveDurationSec: 0 }, // 8:46:30
    { startSec: T + 10 * M + 15, effectiveDurationSec: 0 }, // 8:48:15
    { startSec: T + 10 * M + 30, effectiveDurationSec: 0 }, // 8:48:30
    { startSec: T + 11 * M, effectiveDurationSec: 240 },
    { startSec: T + 12 * M + 30, effectiveDurationSec: 0 }, // 8:50:30 → 8:55?
    { startSec: T + 15 * M, effectiveDurationSec: 45 * M }, // 8:53
  ];
  // The entry runs 8:50:30–8:55:00 on paper: two minutes past the half, so
  // the plan itself is 2:00 late; the test below accounts for it.
  const tg = fixedTargets(r, tm, [{ from: 7, kind: "second-half", label: "2nd half" }], (i) => r[i]!.id);
  it("on a muted item, on time, the 2nd half is not 'all the way to spare'", () => {
    // Relay on air at 8:44:30, cued at 8:41:30 — on time, two minutes of its
    // five left. The live timer, which gives a muted row no length, reports
    // that as 3:00 over (−180).
    const a = arrivalAtNextFixed(r, tm, tg, 1, -180, T + 6 * M + 30)!;
    // On plan, the printed items reach 8:55:00 — 2:00 past the 8:53 half.
    expect(a.overSec).toBe(120);
  });
  it("forty-six seconds over on a muted item is forty-six seconds more", () => {
    // 8:47:16, cued at 8:41:30: 5:46 in, so the live timer says −346.
    const a = arrivalAtNextFixed(r, tm, tg, 1, -346, T + 9 * M + 16)!;
    expect(a.overSec).toBe(120 + 46);
  });
  it("striking a muted item gives its time back", () => {
    const struck = r.map((x) => (x.id === "entry" ? { ...x, skipped: true } : x));
    const a = arrivalAtNextFixed(struck, tm, tg, 1, -180, T + 6 * M + 30)!;
    // Without the entry the printed plan ends at 8:50:30 — 2:30 in hand.
    expect(a.overSec).toBe(-150);
  });
  it("a muted item on air is measured by its own length, not the live timer's zero", () => {
    // Relay (5:00, muted) cued at 8:41:30; at 8:43:55 the live timer, which
    // gives it no length, says 2:25 over. By its own five minutes it has 2:35
    // left and is exactly on time.
    const a = arrivalAtNextFixed(r, tm, tg, 1, -145, T + 5 * M + 55)!;
    expect(a.overSec).toBe(120);
  });
});

