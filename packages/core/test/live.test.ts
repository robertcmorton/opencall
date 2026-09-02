import { describe, expect, it } from "vitest";
import {
  mayEditShow,
  computeLiveTiming,
  computeTiming,
  type PlanRow,
  clockTargetRow,
  firstCueRow,
  followerMayMove,
  secondsUntilShow,
} from "../src/index";

const NINE_AM = 9 * 3600;
const rows: PlanRow[] = [
  { id: "a", type: "cue", durationSec: 90, hardStartSec: NINE_AM },
  { id: "b", type: "cue", durationSec: 120, hardStartSec: null },
  { id: "c", type: "cue", durationSec: 60, hardStartSec: null },
];
const timing = computeTiming(rows);

// Fixed clock world: t0 ms == 9:00:00 of day; helper maps ms → seconds-of-day linearly.
const T0 = 1_000_000_000;
const toSecondsOfDay = (ms: number) => NINE_AM + (ms - T0) / 1000;

describe("computeLiveTiming", () => {
  it("counts down inside a row and reports zero drift when on time", () => {
    // Row b planned 9:01:30; started exactly on time; 30s in.
    const startedAt = T0 + 90_000;
    const live = computeLiveTiming({
      timing,
      activeRowId: "b",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: startedAt + 30_000,
      toSecondsOfDay,
    })!;
    expect(live.elapsedInRowSec).toBe(30);
    expect(live.remainingInRowSec).toBe(90);
    expect(live.rowOverSec).toBe(0);
    expect(live.showDriftSec).toBe(0);
    expect(live.projectedEndSec).toBe(timing.endSec);
  });

  it("reports overrun and pushes drift + projected end", () => {
    // Row b started 40s late, and has been running 150s (30s over its 120s plan).
    const startedAt = T0 + 130_000;
    const live = computeLiveTiming({
      timing,
      activeRowId: "b",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: startedAt + 150_000,
      toSecondsOfDay,
    })!;
    expect(live.rowOverSec).toBe(30);
    expect(live.showDriftSec).toBe(70); // 40 late + 30 over
    expect(live.projectedEndSec).toBe(timing.endSec! + 70);
  });

  it("shows negative drift when running early", () => {
    // Row c planned 9:03:30 but started 50s early, 10s in.
    const startedAt = T0 + 160_000;
    const live = computeLiveTiming({
      timing,
      activeRowId: "c",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: startedAt + 10_000,
      toSecondsOfDay,
    })!;
    expect(live.showDriftSec).toBe(-50);
    expect(live.projectedEndSec).toBe(timing.endSec! - 50);
  });

  it("freezes elapsed while paused and honors accumulated pause time", () => {
    const startedAt = T0;
    const live = computeLiveTiming({
      timing,
      activeRowId: "a",
      activeRowStartedAtMs: startedAt,
      pausedAccumMs: 20_000,
      pausedAtMs: startedAt + 60_000, // paused at the 60s wall-clock mark
      nowMs: startedAt + 500_000, // long after — must not matter
      toSecondsOfDay,
    })!;
    expect(live.elapsedInRowSec).toBe(40); // 60 wall − 20 paused
  });

  it("returns null for an unknown active row", () => {
    expect(
      computeLiveTiming({
        timing,
        activeRowId: "nope",
        activeRowStartedAtMs: T0,
        pausedAccumMs: 0,
        pausedAtMs: null,
        nowMs: T0,
        toSecondsOfDay,
      }),
    ).toBeNull();
  });
});

describe("clockTargetRow: a row that contradicts the sheet's order", () => {
  const row = (id: string, hardStartSec: number | null) => ({ id, type: "cue", hardStartSec });

  it("does not park the clock on an am/pm typo", () => {
    // The reported case: "5:26:00 am" typed for a bell at row 3, between rows
    // at 5:25 PM and 5:26 PM. Its time has "passed" from early morning on, and
    // it sits further down the sheet than anything genuinely current — so it
    // won the whole afternoon and Follow clock parked the show on it.
    const rows = [
      row("a", 13 * 3600 + 15 * 60), // 1:15 PM
      row("b", 17 * 3600 + 25 * 60), // 5:25 PM
      row("bell", 5 * 3600 + 26 * 60), // 5:26 AM ← the typo
      row("c", 17 * 3600 + 26 * 60), // 5:26 PM
    ];
    const starts = rows.map((r) => r.hardStartSec);
    // 2:25 PM: only the 1:15 PM row has genuinely passed.
    expect(clockTargetRow(rows, starts, 14 * 3600 + 25 * 60)).toBe("a");
    // …and by 5:25:30 PM the clock has reached "b", never the bell.
    expect(clockTargetRow(rows, starts, 17 * 3600 + 25 * 60 + 30)).toBe("b");
  });

  it("still follows a sheet that runs past midnight", () => {
    // Counted past midnight by the cascade, so 00:05 is 24:05 — forwards.
    const rows = [row("late", 23 * 3600 + 55 * 60), row("after", 24 * 3600 + 5 * 60)];
    const starts = rows.map((r) => r.hardStartSec);
    expect(clockTargetRow(rows, starts, 24 * 3600 + 10 * 60)).toBe("after");
  });

  it("still follows a row listed a few minutes out of order", () => {
    const rows = [row("a", 18 * 3600 + 23 * 60 + 30), row("bell", 18 * 3600 + 22 * 60), row("b", 18 * 3600 + 25 * 60)];
    const starts = rows.map((r) => r.hardStartSec);
    expect(clockTargetRow(rows, starts, 18 * 3600 + 24 * 60)).toBe("bell");
  });
});

describe("a row the sheet gives no duration runs until the next one starts", () => {
  // The reported live show, to the second. "STANDBY FOR HALF TIME" at 8:08 PM
  // covers the forty minutes of the first half; the sheet writes no duration
  // for a game. Half time is anchored at 8:48 PM.
  const half: PlanRow[] = [
    { id: "kick", type: "cue", durationSec: 0, hardStartSec: 20 * 3600 + 2 * 60 },
    { id: "play", type: "cue", durationSec: null, hardStartSec: 20 * 3600 + 8 * 60 },
    { id: "halftime", type: "cue", durationSec: 900, hardStartSec: 20 * 3600 + 48 * 60 },
  ];
  const at = (h: number, m: number, s = 0) =>
    computeLiveTiming({
      timing: computeTiming(half, null),
      activeRowId: "play",
      activeRowStartedAtMs: Date.UTC(2026, 7, 14, 20, 8, 0),
      pausedAccumMs: 0,
      pausedAtMs: null,
      nowMs: Date.UTC(2026, 7, 14, h, m, s),
      toSecondsOfDay: (ms) => {
        const d = new Date(ms);
        return d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
      },
    })!;

  it("does not call the show late twelve minutes into the half", () => {
    const live = at(20, 20, 13);
    expect(live.rowOverSec).toBe(0);
    expect(live.showDriftSec).toBe(0);
  });

  it("counts down the rest of the half instead of up", () => {
    expect(at(20, 20, 13).remainingInRowSec).toBe(40 * 60 - (12 * 60 + 13));
  });

  it("still reports overrun once the half really has run long", () => {
    const live = at(20, 50, 0); // two minutes past the 8:48 hooter
    expect(live.rowOverSec).toBe(120);
    expect(live.showDriftSec).toBe(120);
  });
});

describe("followerMayMove", () => {
  // A pre-record is written near where it is SHOT. Here row "pre" sits below
  // "b" on the sheet but airs before it — the shape that trapped a live show.
  const sheet = [{ id: "a" }, { id: "b" }, { id: "pre", parallel: true }, { id: "c" }];

  it("lets the clock take the show off a pre-record", () => {
    // The trap: every legitimate target looked "backwards" from here, so the
    // follower refused to move and the show sat there until the drift went red.
    expect(followerMayMove(sheet, "pre", "b")).toBe(true);
    expect(followerMayMove(sheet, "pre", "a")).toBe(true);
  });

  it("still refuses to walk a show backwards through the order", () => {
    // The reason the guard exists: 02:00–02:59 happens twice when clocks go back.
    expect(followerMayMove(sheet, "c", "a")).toBe(false);
    expect(followerMayMove(sheet, "b", "a")).toBe(false);
  });

  it("moves forwards freely, and standing still is not backwards", () => {
    expect(followerMayMove(sheet, "a", "c")).toBe(true);
    expect(followerMayMove(sheet, "b", "b")).toBe(true);
  });

  it("does not count pre-records when measuring the distance", () => {
    // "c" is one step after "b" in the running order even though a pre-record
    // is printed between them.
    expect(followerMayMove(sheet, "c", "b")).toBe(false);
  });

  it("allows the move when either row is unknown", () => {
    expect(followerMayMove(sheet, null, "a")).toBe(true);
    expect(followerMayMove(sheet, "a", "nope")).toBe(true);
  });
});

/**
 * The invariant the show-start fix rests on: before the sheet's first item, the
 * clock points at NOTHING.
 *
 * "Start show" used to cue whatever the console suggested — the first row — even
 * with the clock driving and that row hours away. A sheet opening at 1:15 PM,
 * started at 9:04 AM, counted down an item that had not begun and reported the
 * show four hours ahead of itself. The server now asks the clock which row to
 * open on, so this answering null is what makes it wait.
 */
describe("clockTargetRow before the sheet begins", () => {
  const H = 3600;
  const rows = [
    { id: "a", type: "cue" as const, skipped: false },
    { id: "b", type: "cue" as const, skipped: false },
  ];
  const starts = [13 * H + 15 * 60, 14 * H]; // 1:15 PM, 2:00 PM

  it("points at nothing hours before the first item", () => {
    expect(clockTargetRow(rows, starts, 9 * H + 4 * 60)).toBeNull();
  });

  it("points at nothing one second before the first item", () => {
    expect(clockTargetRow(rows, starts, 13 * H + 15 * 60 - 1)).toBeNull();
  });

  it("takes the first item the moment its time arrives", () => {
    expect(clockTargetRow(rows, starts, 13 * H + 15 * 60)).toBe("a");
  });

  it("and moves on at the next", () => {
    expect(clockTargetRow(rows, starts, 14 * H)).toBe("b");
  });
});

/**
 * A reminder is not a cue.
 *
 * From a real sheet: a milestone reading TEAM LIST DUE, timed 6:30 PM, sitting
 * in the sheet between rows at 7:06 and 7:02. At 7:03 the clock took it as the
 * show — so the second half, genuinely on air since 6:26, had nothing pointing
 * at it, and the big timer wore the deadline's name and counted up in red,
 * because a milestone has no duration and can only ever read as overrun.
 */
describe("clockTargetRow ignores rows that are not the show", () => {
  const at = (h: number, m: number) => h * 3600 + m * 60;

  const rows = [
    { id: "secondHalf", type: "cue" },
    { id: "spare41", type: "cue" },
    { id: "spare42", type: "cue" },
    { id: "teamListDue", type: "milestone" },
    { id: "coinToss", type: "cue", parallel: true },
    { id: "fullTime", type: "group" },
    { id: "wrap", type: "cue" },
  ];
  //                secondHalf  41        42        milestone  preRec    group  wrap
  const starts = [at(18, 26), at(19, 6), at(19, 6), at(18, 30), at(19, 2), null, at(19, 11)];

  it("stays on the item that is actually on air", () => {
    expect(clockTargetRow(rows, starts, at(19, 3))).toBe("secondHalf");
  });

  it("does not take a deadline as the cue even once its time has passed", () => {
    // 6:31 PM — one minute after the milestone, still inside the second half.
    expect(clockTargetRow(rows, starts, at(18, 31))).toBe("secondHalf");
  });

  it("still moves on to the next real item when its time comes", () => {
    expect(clockTargetRow(rows, starts, at(19, 12))).toBe("wrap");
  });

  it("keeps ignoring the pre-record and the group heading", () => {
    for (const t of [at(19, 2), at(19, 3), at(19, 5)]) {
      expect(clockTargetRow(rows, starts, t)).not.toBe("coinToss");
      expect(clockTargetRow(rows, starts, t)).not.toBe("fullTime");
    }
  });
});

/**
 * Going live before the show is due.
 *
 * Pressing Start at 11am on a sheet whose first cue is 8pm used to put that
 * item on air nine hours early — the big timer counting an item nobody was
 * running, and reading as overdue all afternoon. The show can begin before the
 * first item does; these pin the gap between the two.
 */
describe("the wait before the first cue", () => {
  const EIGHT_PM = 20 * 3600;
  const ELEVEN_SIXTEEN_AM = 11 * 3600 + 16 * 60;

  const sheet: PlanRow[] = [
    { id: "doors", type: "milestone", durationSec: null, hardStartSec: 19 * 3600 },
    { id: "opener", type: "cue", durationSec: 600, hardStartSec: EIGHT_PM },
    { id: "two", type: "cue", durationSec: 600, hardStartSec: null },
  ];
  const startsOf = (rs: PlanRow[]) => computeTiming(rs).rows.map((r) => r.startSec);
  const starts = startsOf(sheet);

  it("names the first item that can actually be called, not the first row", () => {
    // The 7pm milestone is a deadline to hit, not something to go to air on.
    expect(firstCueRow(sheet, starts)).toEqual({ id: "opener", index: 1, startSec: EIGHT_PM });
  });

  it("counts down the hours between going live and the first cue", () => {
    expect(secondsUntilShow(sheet, starts, ELEVEN_SIXTEEN_AM)).toBe(EIGHT_PM - ELEVEN_SIXTEEN_AM);
  });

  it("stops waiting once the first cue is due", () => {
    expect(secondsUntilShow(sheet, starts, EIGHT_PM)).toBeNull();
    expect(secondsUntilShow(sheet, starts, EIGHT_PM + 1)).toBeNull();
  });

  it("waits right up to the last second", () => {
    expect(secondsUntilShow(sheet, starts, EIGHT_PM - 1)).toBe(1);
  });

  it("has nothing to wait for when no row carries a time", () => {
    const untimed: PlanRow[] = [{ id: "a", type: "cue", durationSec: 600, hardStartSec: null }];
    expect(secondsUntilShow(untimed, [null], ELEVEN_SIXTEEN_AM)).toBeNull();
    expect(firstCueRow(untimed, [null])).toBeNull();
  });

  it("skips a first row that is skipped, a heading, or a pre-record", () => {
    const messy: PlanRow[] = [
      { id: "head", type: "group", durationSec: null, hardStartSec: 19 * 3600 },
      { id: "vt", type: "cue", durationSec: 300, hardStartSec: 19 * 3600 + 1800, parallel: true },
      { id: "cut", type: "cue", durationSec: 300, hardStartSec: 19 * 3600 + 2400, skipped: true },
      { id: "real", type: "cue", durationSec: 600, hardStartSec: EIGHT_PM },
    ];
    expect(firstCueRow(messy, startsOf(messy))?.id).toBe("real");
  });
});

/**
 * Who may change the sheet from the show console. Everyone in show mode could,
 * which let a crew member with a join code re-time a live show — measured, a
 * follower's -30 took the on-air row from 00:30 to 00:00.
 */
describe("who may edit from the show console", () => {
  it("is the roles that may drive the show", () => {
    expect(mayEditShow("caller")).toBe(true);
    expect(mayEditShow("admin")).toBe(true);
  });
  it("is not a follower, a viewer, or nobody", () => {
    expect(mayEditShow("follower")).toBe(false);
    expect(mayEditShow("viewer")).toBe(false);
    expect(mayEditShow(null)).toBe(false);
    expect(mayEditShow(undefined)).toBe(false);
  });
});
