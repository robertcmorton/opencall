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
      { from: 1, to: 2, label: "1st half", short: "1H", kind: "first-half", game: 1 },
      { from: 3, to: 5, label: "Half time", short: "HT", kind: "half-time", game: 1 },
      { from: 6, to: 7, label: "2nd half", short: "2H", kind: "second-half", game: 1 },
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
    expect(findPhases(rows, [3])).toEqual([{ from: 0, to: 0, label: "1st half", short: "1H", kind: "first-half", game: 1 }]);
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

  it("bands extra time, and stops the last period where it starts", () => {
    // A sheet with no full-time row gives the second half the rest of the
    // stretch for want of anywhere better to end it — on a real cue sheet
    // that swallowed forty rows of golden point.
    const rows = [
      row("NRL Kick off: HARBOUR v RIVERS", 2580),
      row("NRL: Halftime"),
      row("NRL Kick off: HARBOUR v RIVERS", 2580),
      row("Golden Point Rules"),
      row("GOLDEN POINT Kick off: HARBOUR v RIVERS", 300),
      row("NRL: Golden Point Half Time"),
    ];
    const found = findPhases(rows, []);
    expect(found.find((p) => p.kind === "second-half")).toMatchObject({ from: 2, to: 2 });
    expect(found.find((p) => p.kind === "extra-time")).toMatchObject({ from: 3, to: 5, label: "Golden point" });
  });

  it("does not read the block it inserts as a first half of its own", () => {
    // `goldenPointBlock` names its periods "<label> — first half" and
    // "— second half", which the halves rule matches exactly. The block sits
    // straight after full time, so on a double-header that put a spurious
    // first half at the top of the second game.
    const rows = [
      row("NRL | HARBOUR v RIVERS - FIRST HALF", 2700),
      row("NRL | HARBOUR v RIVERS - HALF TIME (15 mins)", 900),
      row("NRL | HARBOUR v RIVERS - SECOND HALF", 2700),
      row("NRL | HARBOUR v RIVERS - FULLTIME"),
      row("HOLDING", 120),
      row("Golden point — first half", 300),
      row("HOLDING", 120),
      row("Golden point — second half", 300),
    ];
    const found = findPhases(rows, [3]);
    expect(found.filter((p) => p.kind === "first-half").map((p) => p.from)).toEqual([0]);
    expect(found.find((p) => p.kind === "extra-time")).toMatchObject({ from: 5, to: 7 });
  });

  it("finds the SECOND game's halves past the first game's golden point", () => {
    // The case that makes the period scan's blindness to extra time earn its
    // keep. Game one goes to golden point, whose rows are named "— first half"
    // and "— second half"; game two's stretch begins with them. Read them and
    // game two's first half lands on game one's extra time, its second half
    // lands ABOVE its half time, and the whole game is banded from the wrong
    // row — a mess that trimming the overlap afterwards cannot repair, because
    // the bands start inside the block rather than merely running into it.
    const rows = [
      row("NRL | HARBOUR v RIVERS - FIRST HALF", 2700),
      row("NRL | HARBOUR v RIVERS - HALF TIME (15 mins)", 900),
      row("NRL | HARBOUR v RIVERS - SECOND HALF", 2700),
      row("NRL | HARBOUR v RIVERS - FULLTIME"),
      row("Golden point — first half", 300),
      row("Golden point — second half", 300),
      row("NRL | HARBOUR v COAST - FIRST HALF", 2700),
      row("NRL | HARBOUR v COAST - HALF TIME (15 mins)", 900),
      row("NRL | HARBOUR v COAST - SECOND HALF", 2700),
      row("NRL | HARBOUR v COAST - FULLTIME"),
    ];
    const g2 = findPhases(rows, [3, 9]).filter((p) => p.game === 2);
    expect(g2.map((p) => [p.kind, p.from, p.to])).toEqual([
      ["first-half", 6, 6],
      ["half-time", 7, 7],
      ["second-half", 8, 9],
    ]);
  });

  it("ignores a slot held in case extra time is needed, and a sheet that rules it out", () => {
    for (const title of ["Extra Time Buffer", "Extra Time Estimate", "30 MIN GAME CLOCK - NO EXTRA TIME"]) {
      const rows = [row("NRL - FIRST HALF", 2700), row(title, 360), row("NRL - SECOND HALF", 2700), row("FULL TIME")];
      expect(findPhases(rows, [3]).some((p) => p.kind === "extra-time"), title).toBe(false);
    }
  });

  it("keeps two games' golden points apart when play begins between them", () => {
    const rows = [
      row("KICK OFF — GAME ONE"),
      row("First half", 2700),
      row("Second half", 2700),
      row("Golden point period", 1200),
      row("KICK OFF — GAME TWO"),
      row("First half", 2700),
      row("Second half", 2700),
      row("Golden point period", 1200),
    ];
    const extra = findPhases(rows, []).filter((p) => p.kind === "extra-time");
    expect(extra.map((p) => p.from)).toEqual([3, 7]);
  });

  it("carries a short form for a band with no room to spell itself", () => {
    // A first half is very often ONE row — the whole forty minutes as a single
    // container — and vertical text cannot spell "1st half" in 30px.
    const rows = [row("Kick Off", 0), row("Half Time - 13 Minutes", 30), row("Build to Kick Off", 0), row("Full Time", 60)];
    expect(findPhases(rows, [3]).map((p) => [p.label, p.short])).toEqual([
      ["1st half", "1H"],
      ["Half time", "HT"],
      ["2nd half", "2H"],
    ]);
  });

  it("stops the second half at full time, not at the end of the endings", () => {
    // A sheet that writes its own endings has no decision point to find, so
    // the game's stretch runs past full time and through every branch. The
    // period must not: the football stopped at the siren.
    const rows = [
      row("NRL - FIRST HALF", 2700),
      row("NRL - HALF TIME (15 mins)", 900),
      row("NRL - SECOND HALF", 2700),
      row("FULL TIME — HOME WIN"),
      row("Winning song"),
      row("Player of the match"),
      row("FULL TIME — HOME LOSS"),
      row("Away captain interview"),
    ];
    expect(findPhases(rows, [7]).find((p) => p.kind === "second-half")).toMatchObject({ from: 2, to: 3 });
  });

  it("does not mistake a full-time WRAP for the siren", () => {
    const rows = [
      row("NRL - FIRST HALF", 2700),
      row("NRL - HALF TIME (15 mins)", 900),
      row("NRL - SECOND HALF", 2700),
      row("READ 20 - Full Time Wrap", 60),
      row("FULL TIME — HOME WIN"),
    ];
    // The wrap is talked over the game; the siren is the row after it.
    expect(findPhases(rows, [4]).find((p) => p.kind === "second-half")).toMatchObject({ to: 4 });
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

/**
 * The break between two halves is chosen by length, and length is a LIVE
 * number — held, nudged, added to while a show runs. A bare comparison lets two
 * candidates a few seconds apart swap places mid-show, and the band down the
 * side of the sheet jumps with them.
 */
describe("which row is the break", () => {
  const sheet = (halfTimeRows: { title: string; durationSec: number | null }[]) => [
    { title: "KICK OFF", durationSec: 60 },
    { title: "First half", durationSec: 2400 },
    ...halfTimeRows,
    { title: "Second half", durationSec: 2400 },
    { title: "FULL TIME", durationSec: null },
  ];
  const breakTitle = (rows: { title: string; durationSec: number | null }[]) => {
    const ht = findPhases(rows as never, []).find((p) => p.kind === "half-time");
    return ht ? rows[ht.from]!.title : null;
  };

  it("takes the real break over a stinger that shares its name", () => {
    expect(
      breakTitle(
        sheet([
          { title: "STANDBY FOR HALF TIME", durationSec: null },
          { title: "HALF TIME (15 mins)", durationSec: 900 },
          { title: "Crowd DJ — Stadium Beats HALF TIME", durationSec: 110 },
        ]),
      ),
    ).toBe("HALF TIME (15 mins)");
  });

  /** THE POINT OF THE MARGIN: a nudge must not move the band. */
  it("does not change its mind when a live edit lengthens the other one", () => {
    // Both titles must actually READ as half time — "HALF TIME music bed" does
    // not, because the pattern wants a separator before any trailing words, and
    // a fixture that fails to match tests nothing at all. Found by mutation:
    // removing the margin broke no test until this was corrected.
    const rows = sheet([
      { title: "HALF TIME — the break", durationSec: 900 },
      { title: "HALF TIME — music bed", durationSec: 880 },
    ]);
    expect(breakTitle(rows)).toBe("HALF TIME — the break");
    // Somebody holds the music bed for half a minute mid-show.
    rows[3]!.durationSec = 910;
    expect(breakTitle(rows)).toBe("HALF TIME — the break");
  });

  it("still moves when the difference is real rather than a nudge", () => {
    const rows = sheet([
      { title: "HALF TIME standby", durationSec: 30 },
      { title: "HALF TIME (15 mins)", durationSec: 900 },
    ]);
    expect(breakTitle(rows)).toBe("HALF TIME (15 mins)");
  });
});
