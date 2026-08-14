import { describe, expect, it } from "vitest";
import { computeTiming, findConcurrentRows, rowsOnAt, type PlanRow, type WindowRow } from "../src/index";

const H = 3600;
/** A sheet in the shape of the real one: a game, with a pre-record inside it. */
const game: PlanRow[] = [
  { id: "first", type: "cue", durationSec: 40 * 60, hardStartSec: 17 * H + 30 * 60 },
  { id: "prerec", type: "cue", durationSec: 90, hardStartSec: 17 * H + 45 * 60, parallel: true },
  { id: "halftime", type: "cue", durationSec: 11 * 60, hardStartSec: 18 * H + 15 * 60 },
];
const win = (rows: PlanRow[]): WindowRow[] =>
  rows.map((r) => ({ id: r.id, type: r.type, skipped: false, outcome: r.outcome, outcomeGame: r.outcomeGame, parallel: r.parallel }));

describe("findConcurrentRows", () => {
  it("puts a pre-record on at the same time as the game, not instead of it", () => {
    const groups = findConcurrentRows(win(game), computeTiming(game, null));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.indexes).toEqual([0, 1]);
    expect(groups[0]!.startSec).toBe(17 * H + 30 * 60);
    expect(groups[0]!.endSec).toBe(18 * H + 10 * 60);
  });

  it("does not call ordinary consecutive rows concurrent", () => {
    // Every row of a chained sheet ends exactly where the next begins.
    const chain: PlanRow[] = [
      { id: "a", type: "cue", durationSec: 60, hardStartSec: 12 * H },
      { id: "b", type: "cue", durationSec: 60, hardStartSec: null },
      { id: "c", type: "cue", durationSec: 60, hardStartSec: null },
    ];
    expect(findConcurrentRows(win(chain), computeTiming(chain, null))).toEqual([]);
  });

  it("decides by clock, not by position in the sheet", () => {
    // The pre-record is written AFTER the buffer but happens before it. Read
    // in sheet order the buffer's window looked open when the pre-record was
    // tested, and the two were wrongly called concurrent.
    const rows: PlanRow[] = [
      { id: "buffer", type: "cue", durationSec: 300, hardStartSec: 18 * H + 10 * 60 },
      { id: "prerec", type: "cue", durationSec: 90, hardStartSec: 17 * H + 45 * 60, parallel: true },
    ];
    expect(findConcurrentRows(win(rows), computeTiming(rows, null))).toEqual([]);
  });

  it("does not call alternate endings concurrent", () => {
    // Win and lose share a start because only one of them is ever played.
    const endings: PlanRow[] = [
      { id: "w", type: "cue", durationSec: 120, hardStartSec: 21 * H, outcome: "win", outcomeGame: 1 },
      { id: "l", type: "cue", durationSec: 120, hardStartSec: 21 * H, outcome: "lose", outcomeGame: 1 },
    ];
    expect(findConcurrentRows(win(endings), computeTiming(endings, null))).toEqual([]);
  });

  it("groups a block with everything that fills it", () => {
    const block: PlanRow[] = [
      { id: "ht", type: "cue", durationSec: 11 * 60, hardStartSec: 18 * H + 15 * 60 },
      { id: "wrap", type: "cue", durationSec: 30, hardStartSec: 18 * H + 15 * 60 },
      { id: "reads", type: "cue", durationSec: 90, hardStartSec: 18 * H + 15 * 60 + 30 },
    ];
    const groups = findConcurrentRows(win(block), computeTiming(block, null));
    expect(groups).toHaveLength(1);
    expect(groups[0]!.indexes).toEqual([0, 1, 2]);
  });
});

describe("rowsOnAt", () => {
  const timing = computeTiming(game, null);
  it("returns the game AND the pre-record while both are running", () => {
    expect(rowsOnAt(win(game), timing, 17 * H + 45 * 60 + 30)).toEqual(["first", "prerec"]);
  });
  it("returns only the game once the pre-record has finished", () => {
    expect(rowsOnAt(win(game), timing, 17 * H + 50 * 60)).toEqual(["first"]);
  });
  it("returns nothing before the sheet starts", () => {
    expect(rowsOnAt(win(game), timing, 10 * H)).toEqual([]);
  });
});
