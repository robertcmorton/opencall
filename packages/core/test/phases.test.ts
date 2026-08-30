import { describe, expect, it } from "vitest";
import { findPhases, sheetFaults } from "../src";

/**
 * Titles copied from real run sheets, because the whole detector is a claim
 * about how sheets are actually written. A fixture invented to suit the rules
 * would prove only that the rules match themselves.
 */
const row = (title: string, durationSec: number | null = null) => ({ title, durationSec });

describe("findPhases", () => {
  it("reads the halves a sheet names outright", () => {
    const rows = [
      row("Stadium Beats pre-game", 180),
      row("NRL | HARBOUR v RIVERS - FIRST HALF", 2700),
      row("STANDBY FOR HALF TIME"),
      row("NRL | HARBOUR v RIVERS- HALF TIME (15 mins)", 900),
      row("Half Time Show", 600),
      row("Crowd DJ - Stadium Beats HALF TIME", 110),
      row("NRL | HARBOUR v RIVERS - SECOND HALF", 2700),
      row("NRL | HARBOUR v RIVERS - FULLTIME"),
    ];
    expect(findPhases(rows, [7])).toEqual([
      { from: 1, to: 2, label: "1st half", kind: "first-half", game: 1 },
      { from: 3, to: 5, label: "Half time", kind: "half-time", game: 1 },
      { from: 6, to: 7, label: "2nd half", kind: "second-half", game: 1 },
    ]);
  });

  it("takes the longest half-time candidate, not the first", () => {
    // "STANDBY FOR HALF TIME" comes first and has no length; the break is the
    // 900-second one behind it.
    const rows = [
      row("NRL | HARBOUR v RIVERS - FIRST HALF", 2700),
      row("STANDBY FOR HALF TIME"),
      row("NRL | HARBOUR v RIVERS- HALF TIME (15 mins)", 900),
      row("NRL | HARBOUR v RIVERS - SECOND HALF", 2700),
    ];
    expect(findPhases(rows, [3])[1]).toMatchObject({ from: 2, label: "Half time" });
  });

  it("still finds a break whose row is a 30-second stinger", () => {
    // One sheet names the break "Half Time - 13 Minutes" and gives the ROW a
    // length of 30s, because the row is the sting that plays into it. A
    // minimum length would throw this away.
    const rows = [row("Build to Kick Off", 0), row("Half Time - 13 Minutes", 30), row("Build to Kick Off- 15 seconds", 0), row("Full Time", 60)];
    expect(findPhases(rows, [3]).map((p) => [p.from, p.label])).toEqual([
      [0, "1st half"],
      [1, "Half time"],
      [2, "2nd half"],
    ]);
  });

  it("ignores things that merely happen during half time", () => {
    for (const title of [
      "Half Time Show - Back Announce",
      "Sponsor Half Time Car Giveaway",
      "Read 10 - Half Time Champions",
      "Partner Half time recap",
      "Wrap the scores (half time 13 minutes)",
      "Rehearsals - Half time movements",
    ]) {
      const rows = [row("NRL - FIRST HALF", 2700), row(title, 900), row("NRL - SECOND HALF", 2700)];
      expect(findPhases(rows, [2]).some((p) => p.kind === "half-time"), title).toBe(false);
    }
  });

  it("takes the last kick-off before the break, not the warm-up before it", () => {
    const rows = [
      row("TEAMS WARM UP AND PREP FOR KICK OFF", 60),
      row("NRL - COAST v RANGERS - Kick off", 2400),
      row("NRL HALF TIME - 15min"),
      row("NRL - COAST v RANGERS - 2nd Half", 2400),
    ];
    expect(findPhases(rows, [3])[0]).toMatchObject({ from: 1, label: "1st half" });
  });

  it("gives each game in a double-header its own halves", () => {
    const rows = [
      row("NRLW - FIRST HALF", 2100),
      row("NRLW - HALF TIME", 780),
      row("NRLW - SECOND HALF", 2100),
      row("NRLW | FULL TIME"),
      row("NRL - FIRST HALF", 2700),
      row("NRL - HALF TIME (15 mins)", 900),
      row("NRL - SECOND HALF", 2700),
      row("NRL | FULLTIME"),
    ];
    const found = findPhases(rows, [3, 7]);
    expect(found).toHaveLength(6);
    expect(found.filter((p) => p.game === 1).map((p) => p.from)).toEqual([0, 1, 2]);
    expect(found.filter((p) => p.game === 2).map((p) => p.from)).toEqual([4, 5, 6]);
  });

  it("paints nothing over rows whose period it cannot establish", () => {
    // Half time is named; the restart never is. Labelling the rest "Half time"
    // would be writing it over forty minutes of football.
    const rows = [row("Kick Off", 0), row("NRLW - HALF TIME - 13 MINUTES", 780), row("cue"), row("NRLW - FULL TIME")];
    expect(findPhases(rows, [3])).toEqual([{ from: 0, to: 0, label: "1st half", kind: "first-half", game: 1 }]);
  });

  it("reads a game played in quarters, and the breaks between them", () => {
    // Copied from the netball sheets, which are the most regular documents in
    // the corpus: all three print exactly this, in this order.
    const rows = [
      row("1st Quarter (15 Mins)", 900),
      row("Super Shot Sting"),
      row("1st Quarter Break (5:00mins)", 300),
      row("READ 11 - 1st Quarter Wrap", 60),
      row("2nd Quarter Commences (15mins)", 900),
      row("Half Time (15mins)", 900),
      row("READ 14 - Half time Countdown", 10),
      row("3rd Quarter Commences (15mins)", 900),
      row("3rd Quarter Break (5:00mins)", 300),
      row("4th Quarter Commences (15mins)", 900),
      row("Full Time"),
    ];
    expect(findPhases(rows, [10]).map((p) => [p.from, p.to, p.label])).toEqual([
      [0, 1, "1st qtr"],
      [2, 3, "Break"],
      [4, 4, "2nd qtr"],
      [5, 6, "Half time"],
      [7, 7, "3rd qtr"],
      [8, 8, "Break"],
      [9, 10, "4th qtr"],
    ]);
  });

  it("does not read a quarter sheet's half time as the middle of a game of halves", () => {
    // The vocabularies overlap: netball names Half Time at the end of its
    // second quarter. Read as halves, quarters 1-2 become one long first half.
    const rows = [
      row("1st Quarter (15 Mins)", 900),
      row("2nd Quarter Commences (15mins)", 900),
      row("Half Time (15mins)", 900),
      row("3rd Quarter Commences (15mins)", 900),
      row("Full Time"),
    ];
    expect(findPhases(rows, [4]).every((p) => p.kind === "quarter" || p.kind === "break")).toBe(true);
  });

  it("keeps a quarter apart from the break named after it", () => {
    // "1st Quarter" and "1st Quarter Break" are one word apart. The first
    // quarter is deliberately ABSENT here: with both rows present, document
    // order alone would pick the right one and prove nothing.
    const rows = [
      row("1st Quarter Break (5:00mins)", 300),
      row("2nd Quarter Commences (15mins)", 900),
      row("Half Time (15mins)", 900),
      row("3rd Quarter Commences (15mins)", 900),
      row("Full Time"),
    ];
    const found = findPhases(rows, [4]);
    // The break is a break wherever it falls; it is never the period.
    expect(found.find((p) => p.from === 0)?.kind).not.toBe("quarter");
    expect(found.filter((p) => p.kind === "quarter").map((p) => p.from)).toEqual([1, 3]);
  });

  it("wants more than one quarter before believing in them", () => {
    // One quarter-shaped name on a sheet played in halves is not four
    // quarters' worth of evidence — reading it as one would band the game
    // from that row instead of from its kick-off.
    const rows = [
      row("NRL | HARBOUR v RIVERS - FIRST HALF", 2700),
      row("Celebrity 1st Quarter (sponsor)", 900),
      row("NRL | HARBOUR v RIVERS - HALF TIME (15 mins)", 900),
      row("NRL | HARBOUR v RIVERS - SECOND HALF", 2700),
    ];
    const found = findPhases(rows, [3]);
    expect(found.every((p) => p.kind !== "quarter")).toBe(true);
    expect(found.map((p) => p.label)).toEqual(["1st half", "Half time", "2nd half"]);
  });

  it("says nothing about a sheet with no game in it", () => {
    expect(findPhases([row("Doors open"), row("Speeches"), row("Carriages")], [])).toEqual([]);
  });
});

describe("sheetFaults", () => {
  const built = (over: Partial<Parameters<typeof sheetFaults>[0]> = {}) =>
    ({ rows: [], columns: [], roles: [], roleColumnKey: null, roleColumnKeys: [], showInfo: [], plannedStartSec: null, baseTitles: {}, columnOrder: [], ...over }) as Parameters<typeof sheetFaults>[0];

  it("says when nothing became the item name", () => {
    const f = sheetFaults(built({ rows: [{ type: "cue", title: "x" }] }), [{ kind: "skip" }], 0);
    expect(f.map((x) => x.kind)).toContain("no-title");
  });

  it("does not claim a missing duration on a sheet that never had one", () => {
    // A schedule of TIME and ACTIVITY with no lengths anywhere is a legitimate
    // shape, not a broken import.
    const rows = Array.from({ length: 30 }, (_, i) => ({ type: "cue" as const, title: `Item ${i}`, hardStartSec: i * 60 }));
    const f = sheetFaults(built({ rows }), [{ kind: "title" }, { kind: "start" }], 0);
    expect(f.map((x) => x.kind)).not.toContain("no-duration");
    expect(f.map((x) => x.kind)).not.toContain("zero-length");
  });

  it("says when a column of lengths was dropped on the floor", () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ type: "cue" as const, title: `Item ${i}`, cells: { c: "00:30" } }));
    const f = sheetFaults(built({ rows }), [{ kind: "title" }], 0);
    expect(f.map((x) => x.kind)).toEqual(expect.arrayContaining(["no-duration", "zero-length"]));
  });

  it("spots a footer that has been read into the rows", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      type: "cue" as const,
      title: i % 4 === 0 ? `Item ${i}\nNOT FOR EXTERNAL DISTRIBUTION — page footer` : `Item ${i}`,
      durationSec: 30,
    }));
    const f = sheetFaults(built({ rows }), [{ kind: "title" }, { kind: "duration" }], 3000);
    expect(f.map((x) => x.kind)).toContain("repeated-line");
  });

  it("does not mistake a sheet whose rows are meant to be alike for a footer", () => {
    const rows = Array.from({ length: 100 }, () => ({ type: "cue" as const, title: "Thirty second timing fixture row", durationSec: 30 }));
    const f = sheetFaults(built({ rows }), [{ kind: "title" }, { kind: "duration" }], 3000);
    expect(f.map((x) => x.kind)).not.toContain("repeated-line");
  });
});
