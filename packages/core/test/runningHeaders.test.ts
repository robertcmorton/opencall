import { describe, expect, it } from "vitest";
import { detectRunningHeaders, type LineMeta } from "../src/import";

/** Six pages of a sheet: a header at the same height on each, and a
 *  contingency cue that repeats just as often but wherever it falls. */
const build = () => {
  const grid: string[][] = [];
  const meta: LineMeta[] = [];
  const add = (cells: string[], page: number, y: number) => {
    grid.push(cells);
    meta.push({ page, y });
  };
  for (let page = 0; page < 6; page++) {
    add(["2025 NRLW TELSTRA PREMIERSHIP ROUND 11"], page, 780.4 + (page % 2) * 0.3); // printed header, sub-point drift
    add(["Confidential — not for distribution"], page, 40);                           // footer, same height
    add(["Page " + (page + 1) + " of 6"], page, 26);                                  // numbered footer: text differs
    add(["1:00pm", "Gates Open"], page, 700 - page * 3);                              // ordinary cues
    add(["Try Sting - Freed From Desire"], page, 500 - page * 37);                    // repeats, never same height
  }
  return { grid, meta };
};

describe("detectRunningHeaders", () => {
  const { grid, meta } = build();
  const found = detectRunningHeaders(grid, meta);

  it("finds the header printed at the same height on every page", () => {
    expect(found).toContain("2025 NRLW TELSTRA PREMIERSHIP ROUND 11");
  });

  it("finds a fixed footer too", () => {
    expect(found).toContain("Confidential — not for distribution");
  });

  // This used to be deliberate under-detection: matching was on exact text, so
  // a footer carrying its page number never repeated and always escaped. The
  // reasoning was that ignoring digits would also start matching rows that
  // differ only by a number, which on a run sheet is a whole class of real cue
  // — one stray footer per page being cheaper than one lost cue.
  //
  // Both halves of that turned out to be true, and the footer half was worse
  // than it reads: the escaped line is not left sitting on its own, it gets
  // absorbed into whatever cue precedes the page break, so a production
  // company's name and "NOT FOR EXTERNAL DISTRIBUTION 12" arrive INSIDE a cue.
  // It is now matched — but by page number specifically, never by shape. The
  // three tests below are the ones that keep the old warning true.
  it("finds a footer that carries its page number", () => {
    expect(found).toContain("Page 1 of 6");
    expect(found).toContain("Page 6 of 6");
  });

  // The failure the old comment predicted, reproduced: a team list prints the
  // same position against different jersey numbers, and blanking digits made
  // those look like one line printed over and over. Measured on a real run
  // sheet, the loose version deleted ten live cues. A page number is printed
  // once on its page; a squad position is printed against every player, so
  // more than one on a page is never a page number.
  it("does NOT mistake a team list for a numbered footer", () => {
    const grid: string[][] = [];
    const meta: LineMeta[] = [];
    for (let page = 0; page < 6; page++) {
      // Two props on every page — jersey 8 and jersey 10, same position.
      grid.push([String(page + 1), "Front Row"]);
      meta.push({ page, y: 300 });
      grid.push([String(page + 1), "Front Row"]);
      meta.push({ page, y: 300 });
    }
    expect(detectRunningHeaders(grid, meta)).toEqual([]);
  });

  // A footer that is NOTHING but the page number would come back as the
  // strings "1", "2", "3"… and a caller matching whole lines against those
  // drops any line that is only a number — a jersey number, a cue number, a
  // score. Nothing is returned unless what is left after the page number has
  // letters in it.
  it("never returns a bare page number as furniture", () => {
    const grid: string[][] = [];
    const meta: LineMeta[] = [];
    for (let page = 0; page < 6; page++) {
      grid.push([String(page + 1)]);
      meta.push({ page, y: 26 });
    }
    expect(detectRunningHeaders(grid, meta)).toEqual([]);
  });

  // The whole reason this function exists rather than a repetition count.
  it("does NOT mistake a repeated contingency cue for furniture", () => {
    expect(found).not.toContain("Try Sting - Freed From Desire");
  });

  it("leaves ordinary cues alone", () => {
    expect(found.some((t) => t.includes("Gates Open"))).toBe(false);
  });

  it("says nothing about a sheet too short to show a pattern", () => {
    const twoPages = {
      grid: [["Header"], ["Header"]],
      meta: [{ page: 0, y: 780 }, { page: 1, y: 780 }] as LineMeta[],
    };
    expect(detectRunningHeaders(twoPages.grid, twoPages.meta)).toEqual([]);
  });

  it("needs no lineMeta to be safe — it simply finds nothing", () => {
    expect(detectRunningHeaders([["A"], ["A"], ["A"]], [])).toEqual([]);
  });
});
