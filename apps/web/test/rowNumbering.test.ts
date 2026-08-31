import { describe, expect, it } from "vitest";
import { rowNumbering } from "../lib/rowNumbering";

describe("rowNumbering", () => {
  it("counts from one when the sheet has no numbering of its own", () => {
    const at = rowNumbering([{}, {}, {}]);
    expect([0, 1, 2].map(at)).toEqual(["1", "2", "3"]);
  });

  // The case that started this: an imported sheet whose first row is item 11,
  // because the sheet's heading is printed after ten items of build-up. Every
  // screen has to say 11.
  it("keeps the sheet's own numbering, even where it does not start at one", () => {
    const at = rowNumbering([{ sourceNumber: "11" }, { sourceNumber: "12" }, { sourceNumber: "13" }]);
    expect([0, 1, 2].map(at)).toEqual(["11", "12", "13"]);
  });

  // A numbered sheet that leaves a row unnumbered — a banner, a section rule.
  // The prompter and the guest view used to fall back to the row's POSITION
  // here, so the row showed a number the sheet never gave it, and that number
  // belongs to a different row further down.
  it("leaves an unnumbered row blank rather than inventing a position for it", () => {
    const at = rowNumbering([{ sourceNumber: "11" }, {}, { sourceNumber: "12" }]);
    expect([0, 1, 2].map(at)).toEqual(["11", "", "12"]);
  });

  it("treats one numbered row as enough to mirror the sheet", () => {
    const at = rowNumbering([{}, { sourceNumber: "7" }]);
    expect([0, 1].map(at)).toEqual(["", "7"]);
  });

  it("trims what the sheet gave it, and survives being asked about nothing", () => {
    const at = rowNumbering([{ sourceNumber: " 4 " }]);
    expect(at(0)).toBe("4");
    expect(at(99)).toBe("");
  });
});

describe("endings", () => {
  const at = (outcome: string | null, sourceNumber?: string) => ({ outcome, ...(sourceNumber ? { sourceNumber } : {}) });

  it("names an ending after the row it hangs off, and what it is", () => {
    const rows = [at(null, "49"), at(null, "50"), at("win"), at("lose"), at("draw"), at("golden")];
    const n = rowNumbering(rows);
    expect([2, 3, 4, 5].map(n)).toEqual(["50W", "50L", "50D", "50GP"]);
  });

  it("follows the competition's own word for the extra period", () => {
    // Some kinds of show call it extra time, not golden point.
    const rows = [at(null, "12"), at("golden")];
    expect(rowNumbering(rows, "ET")(1)).toBe("12ET");
  });

  it("does not let an ending consume a number on a counted sheet", () => {
    // THE BUG. Counting positions gave every alternative a number of its own,
    // so a sheet with three endings ran three numbers ahead of the paper from
    // that point down.
    const rows = [at(null), at(null), at("win"), at("lose"), at("draw"), at(null)];
    const n = rowNumbering(rows);
    expect([0, 1].map(n)).toEqual(["1", "2"]);
    expect([2, 3, 4].map(n)).toEqual(["2W", "2L", "2D"]);
    expect(n(5)).toBe("3"); // the row after the endings, NOT 6
  });

  it("hangs every ending off the same row, not off each other", () => {
    const rows = [at(null, "7"), at("win"), at("lose")];
    expect([1, 2].map(rowNumbering(rows))).toEqual(["7W", "7L"]);
  });

  it("says only what it is when nothing above it was numbered", () => {
    // A sheet whose ending block comes before anything the sheet numbered.
    // Better a bare "W" than a number invented to hang it off.
    expect(rowNumbering([at("win", undefined), at(null, "3")])(0)).toBe("W");
  });
});

/**
 * Measured, not assumed. Across the sample sheets every one of the 1591 ending
 * rows carries a printed number and none is blank — so the rule that discarded
 * them was not a rare edge, it was the whole corpus.
 */
describe("endings the paper numbered", () => {
  const end = (outcome: string, sourceNumber?: string) => ({ outcome, ...(sourceNumber ? { sourceNumber } : {}) });

  it("keeps the printed number of an ending, like every other row", () => {
    const rows = [{ sourceNumber: "4" }, end("win", "5"), end("win", "6"), end("golden", "11")];
    expect([1, 2, 3].map(rowNumbering(rows))).toEqual(["5", "6", "11"]);
  });

  it("tells the rows of one branch apart when the paper did not number them", () => {
    // THE BUG BEHIND THE REPORT: three rows all called 50GP. "Go to fifty-GP"
    // named three different rows at once.
    const rows = [{ sourceNumber: "50" }, end("golden"), end("golden"), end("golden")];
    expect([1, 2, 3].map(rowNumbering(rows))).toEqual(["50GP.1", "50GP.2", "50GP.3"]);
  });

  it("leaves a branch of one alone", () => {
    const rows = [{ sourceNumber: "50" }, end("win"), end("lose")];
    expect([1, 2].map(rowNumbering(rows))).toEqual(["50W", "50L"]);
  });

  it("numbers only the parts the paper left out", () => {
    const rows = [{ sourceNumber: "50" }, end("golden", "51"), end("golden"), end("golden")];
    expect([1, 2, 3].map(rowNumbering(rows))).toEqual(["51", "50GP.1", "50GP.2"]);
  });

  it("still keeps endings out of the count on a sheet counting from one", () => {
    const rows = [{}, {}, end("win"), end("win"), {}];
    const n = rowNumbering(rows);
    expect([0, 1].map(n)).toEqual(["1", "2"]);
    expect([2, 3].map(n)).toEqual(["2W.1", "2W.2"]);
    expect(n(4)).toBe("3");
  });
});
