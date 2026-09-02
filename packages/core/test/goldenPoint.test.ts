import { describe, expect, it } from "vitest";
import {
  GOLDEN_HALF_SEC,
  HOLDING_SEC,
  findDecisionPoints, goldenPointBlock, isSuddenDeathRow,
  goldenPointDurationSec,
  shiftAnchorsAfter,
} from "../src/index";

describe("the block a sheet never wrote down", () => {
  it("holds before each half, not just between the halves", () => {
    // The laws give no break; the SHOW needs one either side — cameras reset,
    // commentary comes back, the crowd is told what is happening.
    expect(goldenPointBlock().map((r) => r.title)).toEqual([
      "HOLDING",
      "Golden point — first half",
      "HOLDING",
      "Golden point — second half",
    ]);
  });

  it("plays five minutes a side", () => {
    const halves = goldenPointBlock().filter((r) => /first half|second half/.test(r.title));
    expect(halves).toHaveLength(2);
    for (const h of halves) expect(h.durationSec).toBe(GOLDEN_HALF_SEC);
    expect(GOLDEN_HALF_SEC).toBe(5 * 60);
  });

  it("costs the night both halves and both holds", () => {
    expect(goldenPointDurationSec()).toBe(2 * GOLDEN_HALF_SEC + 2 * HOLDING_SEC);
  });

  it("takes the competition's own word for the period", () => {
    // Not every competition calls it golden point, and the sheet should say
    // what the people in the room say.
    expect(goldenPointBlock("Extra time").map((r) => r.title)).toContain("Extra time — first half");
  });
});

describe("what moves below it", () => {
  const rows = [
    { id: "kickoff", hardStartSec: 19 * 3600 },
    { id: "second-half", hardStartSec: 20 * 3600 },
    { id: "full-time", hardStartSec: null },
    { id: "presentation", hardStartSec: 21 * 3600 + 30 * 60 },
    { id: "sponsor", hardStartSec: null },
    { id: "off-air", hardStartSec: 21 * 3600 + 50 * 60 },
  ];

  it("moves every printed time after the insertion by the whole block", () => {
    const moved = shiftAnchorsAfter(rows, 2, goldenPointDurationSec());
    expect(moved.map((m) => m.id)).toEqual(["presentation", "off-air"]);
    expect(moved[0]!.to - moved[0]!.from).toBe(goldenPointDurationSec());
  });

  it("never touches a time before the insertion", () => {
    // Kick-off and the second half have already gone to air. Their times are
    // the record of when that happened, and moving them would rewrite history —
    // quite apart from kick-off being the one time broadcast holds us to.
    const moved = shiftAnchorsAfter(rows, 2, goldenPointDurationSec());
    expect(moved.map((m) => m.id)).not.toContain("kickoff");
    expect(moved.map((m) => m.id)).not.toContain("second-half");
  });

  it("leaves rows without a printed time alone", () => {
    // They follow from the durations above them and need no help; rewriting
    // them would invent an anchor the sheet never had.
    const moved = shiftAnchorsAfter(rows, 2, goldenPointDurationSec());
    expect(moved.map((m) => m.id)).not.toContain("sponsor");
  });

  it("does nothing at all when nothing is added", () => {
    expect(shiftAnchorsAfter(rows, 2, 0)).toEqual([]);
  });

  it("moves nothing when the block goes on the end", () => {
    expect(shiftAnchorsAfter(rows, rows.length - 1, goldenPointDurationSec())).toEqual([]);
  });
});

describe("findDecisionPoints", () => {
  const cue = (title: string, hardStartSec: number | null = null) => ({ title, hardStartSec });
  const banner = (title: string) => ({ title, hardStartSec: null, type: "group" });

  it("finds the siren on a sheet that only names it", () => {
    const rows = [cue("Second half", 61200), cue("Full Time", 63120), cue("MC | Player IV and Wrap", 63180)];
    expect(findDecisionPoints(rows)).toEqual([1]);
  });

  it("finds one per match on a double header", () => {
    const rows = [
      cue("NRLW second half", 58200),
      cue("Full Time", 60720),
      cue("NRL second half", 70200),
      cue("Full Time", 73080),
    ];
    expect(findDecisionPoints(rows)).toEqual([1, 3]);
  });

  // Several production houses close a match with a full-width heading and no
  // time of its own. Its position is the second half's printed start plus its
  // printed length — the arithmetic the whole sheet is read by, not a guess.
  it("accepts the banner that closes a match, printed time or not", () => {
    const rows = [cue("NRL | BULLDOGS v STORM - SECOND HALF", 75600), banner("NRL | BULLDOGS v STORM - FULLTIME")];
    expect(findDecisionPoints(rows)).toEqual([1]);
  });

  // The segment AFTER the siren is not the siren. Raising a chooser on it puts
  // the question up once the moment has gone.
  it("ignores the wrap that follows full time", () => {
    const rows = [cue("Full Time Wrap", 63180), cue("READ 20 - Full Time Wrap", 63240), cue("Full time highlights", 63300)];
    expect(findDecisionPoints(rows)).toEqual([]);
  });

  // An inferred time is where the app GUESSES a row falls, and a chooser is
  // not a thing to raise on a guess. Banners are the stated exception.
  it("ignores an ordinary row with no printed time", () => {
    expect(findDecisionPoints([cue("Full Time", null)])).toEqual([]);
  });

  // Two mechanisms answering one question is how a sheet gets two choosers.
  it("stands aside where the sheet tags its own endings", () => {
    const rows = [
      { title: "Fulltime - TIGERS WIN", hardStartSec: 63120, outcome: "win" },
      { title: "Full Time", hardStartSec: 63120 },
    ];
    expect(findDecisionPoints(rows)).toEqual([]);
  });
});

describe("goldenPointBlock — a final cannot end level", () => {
  // Regular season: the ten minutes are sudden death and nobody scoring is a
  // draw, so the block ends where the second half does.
  it("stops after the second half in a regular-season match", () => {
    const block = goldenPointBlock("Golden point");
    expect(block).toHaveLength(4);
    expect(block.at(-1)?.title).toBe("Golden point — second half");
  });

  // A final plays the ten minutes out and then goes on until somebody scores.
  // Without this the sheet runs out of rows while a final is still being
  // played.
  it("carries on into sudden death in a final", () => {
    const block = goldenPointBlock("Extra time", true);
    expect(block).toHaveLength(6);
    expect(block.at(-1)?.title).toBe("Golden point");
  });

  /**
   * The two periods of a final are DIFFERENT periods, and calling both of them
   * golden point is the kind of mistake that stands a match down on the first
   * try scored in extra time. A final's ten minutes are played out; only what
   * follows them ends on a score.
   */
  it("names a final's first ten minutes extra time, not golden point", () => {
    const titles = goldenPointBlock("Extra time", true).map((r) => r.title);
    expect(titles).toEqual([
      "HOLDING — coin toss",
      "Extra time — first half",
      "HOLDING",
      "Extra time — second half",
      "HOLDING",
      "Golden point",
    ]);
    expect(titles.slice(0, 5).some((t) => /golden/i.test(t))).toBe(false);
  });

  // Nobody can say how long it runs, and a run sheet should not pretend to.
  it("puts no length on the unlimited period", () => {
    expect(goldenPointBlock("Golden point", true).at(-1)?.durationSec).toBeNull();
  });

  it("counts only the periods whose length is known", () => {
    expect(goldenPointDurationSec("Golden point")).toBe(2 * HOLDING_SEC + 2 * GOLDEN_HALF_SEC);
    // The extra HOLDING is real time; the period after it is not knowable.
    expect(goldenPointDurationSec("Extra time", true)).toBe(3 * HOLDING_SEC + 2 * GOLDEN_HALF_SEC);
  });
});

/**
 * Which rows the first score can end.
 *
 * This is what decides whether the result chooser is up for the whole period
 * or only its last half-minute, so it has to tell golden point from an extra
 * time played out in full — and it has to do it on wording, because plenty of
 * sheets arrive with the block already written by the production.
 */
describe("isSuddenDeathRow", () => {
  it("knows golden point ends on a score", () => {
    expect(isSuddenDeathRow("Golden point")).toBe(true);
    expect(isSuddenDeathRow("Golden point — first half")).toBe(true);
    expect(isSuddenDeathRow("GOLDEN POINT - SECOND HALF")).toBe(true);
    expect(isSuddenDeathRow("Sudden death")).toBe(true);
  });

  // A final plays these out whatever the score. Calling them early is calling
  // a result the siren has not given yet.
  it("knows extra time is played out", () => {
    expect(isSuddenDeathRow("Extra time — first half")).toBe(false);
    expect(isSuddenDeathRow("Extra time — second half")).toBe(false);
  });

  // Nothing is being played during a hold, so nothing can be scored — and the
  // wording is real: sheets name what they are holding for.
  it("does not count a hold as a period", () => {
    expect(isSuddenDeathRow("HOLDING")).toBe(false);
    expect(isSuddenDeathRow("HOLDING — GOLDEN POINT RE-SET")).toBe(false);
    expect(isSuddenDeathRow("HOLDING — change of ends")).toBe(false);
  });

  /**
   * A slot held IN CASE of extra time is not extra time, and a row saying there
   * will not be any is the opposite of one. A row with no duration matching this
   * HOLDS THE CLOCK, so these would have stopped a live show on a buffer.
   */
  it("is not fooled by a buffer, an estimate, or a denial", () => {
    expect(isSuddenDeathRow("Golden Point Buffer")).toBe(false);
    expect(isSuddenDeathRow("Golden point estimate")).toBe(false);
    expect(isSuddenDeathRow("Golden point allowance")).toBe(false);
    expect(isSuddenDeathRow("NO GOLDEN POINT")).toBe(false);
  });

  it("says no to nothing at all", () => {
    expect(isSuddenDeathRow("")).toBe(false);
    expect(isSuddenDeathRow(null)).toBe(false);
    expect(isSuddenDeathRow("Winning song and lap of the ground")).toBe(false);
  });
});

/**
 * The laws put a coin toss before a final's extra time — Section 6, Law 2(b) —
 * to decide who kicks off and which end each team defends. It happens on the
 * field in front of cameras, so it is a cue rather than dead air.
 */
describe("the coin toss before a final's extra time", () => {
  it("names the hold a final holds for", () => {
    expect(goldenPointBlock("Extra time", true)[0]?.title).toBe("HOLDING — coin toss");
  });

  // Not claimed for the regular season: the law states it under FINALS EXTRA
  // TIME and this document says nothing about a toss before golden point.
  it("leaves the regular season's hold generic", () => {
    expect(goldenPointBlock("Golden point")[0]?.title).toBe("HOLDING");
  });
});
