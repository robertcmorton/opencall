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

  // Deliberate under-detection. Matching is on exact text, so a footer whose
  // page number changes escapes. Loosening it to ignore digits would catch
  // these — and would also start matching rows that differ only by a number,
  // which on a run sheet is a whole class of real cue. One stray page number
  // per page is a cheaper mistake than one lost cue.
  it("lets a numbered footer through rather than risk matching by shape", () => {
    expect(found.some((t) => t.startsWith("Page "))).toBe(false);
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
