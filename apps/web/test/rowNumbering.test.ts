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
