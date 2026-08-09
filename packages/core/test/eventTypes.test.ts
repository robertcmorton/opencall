import { describe, expect, it } from "vitest";
import { EVENT_TYPES, eventType, hasOutcomes, outcomesFor } from "../src/eventTypes";
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
    for (const id of ["netball", "soccer-knockout", "afl-finals"]) {
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
