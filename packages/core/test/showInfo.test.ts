import { describe, expect, it } from "vitest";
import { splitShowInfo, type ClassifiedRow } from "../src/import";

const row = (p: Partial<ClassifiedRow>): ClassifiedRow => ({
  kind: "cue",
  title: "",
  startSec: null,
  startRaw: null,
  durationSec: null,
  durationRaw: null,
  cells: {},
  sourceIndex: 0,
  ...p,
});

const HEADER = "2025 NRLW TELSTRA PREMIERSHIP ROUND 11";

describe("splitShowInfo", () => {
  const sheet = [
    row({ title: HEADER }),
    row({ title: "Wests Tigers Try" }),
    row({ title: "Try Sting - Freed From Desire" }),
    row({ title: "Gates Open", startSec: 46800, startRaw: null }),
    row({ title: HEADER }),
    row({ title: "Kick off", startSec: 50700 }),
    row({ title: HEADER }),
  ];
  const out = splitShowInfo(sheet, [HEADER]);

  it("takes the page header out of the running order", () => {
    expect(out.rows.map((r) => r.title)).toEqual([
      "Wests Tigers Try",
      "Try Sting - Freed From Desire",
      "Gates Open",
      "Kick off",
    ]);
  });

  it("records it once, not once per page", () => {
    expect(out.info).toEqual([{ kind: "furniture", lines: [HEADER] }]);
  });

  // The mistake this replaced: repetition alone moved these off a live sheet.
  it("keeps untimed contingency cues, which is why geometry decides and not this", () => {
    expect(out.rows.map((r) => r.title)).toContain("Try Sting - Freed From Desire");
  });

  it("never moves a timed row, even if the geometry names it", () => {
    const timedHeader = [row({ title: HEADER, startSec: 100 }), row({ title: HEADER })];
    const r = splitShowInfo(timedHeader, [HEADER]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.startSec).toBe(100);
  });

  it("does nothing at all when the geometry found no furniture", () => {
    const r = splitShowInfo(sheet, []);
    expect(r.rows).toHaveLength(sheet.length);
    expect(r.info).toEqual([]);
  });

  it("matches on the whole printed line, cells included", () => {
    const withCells = [row({ title: "OpenCall", cells: { c1: "Round 11" } }), row({ title: "Kick off", startSec: 1 })];
    const r = splitShowInfo(withCells, ["OpenCall Round 11"]);
    expect(r.rows.map((x) => x.title)).toEqual(["Kick off"]);
  });
});
