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
      row("Bulldogs Beats pre-game", 180),
      row("NRL | BULLDOGS v STORM - FIRST HALF", 2700),
      row("STANDBY FOR HALF TIME"),
      row("NRL | BULLDOGS v STORM- HALF TIME (15 mins)", 900),
      row("Half Time Show", 600),
      row("Be the DJ - Bulldogs Beats HALF TIME", 110),
      row("NRL | BULLDOGS v STORM - SECOND HALF", 2700),
      row("NRL | BULLDOGS v STORM - FULLTIME"),
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
      row("NRL | BULLDOGS v STORM - FIRST HALF", 2700),
      row("STANDBY FOR HALF TIME"),
      row("NRL | BULLDOGS v STORM- HALF TIME (15 mins)", 900),
      row("NRL | BULLDOGS v STORM - SECOND HALF", 2700),
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
      "Geely Half Time Car Giveaway",
      "Read 10 - Half Time Heroes",
      "G Class Half time recap",
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
      row("NRL - RABBITOHS v EELS - Kick off", 2400),
      row("NRL HALF TIME - 15min"),
      row("NRL - RABBITOHS v EELS - 2nd Half", 2400),
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
