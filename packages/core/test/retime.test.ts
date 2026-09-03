import { describe, expect, it } from "vitest";
import { fixedTimesAfterMove, runningLength, strikeShift } from "../src/retime";
import type { PlanRow } from "../src/types";

const T = (h: number, m: number, s = 0): number => h * 3600 + m * 60 + s;
const cue = (id: string, durationSec: number | null, hardStartSec: number | null, extra: Partial<PlanRow> = {}): PlanRow => ({
  id,
  type: "cue",
  durationSec,
  hardStartSec,
  ...extra,
});

/** A 19:00 A 2m · B 3m · C 1m · D 4m · E flowing — every printed time meets the one above. */
const sheet = (): PlanRow[] => [
  cue("A", 120, T(19, 0)),
  cue("B", 180, T(19, 2)),
  cue("C", 60, T(19, 5)),
  cue("D", 240, T(19, 6)),
  cue("E", 90, null),
];

describe("runningLength", () => {
  it("is the duration for an ordinary cue and nothing for a row outside the running order", () => {
    expect(runningLength(cue("x", 120, null))).toBe(120);
    expect(runningLength(cue("x", null, null))).toBe(0);
    expect(runningLength(cue("x", 120, null, { parallel: true }))).toBe(0);
    expect(runningLength(cue("x", 120, null, { spans: true }))).toBe(0);
    expect(runningLength(cue("x", 120, null, { durationMuted: true }))).toBe(0);
  });
});

describe("strikeShift", () => {
  it("striking a row moves every fixed time below up by its length, and putting it back moves them down again", () => {
    expect(strikeShift(sheet(), 1, true)).toBe(-180);
    expect(strikeShift(sheet(), 1, false)).toBe(180);
  });

  it("a row with no running length moves nothing", () => {
    const rows = sheet();
    rows[1] = cue("B", 180, T(19, 2), { durationMuted: true });
    expect(strikeShift(rows, 1, true)).toBe(0);
    rows[1] = cue("B", null, T(19, 2));
    expect(strikeShift(rows, 1, true)).toBe(0);
  });

  it("an alternate ending moves nothing — only the longest branch costs the day anything", () => {
    const rows = sheet();
    rows[1] = cue("B", 180, T(19, 2), { outcome: "win" });
    expect(strikeShift(rows, 1, true)).toBe(0);
  });

  it("a row struck above the live cue moves nothing", () => {
    expect(strikeShift(sheet(), 1, true, 2)).toBe(0);
    expect(strikeShift(sheet(), 1, true, 1)).toBe(-180);
    expect(strikeShift(sheet(), 3, true, 1)).toBe(-240);
  });

  it("an index off the sheet moves nothing", () => {
    expect(strikeShift(sheet(), 9, true)).toBe(0);
  });
});

describe("fixedTimesAfterMove", () => {
  it("dragged down: the rows it jumped move up by its length, and it takes the time of its new place", () => {
    const changes = fixedTimesAfterMove(sheet(), 0, 2);
    expect(changes).toEqual([
      { id: "B", hardStartSec: T(19, 0) },
      { id: "C", hardStartSec: T(19, 3) },
      { id: "A", hardStartSec: T(19, 4) },
    ]);
  });

  it("dragged up: the rows it jumped move down by its length, and it takes the time of its new place", () => {
    const changes = fixedTimesAfterMove(sheet(), 3, 1);
    expect(changes).toEqual([
      { id: "B", hardStartSec: T(19, 6) },
      { id: "C", hardStartSec: T(19, 9) },
      { id: "D", hardStartSec: T(19, 2) },
    ]);
  });

  it("rows outside the span keep their times", () => {
    const ids = fixedTimesAfterMove(sheet(), 0, 2).map((c) => c.id);
    expect(ids).not.toContain("D");
    expect(ids).not.toContain("E");
  });

  it("a flowing row moved still shifts what it jumped, and takes no time of its own", () => {
    const rows = sheet();
    rows[1] = cue("B", 180, null);
    expect(fixedTimesAfterMove(rows, 1, 2)).toEqual([{ id: "C", hardStartSec: T(19, 2) }]);
  });

  it("a struck row moved shifts nothing — it has no length in the running order", () => {
    const rows = sheet();
    rows[1] = cue("B", 180, T(19, 2), { skipped: true });
    // it still takes the time of its new place: the end of C, which follows A directly now
    expect(fixedTimesAfterMove(rows, 1, 2)).toEqual([{ id: "B", hardStartSec: T(19, 6) }]);
  });

  it("a pre-record keeps its own time wherever it is put", () => {
    const rows = sheet();
    rows[0] = cue("A", 120, T(19, 0), { parallel: true });
    expect(fixedTimesAfterMove(rows, 0, 2)).toEqual([]);
  });

  it("a heading takes the time of its new place and moves nothing else", () => {
    const rows = sheet();
    rows[0] = { ...cue("A", 900, T(19, 0), { spans: true }), type: "group" };
    expect(fixedTimesAfterMove(rows, 0, 2)).toEqual([{ id: "A", hardStartSec: T(19, 6) }]);
  });

  it("the new time is written as a time of day when the move crosses midnight", () => {
    const rows = [cue("A", 180, T(23, 58)), cue("B", 120, T(0, 1)), cue("C", 60, T(0, 3))];
    expect(fixedTimesAfterMove(rows, 0, 1)).toEqual([
      { id: "B", hardStartSec: T(23, 58) },
      { id: "A", hardStartSec: 0 },
    ]);
  });

  it("nowhere to go: same place, or off the sheet", () => {
    expect(fixedTimesAfterMove(sheet(), 2, 2)).toEqual([]);
    expect(fixedTimesAfterMove(sheet(), 2, 7)).toEqual([]);
  });
});
