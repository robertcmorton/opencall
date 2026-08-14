import { describe, expect, it } from "vitest";
import {
  EVENT_TYPES,
  customEventTypeCode,
  eventType,
  hasOutcomes,
  outcomesFor,
  phrasesToPattern,
  resolveEventType,
  specToEventType,
  type EventTypeSpec,
} from "../src/eventTypes";
import { detectOutcomes } from "../src/import";
import type { ClassifiedRow } from "../src/import";

/**
 * What the result chooser offers at full time.
 *
 * These were written from the rules of each sport rather than from a real run
 * sheet, and one of them was wrong in a way that only shows up at the moment
 * it matters — a Draw button on a competition that cannot produce a draw, on
 * screen at full time with a stadium waiting. The netball expectations below
 * are checked against real Super Netball cue sheets; the rest are the rules.
 */
describe("what each kind of show can end as", () => {
  it("offers no ending at all to shows that have one ending", () => {
    for (const id of ["corporate", "concert", "tv-recording"]) {
      expect(hasOutcomes(id), id).toBe(false);
      expect(outcomesFor(id, false), id).toEqual([]);
      expect(outcomesFor(id, true), id).toEqual([]);
    }
  });

  it("withholds Draw at full time wherever a level score sends the match on", () => {
    // Rugby league, a knockout football tie, a netball match, an AFL final:
    // level at the siren is not a result in any of them.
    for (const id of ["nrl", "soccer-knockout", "netball", "afl-finals"]) {
      expect(outcomesFor(id, false), id).toEqual(["win", "lose", "golden"]);
    }
  });

  it("allows a draw after golden point, because golden point can run out", () => {
    // Ten minutes, and a match nobody wins in them is drawn.
    expect(outcomesFor("nrl", true)).toEqual(["win", "lose", "draw"]);
  });

  it("never offers a draw after an extra period that is played to a result", () => {
    // Netball extra time runs on until somebody leads; a football knockout has
    // penalties behind it; an AFL final is played out. A Draw button here is
    // an outcome the competition cannot produce.
    for (const id of ["netball", "soccer-knockout", "afl-finals", "cricket-t20"]) {
      expect(outcomesFor(id, true), id).toEqual(["win", "lose"]);
    }
  });

  it("treats a league draw as the result it is, with nothing after it", () => {
    // The earlier model sent league football to extra time, which does not
    // happen, and withheld the Draw that does.
    for (const id of ["soccer", "afl", "cricket"]) {
      expect(outcomesFor(id, false), id).toEqual(["win", "lose", "draw"]);
      expect(eventType(id)!.afterExtra, id).toEqual([]);
      // Nothing to advance to, so asking again must not change the answer.
      expect(outcomesFor(id, true), id).toEqual(["win", "lose", "draw"]);
    }
  });

  // Cricket was one type doing the work of two. A Test can be drawn because
  // time runs out; a T20 cannot be drawn at all — a tie goes to a super over.
  // Offering Draw on a T20 is the netball mistake in another sport.
  it("separates the cricket that can be drawn from the cricket that cannot", () => {
    expect(outcomesFor("cricket", false)).toEqual(["win", "lose", "draw"]);
    expect(eventType("cricket")!.afterExtra).toEqual([]);

    expect(outcomesFor("cricket-t20", false)).toEqual(["win", "lose", "golden"]);
    expect(outcomesFor("cricket-t20", true)).toEqual(["win", "lose"]);
    expect(eventType("cricket-t20")!.extraLabel).toBe("Super over");
  });

  it("keeps the stored `cricket` id working as the long format", () => {
    // Events already carry this id. Its behaviour must not move under them.
    expect(eventType("cricket")).not.toBeNull();
    expect(eventType("cricket")!.label).toContain("Test");
  });

  it("reads a cricket sheet's own wording for when a result is possible", () => {
    const due = eventType("cricket-t20")!.resultDueAfter!;
    expect(due.test("2nd Innings commences")).toBe(true);
    expect(due.test("SECOND INNINGS — start")).toBe(true);
    expect(due.test("1st Innings")).toBe(false);
  });

  it("names the extra period the way the sheets do", () => {
    expect(eventType("nrl")!.extraLabel).toBe("Golden point");
    // Real Super Netball sheets: "GO GFX Extra Time Animated".
    expect(eventType("netball")!.extraLabel).toBe("Extra time");
  });

  it("recognises how real sheets word the last period", () => {
    // Taken verbatim from Super Netball and AFL cue sheets.
    expect(eventType("netball")!.resultDueAfter!.test("4th Quarter Commences (15mins)")).toBe(true);
    expect(eventType("afl")!.resultDueAfter!.test("Final Term")).toBe(true);
    expect(eventType("nrl")!.resultDueAfter!.test("2nd Half Kick Off")).toBe(true);
  });

  it("keeps every id unique, since events store it", () => {
    const ids = EVENT_TYPES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    // `soccer` and `afl` are the stored ids of events that already exist and
    // must keep meaning the league format they were chosen for.
    expect(ids).toContain("soccer");
    expect(ids).toContain("afl");
  });
});

/**
 * Kinds of show a company adds for itself.
 *
 * These have to behave exactly like a built-in one — a custom type that works
 * everywhere except the one screen somebody forgot is worse than not having
 * the feature, because it looks like it works until full time.
 */
describe("a kind of show a company added", () => {
  const waterPolo: EventTypeSpec = {
    id: "own:water-polo",
    label: "Water polo",
    fullTime: ["win", "lose", "golden"],
    afterExtra: ["win", "lose"],
    extraLabel: "Extra period",
    resultDuePhrases: ["4th quarter", "final period"],
    blurb: null,
  };

  it("resolves beside the built-ins rather than instead of them", () => {
    expect(resolveEventType("own:water-polo", [waterPolo])?.label).toBe("Water polo");
    expect(resolveEventType("nrl", [waterPolo])?.label).toBe("Rugby league (NRL) — regular season");
    expect(resolveEventType("own:water-polo", [])).toBeNull();
  });

  it("drives the result chooser the same way a built-in does", () => {
    expect(outcomesFor("own:water-polo", false, [waterPolo])).toEqual(["win", "lose", "golden"]);
    expect(outcomesFor("own:water-polo", true, [waterPolo])).toEqual(["win", "lose"]);
    expect(hasOutcomes("own:water-polo", [waterPolo])).toBe(true);
  });

  it("matches the phrases the company typed, on their own sheets' wording", () => {
    const due = specToEventType(waterPolo).resultDueAfter!;
    expect(due.test("4th Quarter Commences (8 mins)")).toBe(true);
    expect(due.test("FINAL PERIOD")).toBe(true);
    expect(due.test("1st quarter")).toBe(false);
  });

  it("treats a phrase as a phrase, not as a pattern", () => {
    // Somebody types "Q4 (final)" and a naive implementation either throws on
    // the unbalanced group or silently matches something else entirely.
    const re = phrasesToPattern(["Q4 (final)"]);
    expect(re).toBeDefined();
    expect(re!.test("Q4 (final) begins")).toBe(true);
    expect(re!.test("Q4 final")).toBe(false);
  });

  it("lets a wrapped sheet still match a two-word phrase", () => {
    expect(phrasesToPattern(["4th quarter"])!.test("4th   quarter")).toBe(true);
  });

  it("has no pattern at all when no phrase was given", () => {
    // Not an empty regex: an empty one matches every row, and the chooser
    // would appear at the top of the sheet.
    expect(phrasesToPattern([])).toBeUndefined();
    expect(phrasesToPattern(["  "])).toBeUndefined();
  });

  it("drops endings that are not endings", () => {
    const junk = specToEventType({ ...waterPolo, fullTime: ["win", "banana"], afterExtra: [] });
    expect(junk.fullTime).toEqual(["win"]);
  });

  it("cannot take over a built-in id", () => {
    // A company naming its type "Netball" must not silently become the netball
    // every other company on the install is using.
    expect(customEventTypeCode("Netball")).toBe("own:netball");
    expect(eventType(customEventTypeCode("Netball"))).toBeNull();
    expect(EVENT_TYPES.some((t) => t.id === customEventTypeCode("Netball"))).toBe(false);
  });
});

const row = (title: string): ClassifiedRow => ({ title }) as ClassifiedRow;

describe("ending blocks are not opened by ordinary wording", () => {
  it("does not read a prize giveaway as a drawn match", () => {
    // Real netball sheets run "MC SEGMENT 4 - Member Lucky Draw" mid-show. A
    // bare "draw" opening an ending block would tag the rest of the sheet as
    // one branch of a match that has not finished.
    const rows = [row("Member Lucky Draw"), row("LIVE VSN"), row("4th Quarter Commences")];
    detectOutcomes(rows);
    expect(rows.map((r) => r.outcome)).toEqual([undefined, undefined, undefined]);
  });

  it("still opens a block when the wording really is an ending", () => {
    const rows = [row("Fulltime - Swifts WIN"), row("Presentation")];
    detectOutcomes(rows);
    expect(rows[0]!.outcome).toBe("win");
  });
});

describe("rugby league: regular season vs final", () => {
  it("a regular-season match can be drawn, but only after golden point", () => {
    // Ten minutes of golden point, first score wins; still level and it is a
    // draw, worth a competition point each.
    expect(outcomesFor("nrl", false)).toEqual(["win", "lose", "golden"]);
    expect(outcomesFor("nrl", true)).toEqual(["win", "lose", "draw"]);
  });

  it("a final cannot be drawn", () => {
    // Level after the ten minutes and it is played on until somebody scores,
    // so offering Draw would be offering a result that cannot happen.
    expect(outcomesFor("nrl-finals", false)).toEqual(["win", "lose", "golden"]);
    expect(outcomesFor("nrl-finals", true)).toEqual(["win", "lose"]);
  });
});

describe("a day with no extra period", () => {
  it("offers Draw at full time when the sheet carries no golden point", () => {
    // An exhibition or junior match: rugby league, on a rugby league sheet,
    // but nobody is playing golden point. Offering it would offer something
    // that cannot happen; withholding Draw withholds the only button needed.
    expect(outcomesFor("nrl", false, [], { extraInSheet: false })).toEqual(["win", "lose", "draw"]);
  });

  it("still routes through golden point when the sheet has one", () => {
    expect(outcomesFor("nrl", false, [], { extraInSheet: true })).toEqual(["win", "lose", "golden"]);
    expect(outcomesFor("nrl", false)).toEqual(["win", "lose", "golden"]);
  });

  it("does not invent a draw where the competition has none", () => {
    // Netball settles; with no extra period on the sheet it is still win/lose.
    expect(outcomesFor("netball", false, [], { extraInSheet: false })).toEqual(["win", "lose"]);
  });
});
