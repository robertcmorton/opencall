import { describe, expect, it } from "vitest";
import { clockStep, clockTargetRow, type ClockTargetRow, firstCueRow, nextCueRow, passThroughRows, rowStartedAtMs } from "../src/live";

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
    expect(clockStep(sheet, durations, "half2", 240)).toEqual({ kind: "advance", rowId: "gpHead", overSec: 0 });
  });

  it("plays an untimed row for its length and moves on", () => {
    expect(clockStep(sheet, durations, "hold", 5)).toEqual({ kind: "hold", reason: "running" });
    expect(clockStep(sheet, durations, "hold", 12)).toEqual({ kind: "advance", rowId: "gp1", overSec: 0 });
  });

  /**
   * A branch head is a label for what follows and carries no length. Stalling
   * on it would leave the cue on a caption while the extra period ran beneath,
   * and the chooser waits for the cue to reach the period's LAST row.
   */
  it("passes straight through a row with no length of its own", () => {
    expect(clockStep(sheet, durations, "gpHead", 0)).toEqual({ kind: "advance", rowId: "hold", overSec: 0 });
  });

  it("hands back to the clock once the block is behind it", () => {
    expect(clockStep(sheet, durations, "gp1", 30)).toEqual({ kind: "advance", rowId: "nextKick", overSec: 0 });
    expect(clockStep(sheet, durations, "nextKick", 5)).toEqual({ kind: "clock" });
  });

  it("steps over a heading and a pre-record to find the next real row", () => {
    const rows = [row("a", 100), row("head", null, { type: "group" }), row("vt", null, { parallel: true }), row("b", null)];
    expect(clockStep(rows, [60, null, 45, 30], "a", 60)).toEqual({ kind: "advance", rowId: "b", overSec: 0 });
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
    expect(rowStartedAtMs({ kind: "advance", rowId: "r7", overSec: 0 }, plannedMs, nowMs)).toBe(nowMs);
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
    const step = clockStep(rows, durations, "hold", backdated);
    expect(step).toEqual({ kind: "advance", rowId: "half", overSec: 120 });

    const stampedNow = (nowMs - rowStartedAtMs(step, plannedMs, nowMs)) / 1000;
    expect(clockStep(rows, durations, "hold", stampedNow)).toEqual({ kind: "hold", reason: "running" });
  });
});

/**
 * The period that decides a final, which nobody can put a length on.
 *
 * The laws: a drawn final goes to golden point played "with no change of ends
 * or time limit, until a point is scored". The sheet carries a row with no
 * duration because there is no honest number to print. The clock used to read
 * "no duration" as "takes no time" and walk straight past it, carrying the
 * show out of a match that was still being played.
 */
describe("an open-ended period", () => {
  const rows = [
    { id: "cap", type: "cue" as const, hardStartSec: null, title: "FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME" },
    { id: "hold", type: "cue" as const, hardStartSec: null, title: "HOLDING — golden point re-set" },
    { id: "gp", type: "cue" as const, hardStartSec: null, title: "Golden point" },
    { id: "after", type: "cue" as const, hardStartSec: null, title: "Presentation" },
  ];
  const durations = [null, 120, null, 300];

  it("holds on golden point rather than walking out of the match", () => {
    expect(clockStep(rows, durations, "gp", 600)).toEqual({ kind: "hold", reason: "unknowable" });
    // Still holding an hour in: it lasts as long as it lasts.
    expect(clockStep(rows, durations, "gp", 3600)).toEqual({ kind: "hold", reason: "unknowable" });
  });

  /**
   * The caption that OPENS the block has the same wording and the same missing
   * duration, and must still be passed through — holding there would park the
   * show on a label while the extra period ran underneath it.
   */
  it("still passes through the caption that opens the block", () => {
    expect(clockStep(rows, durations, "cap", 0)).toEqual({ kind: "advance", rowId: "hold", overSec: 0 });
  });

  // A hold before the period is a hold, and runs its length like any other.
  it("runs the hold before it for its length", () => {
    expect(clockStep(rows, durations, "hold", 30)).toEqual({ kind: "hold", reason: "running" });
    expect(clockStep(rows, durations, "hold", 120)).toEqual({ kind: "advance", rowId: "gp", overSec: 0 });
  });
});

/**
 * The note rows a person reads past (21 Oct 2026).
 *
 * A show run on the clock from start to finish came back with every timed item
 * at ±0:00 except the ones either side of a few rows like "(3:30)": no time,
 * no length, the next item starting at the same moment. The clock stopped on
 * each for a tick — "ran 00:01" in the record — and started the next item a
 * second late.
 */
describe("rows the clock goes past", () => {
  type R = ClockTargetRow & { durationSec?: number | null };
  const r = (id: string, extra: Partial<R> = {}): R => ({ id, type: "cue", hardStartSec: null, durationSec: 60, ...extra });

  it("marks a row with no time and no length when the next item starts at the same moment", () => {
    const rows = [r("relay", { hardStartSec: 100 }), r("note", { durationSec: null, title: "(3:30)" }), r("anthem")];
    const marked = passThroughRows(rows, [100, 160, 160]);
    expect(marked.map((x) => !!x.passThrough)).toEqual([false, true, false]);
  });

  it("keeps a row that stands for the time up to the next printed row", () => {
    // "STANDBY FOR HALF TIME": nothing in its cells, and the hooter 40 minutes on.
    const rows = [r("kick", { hardStartSec: 100, durationSec: 0 }), r("standby", { durationSec: null }), r("ht", { hardStartSec: 2500 })];
    expect(passThroughRows(rows, [100, 100, 2500]).map((x) => !!x.passThrough)).toEqual([false, false, false]);
  });

  it("keeps endings, golden point, printed times and rows with a length", () => {
    const rows = [
      r("a", { hardStartSec: 100 }),
      r("ending", { durationSec: null, outcome: "golden" }),
      r("gp", { durationSec: null, title: "Golden point" }),
      r("printed", { durationSec: null, hardStartSec: 160 }),
      r("zero", { durationSec: 0, hardStartSec: null }),
      r("last", { durationSec: null }),
    ];
    const starts = [100, 160, 160, 160, 160, 160];
    // `zero` has no length either and passes; the last row has nothing after it to say so.
    expect(passThroughRows(rows, starts).map((x) => !!x.passThrough)).toEqual([false, false, false, false, true, false]);
  });

  it("looks past headings and pre-records for the next item", () => {
    const rows = [r("note", { durationSec: null }), r("head", { type: "group" }), r("vt", { parallel: true, hardStartSec: 900 }), r("item")];
    expect(passThroughRows(rows, [100, 100, 900, 100]).map((x) => !!x.passThrough)).toEqual([true, false, false, false]);
  });

  it("steps from the item before straight to the item after", () => {
    const rows = passThroughRows([r("relay"), r("note", { durationSec: null }), r("anthem")], [100, 160, 160]);
    expect(clockStep(rows, [60, null, 60], "relay", 60.4)).toEqual({ kind: "advance", rowId: "anthem", overSec: expect.closeTo(0.4, 5) });
  });

  it("never aims at one or opens the show on one", () => {
    const rows = passThroughRows([r("note", { durationSec: null }), r("first", { hardStartSec: 100 })], [100, 100]);
    expect(clockTargetRow(rows, [100, 100], 130)).toBe("first");
    expect(firstCueRow(rows, [100, 100])?.id).toBe("first");
  });

  // On a cue sheet the untimed lines ARE the cues; Next goes through each.
  it("is still where Next goes when a person presses it", () => {
    const rows = passThroughRows([r("relay"), r("note", { durationSec: null }), r("anthem")], [100, 160, 160]);
    expect(nextCueRow(rows, "relay")).toBe("note");
    expect(nextCueRow(rows, "relay", new Set(), true)).toBe("anthem");
  });

  /** The bug the STANDBY row would have hit: half time, called at kick-off. */
  it("leaves a row with no length to the clock when a printed time follows", () => {
    const rows = [r("kick", { hardStartSec: 100, durationSec: 0 }), r("standby", { durationSec: null }), r("ht", { hardStartSec: 2500 })];
    expect(clockStep(rows, [0, null, 900], "standby", 5)).toEqual({ kind: "clock" });
  });
});

describe("a step lands on the second the last row ended", () => {
  const nowMs = 1_700_000_000_000;

  it("dates the next row back to when the length ran out", () => {
    expect(rowStartedAtMs({ kind: "advance", rowId: "b", overSec: 0.7 }, 0, nowMs)).toBe(nowMs - 700);
  });

  it("starts it now when the length ran out long ago", () => {
    expect(rowStartedAtMs({ kind: "advance", rowId: "b", overSec: 30 }, 0, nowMs)).toBe(nowMs);
  });

  /** Five rows of a minute each, looked at once a second, lose nothing. */
  it("loses no time over a run of steps", () => {
    const rows = [0, 1, 2, 3, 4].map((i) => ({ id: `r${i}`, type: "cue", hardStartSec: i === 0 ? 0 : null }));
    const durations = rows.map(() => 60);
    let startedAt = 0;
    let at = "r0";
    for (let tick = 1; tick <= 400 && at !== "r4"; tick++) {
      const nowMs = tick * 1000 + 337; // the clock looks a third of a second off the beat
      const step = clockStep(rows, durations, at, (nowMs - startedAt) / 1000);
      if (step.kind !== "advance") continue;
      startedAt = rowStartedAtMs(step, 0, nowMs);
      at = step.rowId;
    }
    expect(at).toBe("r4");
    expect(startedAt).toBe(4 * 60 * 1000);
  });
});
