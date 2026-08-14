import { describe, expect, it } from "vitest";
import {
  adoptInlineDurations,
  detectBlocks,
  durationFromMixedCell,
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

  it("does not call a spanning row an overlap when it has no printed time", () => {
    // "NSW CUP | HALF TIME" with a blank TIME cell, followed by the wrap that
    // fills it carrying the printed time the block begins at.
    const rows = [
      { hardStartSec: 17 * 3600 + 30 * 60, durationSec: 2400 },
      { hardStartSec: null, durationSec: 300 },
      { hardStartSec: null, durationSec: 660 },
      { hardStartSec: 18 * 3600 + 15 * 60, durationSec: 30 },
    ];
    const timing = computeTiming(plan(rows), null);
    expect(findTimingGaps(rows, timing)).toEqual([]);
  });

  it("does not call an announcer's read over a music bed an overlap", () => {
    const rows = [
      { hardStartSec: 19 * 3600 + 30 * 60, durationSec: 120 },
      { hardStartSec: null, durationSec: 60 },
      { hardStartSec: 19 * 3600 + 32 * 60, durationSec: 30 },
    ];
    const timing = computeTiming(plan(rows), null);
    expect(findTimingGaps(rows, timing)).toEqual([]);
  });

  it("reports an am/pm typo even though the chain closes neatly over it", () => {
    // The real one: "5:26:00 am" typed for a bell between 5:25 PM and 5:26 PM.
    // Skipping it lets the chain continue to the second, which is exactly why
    // it went unreported — and then the live screen anchored to it and said
    // the show was nine hours behind.
    const rows = [
      { hardStartSec: 17 * 3600 + 25 * 60, durationSec: 60 },
      { hardStartSec: 5 * 3600 + 26 * 60, durationSec: 0 },
      { hardStartSec: 17 * 3600 + 26 * 60, durationSec: 60 },
    ];
    const gaps = findTimingGaps(rows, computeTiming(plan(rows), null));
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.toIndex).toBe(1);
  });

  it("still absorbs a bell listed a few minutes out of place", () => {
    // Legitimate parallel authoring: the bell rings during the item above it.
    const rows = [
      { hardStartSec: 18 * 3600 + 23 * 60 + 30, durationSec: 90 },
      { hardStartSec: 18 * 3600 + 22 * 60, durationSec: 240 },
      { hardStartSec: 18 * 3600 + 25 * 60, durationSec: 30 },
    ];
    expect(findTimingGaps(rows, computeTiming(plan(rows), null))).toEqual([]);
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

describe("durationFromMixedCell", () => {
  it("recovers the duration when the row's time has landed in the same cell", () => {
    // Extraction assigns text by where it sits on the page; on some rows the
    // time lands in the duration's band and the TIME cell comes out empty.
    expect(durationFromMixedCell("0:40:00 8:02:00 PM")).toBe("0:40:00");
    expect(durationFromMixedCell("0:05:00 6:15:30 pm")).toBe("0:05:00");
  });

  it("leaves a genuinely ambiguous cell alone", () => {
    // These two are real, and the import screen asks about them. Taking the
    // first duration-shaped token would answer a question the sheet has not.
    expect(durationFromMixedCell("45mins - 1hr")).toBeNull();
    expect(durationFromMixedCell("6 mins 15 mins")).toBeNull();
  });

  it("ignores a cell that is not a duration followed by a time", () => {
    expect(durationFromMixedCell("0:40:00")).toBeNull();
    expect(durationFromMixedCell("FULLBACK WING")).toBeNull();
    expect(durationFromMixedCell("Extra time")).toBeNull();
  });
});

describe("detectBlocks: a row whose length covers what follows", () => {
  const at = (title: string, startSec: number | null, durationSec: number | null): ClassifiedRow => ({
    ...cue(title, startSec, durationSec),
  });

  it("marks half time, whose contents fill it exactly", () => {
    // 8:47 + 60 + 60 + 640 = 8:59:40, which is where the next printed time is.
    // Charging the block's own 15:00 as well would claim a quarter-hour more.
    const rows = [
      at("HALF TIME (15 mins)", 20 * 3600 + 47 * 60, 900),
      at("Wrap the scores", null, 60),
      at("Reynolds Review", null, 60),
      at("TVC Reel 7", null, 640),
      at("Bulldogs Beats HALF TIME", 20 * 3600 + 59 * 60 + 40, 70),
    ];
    detectBlocks(rows);
    expect(rows.map((r) => r.spans)).toEqual([true, undefined, undefined, undefined, undefined]);
  });

  it("leaves an ordinary cue that runs BEFORE the rows under it", () => {
    // Its length is spent, then the children's: the chain needs both.
    const rows = [
      at("TVC Reel 1", 13 * 3600, 60),
      at("Suncorp", null, 30),
      at("Flight Centre", null, 30),
      at("Next", 13 * 3600 + 120, 60),
    ];
    detectBlocks(rows);
    expect(rows.every((r) => !r.spans)).toBe(true);
  });

  it("does not call simultaneity containment", () => {
    // Children sum to nothing, so "dropping the block lands exactly" only says
    // the next row starts when this one does. Both of the rule's false
    // positives across the sample sheets were this shape.
    const rows = [
      at("Scorecard", 20 * 3600, 2400),
      at("note", null, null),
      at("Next", 20 * 3600, 60),
    ];
    detectBlocks(rows);
    expect(rows.every((r) => !r.spans)).toBe(true);
  });

  it("requires the match to be exact, not close", () => {
    // Sixty-seven rows across the sample sheets land within a minute, and
    // every one of them is an ordinary cue.
    const rows = [
      at("Nearly", 13 * 3600, 300),
      at("a", null, 60),
      at("b", null, 60),
      at("Next", 13 * 3600 + 145, 60), // 25s out
    ];
    detectBlocks(rows);
    expect(rows.every((r) => !r.spans)).toBe(true);
  });
});

describe("a block is counted once, not twice", () => {
  const plan2 = (rows: { hardStartSec: number | null; durationSec: number; spans?: boolean }[]): PlanRow[] =>
    rows.map((r, i) => ({ id: String(i), type: "cue", durationSec: r.durationSec, hardStartSec: r.hardStartSec, spans: r.spans }));

  const sheet = [
    { hardStartSec: 20 * 3600 + 47 * 60, durationSec: 900, spans: true },
    { hardStartSec: null, durationSec: 60 },
    { hardStartSec: null, durationSec: 700 },
    { hardStartSec: 20 * 3600 + 59 * 60 + 40, durationSec: 70 },
  ];

  it("reports no overlap where the block covers its contents", () => {
    expect(findTimingGaps(sheet, computeTiming(plan2(sheet), null))).toEqual([]);
  });

  it("still shows the block's own length", () => {
    // Half time is genuinely fifteen minutes and the sheet must keep saying so.
    const t = computeTiming(plan2(sheet), null);
    expect(t.rows[0]!.effectiveDurationSec).toBe(900);
    expect(t.rows[0]!.endSec! - t.rows[0]!.startSec!).toBe(900);
  });

  it("does not let the block push what comes after it", () => {
    const t = computeTiming(plan2(sheet), null);
    expect(t.rows[1]!.startSec).toBe(20 * 3600 + 47 * 60);
  });
});
