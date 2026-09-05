import { describe, expect, it } from "vitest";
import { countStrokes, eraseAt, isInkDoc, pathFor, segmentDistance, simplify, type Stroke } from "../src/ink";

const line = (c: Stroke["c"], ...p: number[]): Stroke => ({ c, p });

describe("pathFor", () => {
  it("scales x by the row width and leaves y alone", () => {
    expect(pathFor(line("red", 0, 4, 0.5, 10), 200)).toBe("M0 4L100 10");
  });
  it("draws a tap as a hair of a segment so round caps make a dot", () => {
    expect(pathFor(line("red", 0.25, 6), 400)).toBe("M100 6l0.01 0");
  });
  it("draws nothing for an empty stroke", () => {
    expect(pathFor(line("red"), 400)).toBe("");
  });
});

describe("simplify", () => {
  it("keeps the ends and drops samples closer than the threshold", () => {
    // 100 px wide row: x steps of 0.005 are half a pixel apart.
    const p = [0, 0, 0.005, 0, 0.01, 0, 0.1, 0, 0.5, 0];
    expect(simplify(p, 100)).toEqual([0, 0, 0.1, 0, 0.5, 0]);
  });
  it("leaves a two-point stroke alone", () => {
    expect(simplify([0, 0, 1, 1], 100)).toEqual([0, 0, 1, 1]);
  });
});

describe("eraseAt", () => {
  const long = line("red", 0, 10, 1, 10); // a ruler-straight line across a 300 px row
  const dot = line("blue", 0.5, 40);
  it("lifts a stroke the eraser crosses, even between its two points", () => {
    expect(eraseAt([long, dot], 0.5, 12, 10, 300)).toEqual([dot]);
  });
  it("lifts a dot within reach and returns the same array when nothing is hit", () => {
    const strokes = [long, dot];
    expect(eraseAt(strokes, 0.5, 46, 10, 300)).toEqual([long]);
    expect(eraseAt(strokes, 0.5, 80, 10, 300)).toBe(strokes);
  });
  it("reaches further for the wide marker", () => {
    const band = line("marker", 0, 50, 1, 50);
    expect(eraseAt([band], 0.5, 65, 10, 300)).toEqual([]); // 15 px off: radius 10 + half of 14
    expect(eraseAt([long], 0.5, 25, 10, 300)).toEqual([long]); // 15 px off a 2.5 px pen: missed
  });
});

describe("segmentDistance", () => {
  it("measures to the nearest point of the segment, ends included", () => {
    expect(segmentDistance(5, 3, 0, 0, 10, 0)).toBe(3);
    expect(segmentDistance(-4, 3, 0, 0, 10, 0)).toBe(5);
    expect(segmentDistance(1, 1, 2, 2, 2, 2)).toBeCloseTo(Math.SQRT2);
  });
});

describe("isInkDoc", () => {
  it("accepts a proper sheet and counts it", () => {
    const doc = { r1: [line("red", 0, 0, 1, 1)], r2: [] };
    expect(isInkDoc(doc)).toBe(true);
    expect(countStrokes(doc)).toBe(1);
  });
  it("refuses arrays, unknown colours, odd point lists and non-finite numbers", () => {
    expect(isInkDoc([])).toBe(false);
    expect(isInkDoc({ r: [{ c: "green", p: [0, 0] }] })).toBe(false);
    expect(isInkDoc({ r: [{ c: "red", p: [0, 0, 1] }] })).toBe(false);
    expect(isInkDoc({ r: [{ c: "red", p: [0, Number.NaN] }] })).toBe(false);
    expect(isInkDoc({ r: [{ c: "red", p: [] }] })).toBe(false);
  });
});
