import { describe, expect, it } from "vitest";
import {
  computeTiming,
  detectPreRecords,
  findTimingGaps,
  type ClassifiedRow,
  type PlanRow,
} from "../src/index";

const cue = (title: string): ClassifiedRow => ({
  kind: "cue",
  title,
  startSec: null,
  startRaw: null,
  durationSec: null,
  durationRaw: null,
  cells: {},
  sourceIndex: 0,
});

describe("detectPreRecords", () => {
  it("marks a row whose title opens with Pre Record", () => {
    const rows = [cue("Pre Record - COIN TOSS with Jacob Kertabani")];
    detectPreRecords(rows);
    expect(rows[0]!.parallel).toBe(true);
  });

  it("accepts the spellings real sheets use", () => {
    const rows = [cue("PRE RECORD WALK OVER"), cue("Pre-record - Dem Mob"), cue("Prerecording - tunnel")];
    detectPreRecords(rows);
    expect(rows.map((r) => r.parallel)).toEqual([true, true, true]);
  });

  it("does NOT mark the VTR that plays the pre-record back", () => {
    // This is the one that matters: the playback is a real cue that genuinely
    // takes seventy-five seconds of the running order.
    const rows = [cue("VTR - Pre Record - Coin Toss"), cue("VTR - Member Signing PRE RECORD"), cue("VTR - Fun Fair (pre record)")];
    detectPreRecords(rows);
    expect(rows.map((r) => r.parallel)).toEqual([undefined, undefined, undefined]);
  });

  it("does not mark a row that merely mentions one", () => {
    const rows = [cue("MC Chat with Dem Mob"), cue("Stadium Evac (Pre-rec audio)")];
    detectPreRecords(rows);
    expect(rows.map((r) => r.parallel)).toEqual([undefined, undefined]);
  });

  it("finds the label on a later line of a merged row", () => {
    const rows = [cue("Extra Buffer\nPre Record - PLAYER WALK OVER - tunnel")];
    detectPreRecords(rows);
    expect(rows[0]!.parallel).toBe(true);
  });

  it("marks a group banner too", () => {
    const rows: ClassifiedRow[] = [{ ...cue("PRE RECORD WALK OVER"), kind: "banner" }];
    detectPreRecords(rows);
    expect(rows[0]!.parallel).toBe(true);
  });
});

describe("a pre-record takes no time in the running order", () => {
  const rows: PlanRow[] = [
    { id: "a", type: "cue", durationSec: 600, hardStartSec: 18 * 3600 },
    { id: "prerec", type: "cue", durationSec: 60, hardStartSec: 19 * 3600, parallel: true },
    { id: "b", type: "cue", durationSec: 300, hardStartSec: null },
  ];

  it("contributes nothing to the cascade", () => {
    const timing = computeTiming(rows, null);
    // b follows a directly: 18:00 + 10 min, with the pre-record adding nothing
    // — neither its length nor, crucially, its 19:00 anchor.
    expect(timing.rows[2]!.startSec).toBe(18 * 3600 + 600);
    expect(timing.totalDurationSec).toBe(900);
  });

  it("keeps its own length and its own place on the clock", () => {
    // The crew shooting it need a real start and a real countdown.
    const timing = computeTiming(rows, null);
    expect(timing.rows[1]!.startSec).toBe(19 * 3600);
    expect(timing.rows[1]!.effectiveDurationSec).toBe(60);
    expect(timing.rows[1]!.endSec).toBe(19 * 3600 + 60);
  });

  it("is not reported by the timing check", () => {
    // Its 19:00 anchor is nowhere near where the chain has reached, which as
    // an ordinary row would be a large hole followed by a large overlap.
    expect(findTimingGaps(rows, computeTiming(rows, null))).toEqual([]);
  });

  it("does not become the point later rows are measured from", () => {
    const withLater: PlanRow[] = [...rows, { id: "c", type: "cue", durationSec: 60, hardStartSec: 18 * 3600 + 900 }];
    const gaps = findTimingGaps(withLater, computeTiming(withLater, null));
    expect(gaps).toEqual([]);
  });

  it("still reports a real disagreement elsewhere on the sheet", () => {
    const broken: PlanRow[] = [...rows, { id: "c", type: "cue", durationSec: 60, hardStartSec: 20 * 3600 }];
    const gaps = findTimingGaps(broken, computeTiming(broken, null));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapSec).toBe(20 * 3600 - (18 * 3600 + 900));
  });
});
