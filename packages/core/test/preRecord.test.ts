import { describe, expect, it } from "vitest";
import {
  adoptCaptionTitles,
  adoptExtraDurations,
  collapseRepeatedBanners,
  computeTiming,
  detectAlongside,
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

describe("detectAlongside", () => {
  it("marks a row whose title opens with Pre Record", () => {
    const rows = [cue("Pre Record - COIN TOSS with Jacob Kertabani")];
    detectAlongside(rows);
    expect(rows[0]!.parallel).toBe(true);
  });

  it("accepts the spellings real sheets use", () => {
    const rows = [cue("PRE RECORD WALK OVER"), cue("Pre-record - Dem Mob"), cue("Prerecording - tunnel")];
    detectAlongside(rows);
    expect(rows.map((r) => r.parallel)).toEqual([true, true, true]);
  });

  it("does NOT mark the VTR that plays the pre-record back", () => {
    // This is the one that matters: the playback is a real cue that genuinely
    // takes seventy-five seconds of the running order.
    const rows = [cue("VTR - Pre Record - Coin Toss"), cue("VTR - Member Signing PRE RECORD"), cue("VTR - Fun Fair (pre record)")];
    detectAlongside(rows);
    expect(rows.map((r) => r.parallel)).toEqual([undefined, undefined, undefined]);
  });

  it("does not mark a row that merely mentions one", () => {
    const rows = [cue("MC Chat with Dem Mob"), cue("Stadium Evac (Pre-rec audio)")];
    detectAlongside(rows);
    expect(rows.map((r) => r.parallel)).toEqual([undefined, undefined]);
  });

  it("finds the label on a later line of a merged row", () => {
    const rows = [cue("Extra Buffer\nPre Record - PLAYER WALK OVER - tunnel")];
    detectAlongside(rows);
    expect(rows[0]!.parallel).toBe(true);
  });

  it("marks a group banner too", () => {
    const rows: ClassifiedRow[] = [{ ...cue("PRE RECORD WALK OVER"), kind: "banner" }];
    detectAlongside(rows);
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

describe("detectAlongside: the two-minute bell", () => {
  it("marks the warning, however the sheet spells it", () => {
    const rows = [cue("TWO MINUTE BELL"), cue("2 minute bell"), cue("2 MIN BELL"), cue("TWO MINUTE BELL 8:56:00 PM")];
    detectAlongside(rows);
    expect(rows.map((r) => r.parallel)).toEqual([true, true, true, true]);
  });

  it("leaves bells that are part of the show alone", () => {
    // Real rows from real sheets. These are cues.
    const rows = [
      cue("RINGING THE BELL"),
      cue("BELL RINGING MOMENT ON CAMERA"),
      cue("LX - BELL LIGHTS ON"),
      cue("Ringing the legacy bell tonight is proud Kuku Yalanji man"),
    ];
    detectAlongside(rows);
    expect(rows.map((r) => r.parallel)).toEqual([undefined, undefined, undefined, undefined]);
  });

  it("does not mark a standby that spans a period of play", () => {
    // "STANDBY FOR HALF TIME" covers the forty minutes of a half.
    const rows = [cue("STANDBY FOR HALF TIME"), cue("Cameras & MC on standby throughout quarter")];
    detectAlongside(rows);
    expect(rows.map((r) => r.parallel)).toEqual([undefined, undefined]);
  });
});

describe("collapseRepeatedBanners", () => {
  it("keeps one heading where the sheet printed two", () => {
    // The source PDF carries this banner on two adjacent rows with nothing
    // between them — two section headings for one section.
    const rows: ClassifiedRow[] = [
      { ...cue("NRL | BULLDOGS v RABBITOHS - FIRST HALF"), kind: "banner" },
      { ...cue("NRL | BULLDOGS v RABBITOHS - FIRST HALF"), kind: "banner" },
      { ...cue("STANDBY FOR HALF TIME") },
    ];
    collapseRepeatedBanners(rows);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe("NRL | BULLDOGS v RABBITOHS - FIRST HALF");
  });

  it("keeps a banner that recurs later in the day", () => {
    // A second game has its own half time, and that is a real second heading.
    const rows: ClassifiedRow[] = [
      { ...cue("HALF TIME"), kind: "banner" },
      { ...cue("Wrap the scores") },
      { ...cue("HALF TIME"), kind: "banner" },
    ];
    collapseRepeatedBanners(rows);
    expect(rows).toHaveLength(3);
  });

  it("never collapses rows that carry a time or a length", () => {
    // Only banners are headings; anything timed is a row of the show.
    const timed = (): ClassifiedRow => ({ ...cue("FIRST HALF"), startSec: 20 * 3600, durationSec: 2400 });
    const rows = [timed(), timed()];
    collapseRepeatedBanners(rows);
    expect(rows).toHaveLength(2);
  });
});

describe("adoptCaptionTitles", () => {
  const timed = (over: Partial<ClassifiedRow>): ClassifiedRow => ({ ...cue(""), ...over });

  it("gives a half its name from the line beneath it", () => {
    // How every match-day sheet in the sample writes a game period: the timing
    // on a numbered line with an empty item cell, the name alone underneath.
    const rows: ClassifiedRow[] = [
      timed({ sourceNumber: "87", startSec: 20 * 3600 + 120, durationSec: 2400 }),
      { ...cue("NRL | BULLDOGS v RABBITOHS - FIRST HALF"), kind: "banner" },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: "cue",
      sourceNumber: "87",
      title: "NRL | BULLDOGS v RABBITOHS - FIRST HALF",
      startSec: 20 * 3600 + 120,
      durationSec: 2400,
    });
  });

  it("leaves a numbered row alone — that is a cue, not a caption", () => {
    // The dense cue sheets put a DJ cue next to a GFX cue, each numbered and
    // each carrying its own roles. Joining those would destroy both.
    const rows: ClassifiedRow[] = [
      timed({ sourceNumber: "62", durationSec: 87 }),
      { ...cue("Wests Tigers v Bulldogs Graphic"), kind: "banner", sourceNumber: "63" },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe("");
  });

  it("leaves a row that carries department content alone", () => {
    // Not a banner: it has its own screen and audio, so it is a row of the show.
    const rows: ClassifiedRow[] = [
      timed({ durationSec: 60 }),
      { ...cue("Telstra"), cells: { type: "VTR", "big-screen": "Telstra TVC" } },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(2);
  });

  it("never takes a name from a row that has a time of its own", () => {
    const rows: ClassifiedRow[] = [
      timed({ durationSec: 2400 }),
      { ...cue("SECOND HALF"), startSec: 21 * 3600 },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(2);
  });

  it("leaves a titled row and its following heading alone", () => {
    const rows: ClassifiedRow[] = [
      { ...cue("Team Entry"), durationSec: 40 },
      { ...cue("NRL | SECOND HALF"), kind: "banner" },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(2);
  });

  it("reaches across a blank line", () => {
    const rows: ClassifiedRow[] = [
      timed({ durationSec: 2400 }),
      { ...cue(""), kind: "spacer" },
      { ...cue("NRL | FIRST HALF"), kind: "banner" },
    ];
    adoptCaptionTitles(rows);
    expect(rows.map((r) => r.title)).toEqual(["NRL | FIRST HALF", ""]);
  });
});

describe("adoptExtraDurations", () => {
  const half = (over: Partial<ClassifiedRow>): ClassifiedRow => ({ ...cue("FIRST HALF"), ...over });

  it("spends the extra time when the sheet's own times prove it", () => {
    // Kick-off 8:02, forty minutes printed, five more on the line beneath,
    // half time printed at 8:47. Forty alone reaches 8:42; forty-five is exact.
    const rows: ClassifiedRow[] = [
      half({ startSec: 20 * 3600 + 120, durationSec: 2400, durationExtraSec: 300 }),
      cue("STANDBY FOR HALF TIME"),
      { ...cue("HALF TIME"), startSec: 20 * 3600 + 2820 },
    ];
    adoptExtraDurations(rows);
    expect(rows[0]!.durationSec).toBe(2700);
  });

  it("leaves it alone when the times do not settle it", () => {
    // "00:30" and "7" in one cell: two readable lengths, and nothing says the
    // second belongs to this row. The next printed time does not confirm it.
    const rows: ClassifiedRow[] = [
      half({ startSec: 20 * 3600, durationSec: 30, durationExtraSec: 7 }),
      { ...cue("NEXT"), startSec: 20 * 3600 + 30 },
    ];
    adoptExtraDurations(rows);
    expect(rows[0]!.durationSec).toBe(30);
  });

  it("counts the rows in between on the way to the next printed time", () => {
    const rows: ClassifiedRow[] = [
      half({ startSec: 20 * 3600, durationSec: 2400, durationExtraSec: 300 }),
      { ...cue("Wrap"), durationSec: 60 },
      { ...cue("HALF TIME"), startSec: 20 * 3600 + 2760 },
    ];
    adoptExtraDurations(rows);
    expect(rows[0]!.durationSec).toBe(2700);
  });

  it("does nothing without a next printed time to ask", () => {
    const rows: ClassifiedRow[] = [half({ startSec: 20 * 3600, durationSec: 2400, durationExtraSec: 300 }), cue("after")];
    adoptExtraDurations(rows);
    expect(rows[0]!.durationSec).toBe(2400);
  });

  it("does not spend it when the row already reaches the printed time", () => {
    const rows: ClassifiedRow[] = [
      half({ startSec: 20 * 3600, durationSec: 2400, durationExtraSec: 300 }),
      { ...cue("HALF TIME"), startSec: 20 * 3600 + 2400 },
    ];
    adoptExtraDurations(rows);
    expect(rows[0]!.durationSec).toBe(2400);
  });
});

describe("adoptCaptionTitles: a dash is not a name", () => {
  it("adopts the caption when the timing row was given a bare dash", () => {
    // Sheets type one where they mean to leave the cell blank, and our own
    // soak-test generator wrote hundreds before it was fixed — so an already
    // imported sheet must be repairable by re-importing the same file.
    const rows: ClassifiedRow[] = [
      { ...cue("—"), sourceNumber: "87", startSec: 20 * 3600 + 120, durationSec: 2400 },
      { ...cue("NRL | BULLDOGS v RABBITOHS - FIRST HALF"), kind: "banner" },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("NRL | BULLDOGS v RABBITOHS - FIRST HALF");
  });

  it("leaves a row that has a real name alone", () => {
    const rows: ClassifiedRow[] = [
      { ...cue("Team Entry - Bulldogs"), durationSec: 40 },
      { ...cue("NRL | SECOND HALF"), kind: "banner" },
    ];
    adoptCaptionTitles(rows);
    expect(rows).toHaveLength(2);
  });
});
