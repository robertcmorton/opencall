import { describe, expect, it } from "vitest";
import { byDate, byName } from "../lib/pickOrder";

/**
 * The pickers decide the order of every dropdown a person reads, so the whole
 * value of these functions is in the cases where "sort it alphabetically" and
 * "sort it the way bytes compare" disagree. Plain `<` on strings is the obvious
 * implementation and it is wrong in three separate ways — capitals sort ahead
 * of every lowercase letter, accented letters sort after Z, and "Studio 10"
 * sorts ahead of "Studio 2". Most of what follows is aimed squarely at those.
 *
 * Where a test would pass against the naive version too, it says so, so that a
 * later reader does not mistake it for cover it is not providing.
 */

const named = (names: readonly string[]) => names.map((name) => ({ name }));
const dated = (rows: readonly [string, string][]) => rows.map(([startDate, name]) => ({ startDate, name }));
const names = (items: readonly { name: string }[]) => items.map((item) => item.name);

describe("byName", () => {
  it("does not let a capital jump the queue", () => {
    // `<` compares code points, where every capital (Z is 90) beats every
    // lowercase letter (a is 97), so the naive version answers ["Zulu", "alpha"].
    expect(names(byName(named(["Zulu", "alpha"])))).toEqual(["alpha", "Zulu"]);
  });

  it("sorts on the words rather than on which of them was capitalised", () => {
    // The realistic version of the same trap: two companies whose names start
    // with the same word, typed by two different people. Byte order puts
    // "Acme Rentals" first purely because somebody held shift.
    expect(names(byName(named(["Acme Rentals", "acme lighting"])))).toEqual(["acme lighting", "Acme Rentals"]);
  });

  it("reads the numbers in a name as numbers — Studio 2 before Studio 10", () => {
    // Character by character, "1" precedes "2", so both plain `<` and a
    // localeCompare that forgot `numeric: true` answer 1, 10, 2.
    expect(names(byName(named(["Studio 10", "Studio 2", "Studio 1"])))).toEqual(["Studio 1", "Studio 2", "Studio 10"]);
  });

  it("files an accented name with its unaccented letter, not after Z", () => {
    // "É" is U+00C9, past every unaccented capital, so `<` exiles Étoile to the
    // end of the list — where nobody scanning the E's will find it.
    expect(names(byName(named(["Zulu", "Étoile", "Alpha"])))).toEqual(["Alpha", "Étoile", "Zulu"]);
  });

  it("leaves the caller's array alone", () => {
    // `items.sort()` without the spread would reorder the array the caller
    // still holds — and these lists come straight from a cached API response.
    const input = named(["Zulu", "alpha"]);
    const sorted = byName(input);
    expect(names(input)).toEqual(["Zulu", "alpha"]);
    expect(sorted).not.toBe(input);
  });

  it("treats names that differ only in case as the same name, so their order is whatever arrived", () => {
    // Pinning what `sensitivity: "base"` actually does rather than what one
    // might hope: it answers 0 for "Acme" vs "acme", and Array.sort has been
    // stable since ES2019, so the input order survives. The consequence is that
    // byName is NOT a total order for names differing only in case or accent —
    // two such entries can swap between loads if the API order changes.
    expect(names(byName(named(["Acme", "acme"])))).toEqual(["Acme", "acme"]);
    expect(names(byName(named(["acme", "Acme"])))).toEqual(["acme", "Acme"]);
  });
});

describe("byDate", () => {
  it("puts the oldest date first", () => {
    // NOTE: plain `<` passes this one. YYYY-MM-DD is fixed-width and
    // zero-padded, so byte order is already chronological — that is the whole
    // reason the function compares the text and never parses a Date. What this
    // does catch is no sort at all, or a comparator wired up backwards.
    const sorted = byDate(dated([["2026-03-01", "March"], ["2026-01-15", "January"], ["2026-02-20", "February"]]));
    expect(names(sorted)).toEqual(["January", "February", "March"]);
  });

  it("crosses the year boundary the right way round", () => {
    // Also passes naively, for the same reason; it is here because a comparator
    // that parsed month or day out of the string first would get this wrong.
    const sorted = byDate(dated([["2027-01-01", "New Year"], ["2026-12-31", "New Year's Eve"]]));
    expect(names(sorted)).toEqual(["New Year's Eve", "New Year"]);
  });

  it("sorts by date before name — an earlier Zulu still beats a later Aardvark", () => {
    // Catches the two halves of the comparator being swapped, which would look
    // fine on any single-date fixture.
    const sorted = byDate(dated([["2026-06-02", "Aardvark"], ["2026-06-01", "Zulu"]]));
    expect(names(sorted)).toEqual(["Zulu", "Aardvark"]);
  });

  it("falls back to the name for two events on one date", () => {
    // Fed in backwards on purpose: without the `|| name` tiebreak the sort
    // returns 0 for these two, and a stable sort then hands back exactly the
    // order they arrived in — so this fixture is the one that fails.
    const sorted = byDate(dated([["2026-06-01", "Second Show"], ["2026-06-01", "First Show"]]));
    expect(names(sorted)).toEqual(["First Show", "Second Show"]);
  });

  it("gives the same answer whichever order the API returned the day's events in", () => {
    // The property the tiebreak exists for, stated directly: the order must be
    // total. Missing tiebreak plus a stable sort means these two permutations
    // come back different, and a picker reshuffles itself between loads.
    const day: [string, string][] = [
      ["2026-06-01", "Evening Session"],
      ["2026-06-01", "Afternoon Session"],
      ["2026-06-01", "Morning Session"],
    ];
    const expected = ["Afternoon Session", "Evening Session", "Morning Session"];
    expect(names(byDate(dated(day)))).toEqual(expected);
    expect(names(byDate(dated([...day].reverse())))).toEqual(expected);
  });

  it("counts numbers in the same-date fallback too", () => {
    // A tiebreak written as `a.name < b.name` would pass the two tests above
    // and fail this one: it answers Heat 10 before Heat 2.
    const sorted = byDate(dated([["2026-06-01", "Heat 10"], ["2026-06-01", "Heat 2"]]));
    expect(names(sorted)).toEqual(["Heat 2", "Heat 10"]);
  });

  it("ignores capitals in the same-date fallback too", () => {
    // Same idea from the other direction — a `<` tiebreak answers Zulu first.
    const sorted = byDate(dated([["2026-06-01", "Zulu"], ["2026-06-01", "alpha"]]));
    expect(names(sorted)).toEqual(["alpha", "Zulu"]);
  });

  it("leaves the caller's array alone", () => {
    const input = dated([["2026-06-02", "Later"], ["2026-06-01", "Earlier"]]);
    const sorted = byDate(input);
    expect(names(input)).toEqual(["Later", "Earlier"]);
    expect(sorted).not.toBe(input);
  });
});
