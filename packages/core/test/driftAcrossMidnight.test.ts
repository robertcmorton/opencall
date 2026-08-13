import { describe, expect, it } from "vitest";
import { computeLiveTiming } from "../src/live";
import type { PlanTiming } from "../src/types";

const H = 3600;
/** Wall clock at a given absolute sheet second — it wraps, as a clock does. */
const wallClockAt = (absSec: number) => (ms: number) => ((absSec % 86400) + 86400) % 86400;

/**
 * A run sheet that opens at 23:54 and runs for two days — the shape that
 * exposed this. `startSec` counts past midnight; the clock does not.
 */
const timing = (rows: { id: string; startSec: number; dur: number }[]): PlanTiming => ({
  rows: rows.map((r) => ({
    id: r.id,
    startSec: r.startSec,
    endSec: r.startSec + r.dur,
    effectiveDurationSec: r.dur,
    anchored: false,
    backtimed: false,
  })),
  startSec: rows[0]!.startSec,
  endSec: rows[rows.length - 1]!.startSec + rows[rows.length - 1]!.dur,
  totalDurationSec: rows.reduce((n, r) => n + r.dur, 0),
});

const sheet = timing([
  { id: "before", startSec: 23 * H + 54 * 60, dur: 6 * 60 }, // 23:54 day 1
  { id: "atMidnight", startSec: 24 * H, dur: 2 * 60 }, // 00:00 day 2
  { id: "dayThree", startSec: 48 * H + H, dur: 30 * 60 }, // 01:00 day 3
]);

const driftFor = (rowId: string, absStartSec: number) =>
  computeLiveTiming({
    timing: sheet,
    activeRowId: rowId,
    activeRowStartedAtMs: 0,
    pausedAccumMs: 0,
    pausedAtMs: null,
    nowMs: 0,
    toSecondsOfDay: wallClockAt(absStartSec),
  })!.showDriftSec;

describe("show drift across a midnight", () => {
  it("is zero when a row starts exactly on its cue, before midnight", () => {
    expect(driftFor("before", 23 * H + 54 * 60)).toBe(0);
  });

  // The bug: the clock wraps to 0 while the sheet's own second is 86400, and
  // subtracting the two reported the whole day that had just been crossed.
  // A show sitting exactly on its cue read "-24:00:00".
  it("does not report a day of drift for a row cued at midnight", () => {
    expect(driftFor("atMidnight", 24 * H)).toBe(0);
  });

  it("still reads real lateness at the rollover", () => {
    expect(driftFor("atMidnight", 24 * H + 38)).toBe(38);
    expect(driftFor("atMidnight", 24 * H - 15)).toBe(-15);
  });

  // Two days out the offset is two days — a single +1 would still be wrong.
  it("holds on the third day", () => {
    expect(driftFor("dayThree", 48 * H + H)).toBe(0);
    expect(driftFor("dayThree", 48 * H + H + 45)).toBe(45);
  });
});
