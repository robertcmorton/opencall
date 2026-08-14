import { describe, expect, it } from "vitest";
import {
  adoptInlineDurations,
  adoptInlineStarts,
  computeTiming,
  findTimingGaps,
  type ClassifiedRow,
  type PlanRow,
} from "../src/index";

/** A cue row with only the fields these rules read. */
const cue = (title: string, startSec: number | null = null, durationSec: number | null = null): ClassifiedRow => ({
  kind: "cue",
  title,
  startSec,
  startRaw: null,
  durationSec,
  durationRaw: null,
  cells: {},
  sourceIndex: 0,
});

describe("adoptInlineStarts", () => {
  it("takes a time written at the end of the title", () => {
    const rows = [cue("Check Content", 15 * 3600), cue("Production Meeting 4:45:00PM"), cue("Rehearsals", 17.5 * 3600)];
    adoptInlineStarts(rows);
    expect(rows[1]!.startSec).toBe(16 * 3600 + 45 * 60);
    expect(rows[1]!.title).toBe("Production Meeting");
  });

  it("keeps the seconds when the sheet writes them", () => {
    const rows = [cue("a", 0), cue("TWO MINUTE BELL 8:56:30 PM"), cue("z", 23 * 3600)];
    adoptInlineStarts(rows);
    expect(rows[1]!.startSec).toBe(20 * 3600 + 56 * 60 + 30);
  });

  it("strips a trailing time from the last line of a merged title", () => {
    const rows = [cue("a", 0), cue("BULLDOGS v BRONCOS - FULLTIME\nWrap Scores 9:45:00 PM"), cue("z", 23 * 3600)];
    adoptInlineStarts(rows);
    expect(rows[1]!.startSec).toBe(21 * 3600 + 45 * 60);
    expect(rows[1]!.title).toBe("BULLDOGS v BRONCOS - FULLTIME\nWrap Scores");
  });

  it("leaves a time that does not fit between the anchors around it", () => {
    // The real case: a typo'd bell among rows running at 20:44.
    const rows = [cue("a", 20 * 3600 + 40 * 60), cue("TWO MINUTE BELL 3:56:00 PM"), cue("z", 20 * 3600 + 47 * 60)];
    adoptInlineStarts(rows);
    expect(rows[1]!.startSec).toBeNull();
    expect(rows[1]!.title).toBe("TWO MINUTE BELL 3:56:00 PM");
  });

  it("leaves a time in the middle of a sentence alone", () => {
    const rows = [cue("a", 0), cue("Doors from 6:00PM until kick-off"), cue("z", 23 * 3600)];
    adoptInlineStarts(rows);
    expect(rows[1]!.startSec).toBeNull();
  });

  it("never overwrites a start the sheet already gave", () => {
    const rows = [cue("Gates 7:00PM", 18 * 3600)];
    adoptInlineStarts(rows);
    expect(rows[0]!.startSec).toBe(18 * 3600);
    expect(rows[0]!.title).toBe("Gates 7:00PM");
  });

  it("does not let one adopted time justify the next", () => {
    // Both are candidates; the second must be bracketed by the ORIGINAL
    // anchors, not by whatever the first just claimed.
    const rows = [cue("a", 12 * 3600), cue("one 1:00:00PM"), cue("two 11:00:00AM"), cue("z", 14 * 3600)];
    adoptInlineStarts(rows);
    expect(rows[1]!.startSec).toBe(13 * 3600);
    expect(rows[2]!.startSec).toBeNull();
  });
});

describe("adoptInlineDurations", () => {
  it("takes a length written into the title", () => {
    const rows = [cue("Half Time (15mins)", 20 * 3600)];
    adoptInlineDurations(rows);
    expect(rows[0]!.durationSec).toBe(900);
  });

  it("reads minutes and seconds together", () => {
    const rows = [cue("1st Quarter Break (5:00mins)", 14 * 3600)];
    adoptInlineDurations(rows);
    expect(rows[0]!.durationSec).toBe(300);
  });

  it("reads seconds", () => {
    const rows = [cue("7x Player Turns (3 Sec)", 13 * 3600)];
    adoptInlineDurations(rows);
    expect(rows[0]!.durationSec).toBe(3);
  });

  it("turns a milestone into a cue, since it now takes time", () => {
    const rows: ClassifiedRow[] = [{ ...cue("Half Time (15mins)", 20 * 3600), kind: "milestone" }];
    adoptInlineDurations(rows);
    expect(rows[0]!.kind).toBe("cue");
    expect(rows[0]!.durationSec).toBe(900);
  });

  it("leaves a duration the sheet already parsed", () => {
    const rows = [cue("HALF TIME (15 mins)", 20 * 3600, 900)];
    adoptInlineDurations(rows);
    expect(rows[0]!.durationSec).toBe(900);
    expect(rows[0]!.title).toBe("HALF TIME (15 mins)");
  });

  it("keeps the text in the title", () => {
    const rows = [cue("2nd Quarter Commences (15mins)", 14 * 3600)];
    adoptInlineDurations(rows);
    expect(rows[0]!.title).toBe("2nd Quarter Commences (15mins)");
  });

  it("ignores a parenthesis that is not a length", () => {
    const rows = [cue("Sponsor Read (Suncorp)", 13 * 3600), cue("TVC Reel (x4)", 13 * 3600)];
    adoptInlineDurations(rows);
    expect(rows[0]!.durationSec).toBeNull();
    expect(rows[1]!.durationSec).toBeNull();
  });
});

describe("findTimingGaps: rows that start together", () => {
  const plan = (rows: { hardStartSec: number | null; durationSec: number }[]): PlanRow[] =>
    rows.map((r, i) => ({ id: String(i), type: "cue", durationSec: r.durationSec, hardStartSec: r.hardStartSec }));

  it("does not call a spanning row an overlap", () => {
    // "HALF TIME (15 mins)" at 20:45 for 15 min, then the cues that fill it —
    // the first of them also at 20:45.
    const rows = [
      { hardStartSec: 20 * 3600, durationSec: 2700 },
      { hardStartSec: 20 * 3600 + 45 * 60, durationSec: 900 },
      { hardStartSec: 20 * 3600 + 45 * 60, durationSec: 60 },
      { hardStartSec: 20 * 3600 + 46 * 60, durationSec: 45 },
    ];
    const timing = computeTiming(plan(rows), null);
    expect(findTimingGaps(rows, timing)).toEqual([]);
  });

  it("still reports a start that genuinely disagrees", () => {
    const rows = [
      { hardStartSec: 20 * 3600, durationSec: 600 },
      { hardStartSec: 20 * 3600 + 30 * 60, durationSec: 60 },
    ];
    const timing = computeTiming(plan(rows), null);
    const gaps = findTimingGaps(rows, timing);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.gapSec).toBe(1200);
  });
});
