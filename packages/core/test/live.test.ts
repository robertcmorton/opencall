import { describe, expect, it } from "vitest";
import { computeLiveTiming, computeTiming, type PlanRow, clockTargetRow } from "../src/index";

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
