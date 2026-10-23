import { describe, expect, it } from "vitest";
import { fixedTimesAfterMove, runningLength, strikeShift, timesAfterAdd, timesAfterDelete } from "../src/retime";
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

  it("a struck row moved: the row that followed it closes up to the row above, and the struck row takes its new place", () => {
    // B is struck, but C still carried the 19:05 it was printed with — a
    // three-minute hole. Once B is gone from between them, C follows A
    // directly, and B lands after C.
    const rows = sheet();
    rows[1] = cue("B", 180, T(19, 2), { skipped: true });
    expect(fixedTimesAfterMove(rows, 1, 2)).toEqual([
      { id: "C", hardStartSec: T(19, 2) },
      { id: "B", hardStartSec: T(19, 3) },
    ]);
  });

  it("a pre-record keeps its own time wherever it is put; the rows behind it close up to the sheet's start", () => {
    // A pre-record takes none of the running order's time, so B at 19:02 on a
    // sheet that starts at 19:00 was sitting two minutes into a hole. With A
    // out of the way B starts where the sheet starts; A itself is not re-timed.
    const rows = sheet();
    rows[0] = cue("A", 120, T(19, 0), { parallel: true });
    expect(fixedTimesAfterMove(rows, 0, 2)).toEqual([
      { id: "B", hardStartSec: T(19, 0) },
      { id: "C", hardStartSec: T(19, 3) },
    ]);
  });

  it("a heading moved: the rows behind it close up, and it takes the time of its new place", () => {
    const rows = sheet();
    rows[0] = { ...cue("A", 900, T(19, 0), { spans: true }), type: "group" };
    expect(fixedTimesAfterMove(rows, 0, 2)).toEqual([
      { id: "B", hardStartSec: T(19, 0) },
      { id: "C", hardStartSec: T(19, 3) },
      { id: "A", hardStartSec: T(19, 4) },
    ]);
  });

  it("the new time is written as a time of day when the move crosses midnight", () => {
    const rows = [cue("A", 180, T(23, 58)), cue("B", 120, T(0, 1)), cue("C", 60, T(0, 3))];
    expect(fixedTimesAfterMove(rows, 0, 1)).toEqual([
      { id: "B", hardStartSec: T(23, 58) },
      { id: "A", hardStartSec: 0 },
    ]);
  });

  describe("live — the cue is the anchor", () => {
    // A 19:00 (2m) · B 19:02 (3m) · C 19:05 (1m) · D 19:06 (4m) · E flowing. Live cue: B.
    it("a future row moved above the cue: the cue and what is between stay, everything below its old place loses its length", () => {
      // D (4m) goes above B. B is on air at 19:02 and must not move; C was
      // before D already and keeps 19:05; E loses nothing it had (flowing).
      const rows = sheet();
      rows[4] = cue("E", 90, T(19, 10));
      expect(fixedTimesAfterMove(rows, 3, 1, null, 1)).toEqual([
        { id: "E", hardStartSec: T(19, 6) },
        { id: "D", hardStartSec: T(19, 2) },
      ]);
    });

    it("a pre-record between the cue and the old place is left alone — its length is not the show's", () => {
      const rows = sheet();
      rows[2] = cue("C", 60, T(19, 5), { parallel: true });
      rows[4] = cue("E", 90, T(19, 10));
      const ids = fixedTimesAfterMove(rows, 3, 1, null, 1).map((c) => c.id);
      expect(ids).not.toContain("B");
      expect(ids).not.toContain("C");
      expect(ids).toContain("E");
    });

    it("a past row moved below the cue: everything below its new place gains its length", () => {
      // A (2m) goes below C, with B live. B and C stay; D gains two minutes.
      const rows = sheet();
      expect(fixedTimesAfterMove(rows, 0, 2, null, 1)).toEqual([
        { id: "D", hardStartSec: T(19, 8) },
        { id: "A", hardStartSec: T(19, 6) },
      ]);
    });

    it("moving the cue itself, or moving within the past, re-times nothing", () => {
      expect(fixedTimesAfterMove(sheet(), 1, 3, null, 1)).toEqual([]);
      expect(fixedTimesAfterMove(sheet(), 0, 1, null, 2)).toEqual([]);
    });

    it("both in the future: the plain re-ordering rule still applies", () => {
      expect(fixedTimesAfterMove(sheet(), 2, 3, null, 0)).toEqual([
        { id: "D", hardStartSec: T(19, 5) },
        { id: "C", hardStartSec: T(19, 9) },
      ]);
    });
  });

  it("a hole under a struck duration is absorbed, not carried: the row after the moved row starts when it ends", () => {
    // From a real sheet. Row 2's ten minutes are struck, so row 3 sat at 5:30
    // with a ten-minute hole after row 2's 5:20. Moving the hour-long row 5
    // above row 3 must put row 3 at 6:20 (5:20 + 1:00), not 6:30 (5:30 + 1:00).
    const rows: PlanRow[] = [
      cue("r1", 5400, T(16, 0)),
      cue("r2", 600, T(17, 20), { durationMuted: true }),
      cue("r3", 2400, T(17, 30)),
      cue("r4", 20, T(17, 50), { parallel: true }),
      cue("r5", 3600, T(18, 10)),
      cue("r6", 600, T(19, 10)),
    ];
    expect(fixedTimesAfterMove(rows, 4, 2)).toEqual([
      { id: "r3", hardStartSec: T(18, 20) },
      { id: "r4", hardStartSec: T(18, 40) },
      { id: "r5", hardStartSec: T(17, 20) },
    ]);
  });

  it("nowhere to go: same place, or off the sheet", () => {
    expect(fixedTimesAfterMove(sheet(), 2, 2)).toEqual([]);
    expect(fixedTimesAfterMove(sheet(), 2, 7)).toEqual([]);
  });
});

describe("timesAfterAdd — a new row takes its place in the timing", () => {
  it("every fixed time below moves on by the new row's length, and nothing above moves", () => {
    const { changes, firstStartSec } = timesAfterAdd(sheet(), 2, [cue("N", 60, null)]);
    expect(changes).toEqual([
      { id: "C", hardStartSec: T(19, 6) },
      { id: "D", hardStartSec: T(19, 7) },
    ]);
    // It flows from the row above: 19:05, where it was put.
    expect(firstStartSec).toBeNull();
  });

  it("several new rows move the times below by all of their length", () => {
    expect(timesAfterAdd(sheet(), 3, [cue("N", 60, null), cue("M", 30, null)]).changes).toEqual([{ id: "D", hardStartSec: T(19, 7, 30) }]);
  });

  it("a heading, a struck row, an ending or a pre-record puts no time in", () => {
    const heading: PlanRow = { id: "H", type: "group", durationSec: null, hardStartSec: null };
    expect(timesAfterAdd(sheet(), 2, [heading]).changes).toEqual([]);
    expect(timesAfterAdd(sheet(), 2, [cue("S", 60, null, { skipped: true })]).changes).toEqual([]);
    expect(timesAfterAdd(sheet(), 2, [cue("O", 60, null, { outcome: "win" })]).changes).toEqual([]);
    expect(timesAfterAdd(sheet(), 2, [cue("P", 60, null, { parallel: true })]).changes).toEqual([]);
  });

  it("added above the live cue it moves nothing; below it, the rows below move", () => {
    expect(timesAfterAdd(sheet(), 2, [cue("N", 60, null)], null, 3).changes).toEqual([]);
    expect(timesAfterAdd(sheet(), 2, [cue("N", 60, null)], null, 1).changes.map((c) => c.id)).toEqual(["C", "D"]);
  });

  it("at the top of a sheet with no planned start, it takes the time of the row it pushed down", () => {
    const { changes, firstStartSec } = timesAfterAdd(sheet(), 0, [cue("N", 60, null)]);
    expect(firstStartSec).toBe(T(19, 0));
    expect(changes[0]).toEqual({ id: "A", hardStartSec: T(19, 1) });
  });

  it("…and flows from the planned start when the sheet has one", () => {
    expect(timesAfterAdd(sheet(), 0, [cue("N", 60, null)], T(18, 59)).firstStartSec).toBeNull();
  });

  it("keeps times on the dial across midnight", () => {
    const rows = [cue("A", 600, T(23, 50)), cue("B", 60, T(0, 0))];
    expect(timesAfterAdd(rows, 1, [cue("N", 300, null)]).changes).toEqual([{ id: "B", hardStartSec: T(0, 5) }]);
  });
});

describe("timesAfterDelete — a deleted row's time leaves the sheet", () => {
  it("every fixed time below starts earlier by the deleted row's length", () => {
    expect(timesAfterDelete(sheet(), new Set(["B"]))).toEqual([
      { id: "C", hardStartSec: T(19, 2) },
      { id: "D", hardStartSec: T(19, 3) },
    ]);
  });

  it("several rows at once take all of their time away", () => {
    expect(timesAfterDelete(sheet(), new Set(["B", "C"]))).toEqual([{ id: "D", hardStartSec: T(19, 2) }]);
  });

  it("a struck row, a heading or an ending takes nothing away", () => {
    const rows = [cue("A", 120, T(19, 0)), cue("S", 60, null, { skipped: true }), cue("O", 60, null, { outcome: "win" }), cue("B", 60, T(19, 2))];
    expect(timesAfterDelete(rows, new Set(["S", "O"]))).toEqual([]);
  });

  it("a row that flowed from a deleted fixed row takes its time", () => {
    const rows = [cue("A", 120, T(19, 0)), cue("B", 180, null), cue("C", 60, null)];
    expect(timesAfterDelete(rows, new Set(["A"]))).toEqual([{ id: "B", hardStartSec: T(19, 0) }]);
    // Two gone from the top: the first that stays starts where the first gone did.
    expect(timesAfterDelete(rows, new Set(["A", "B"]))).toEqual([{ id: "C", hardStartSec: T(19, 0) }]);
  });

  it("above the live cue, nothing below moves", () => {
    expect(timesAfterDelete(sheet(), new Set(["A"]), 2)).toEqual([]);
  });
});

describe("adding and deleting stop at the next row that must start on time", () => {
  // A 19:00 2m · B 19:02 3m · C 19:05 1m · D 19:06 4m (must start on time) · E flowing
  const must = new Set([3]);

  it("an added row moves the rows below down to the must-start row, which keeps its time", () => {
    expect(timesAfterAdd(sheet(), 2, [cue("N", 60, null)], null, -1, must).changes).toEqual([{ id: "C", hardStartSec: T(19, 6) }]);
  });

  it("added right in front of it, nothing moves — the new row runs past it, which the on-time window shows", () => {
    expect(timesAfterAdd(sheet(), 3, [cue("N", 60, null)], null, -1, must).changes).toEqual([]);
  });

  it("a Kick-off row at the same moment, straight in front of the half, keeps its time with it", () => {
    const rows: PlanRow[] = [cue("A", 120, T(19, 0)), { id: "K", type: "milestone", durationSec: null, hardStartSec: T(19, 2) }, cue("H", 2400, null)];
    expect(timesAfterAdd(rows, 1, [cue("N", 60, null)], null, -1, new Set([2])).changes).toEqual([]);
  });

  it("a must-start row with no printed time is given the one it has, so it cannot be carried along", () => {
    const rows = [cue("A", 120, T(19, 0)), cue("B", 180, null), cue("W", 60, null)];
    expect(timesAfterAdd(rows, 1, [cue("N", 60, null)], null, -1, new Set([2])).changes).toEqual([{ id: "W", hardStartSec: T(19, 5) }]);
  });

  it("a deleted row's time waits in front of the must-start row; below it, nothing moves", () => {
    expect(timesAfterDelete(sheet(), new Set(["B"]), -1, must)).toEqual([{ id: "C", hardStartSec: T(19, 2) }]);
  });
});
