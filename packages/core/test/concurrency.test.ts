import { describe, expect, it } from "vitest";
import { clockTargetRow, computeTiming, findConcurrentRows, rowsOnAt, type PlanRow, type WindowRow } from "../src/index";

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

describe("a second track is never cued", () => {
  const rows: PlanRow[] = [
    { id: "first", type: "cue", durationSec: 40 * 60, hardStartSec: 17 * H + 30 * 60 },
    { id: "prerec", type: "cue", durationSec: 90, hardStartSec: 17 * H + 45 * 60, parallel: true },
    { id: "halftime", type: "cue", durationSec: 11 * 60, hardStartSec: 18 * H + 15 * 60 },
  ];
  const timing = computeTiming(rows, null);
  const target = (nowAbs: number) =>
    clockTargetRow(
      rows.map((r) => ({ id: r.id, type: r.type, skipped: false, parallel: r.parallel, hardStartSec: r.hardStartSec })),
      timing.rows.map((r) => r.startSec),
      nowAbs,
    );

  it("the clock stays on the game while the pre-record is being shot", () => {
    // 5:46 PM: the pre-record is a minute in. The show is still the game.
    expect(target(17 * H + 46 * 60)).toBe("first");
  });

  it("but the pre-record is still ON, and shown as such", () => {
    expect(rowsOnAt(win(rows), timing, 17 * H + 46 * 60)).toEqual(["first", "prerec"]);
  });

  it("the clock still moves on normally afterwards", () => {
    expect(target(18 * H + 20 * 60)).toBe("halftime");
  });
});

describe("rowsOnAt: rows the sheet gives no length", () => {
  const H2 = 3600;
  // Four rows sharing a moment, as a real sheet writes a half: the period
  // banner, a standby with no length, the block, and the block's first cue.
  const sheet: PlanRow[] = [
    { id: "standby", type: "cue", durationSec: null, hardStartSec: 20 * H2 },
    { id: "block", type: "cue", durationSec: 900, hardStartSec: 20 * H2, spans: true },
    { id: "wrap", type: "cue", durationSec: 60, hardStartSec: 20 * H2 },
    { id: "after", type: "cue", durationSec: 60, hardStartSec: 20 * H2 + 40 * 60 },
  ];
  const timing = computeTiming(sheet, null);
  const w = win(sheet);

  it("counts an untimed row as running until the next row starts", () => {
    // Treated as zero seconds long it was never on at all, so the bar showed
    // on one row of four that share the moment.
    expect(rowsOnAt(w, timing, 20 * H2 + 30)).toContain("standby");
  });

  it("has all four on together at the moment they share", () => {
    expect(rowsOnAt(w, timing, 20 * H2 + 30).sort()).toEqual(["block", "standby", "wrap"]);
  });

  it("drops each as it ends", () => {
    expect(rowsOnAt(w, timing, 20 * H2 + 120)).toEqual(["standby", "block"]);
    expect(rowsOnAt(w, timing, 20 * H2 + 20 * 60)).toEqual(["standby"]);
  });

  it("does not put a bar on a heading", () => {
    const withGroup: PlanRow[] = [{ id: "hdr", type: "group", durationSec: null, hardStartSec: 20 * H2 }, ...sheet];
    expect(rowsOnAt(win(withGroup), computeTiming(withGroup, null), 20 * H2 + 30)).not.toContain("hdr");
  });
});

/**
 * `rowsOnAt` works out where an untimed row ends by looking forward for the
 * next later start. That scan is quadratic, so it takes a one-pass shortcut
 * when the sheet's starts run forwards — and a sheet whose starts go backwards
 * somewhere must still get the scan, or it would quietly answer differently.
 * These pin both sides of that switch.
 */
describe("rowsOnAt: sheets whose start times do not run forwards", () => {
  const H3 = 3600;
  // The middle row starts an hour EARLIER than the one above it. Real sheets
  // do this — there is a whole warning kind for it — usually a typo'd am/pm.
  const outOfOrder: PlanRow[] = [
    { id: "untimed", type: "cue", durationSec: null, hardStartSec: 20 * H3 },
    { id: "backwards", type: "cue", durationSec: 60, hardStartSec: 19 * H3 },
    { id: "later", type: "cue", durationSec: 60, hardStartSec: 20 * H3 + 30 * 60 },
  ];
  const timing = computeTiming(outOfOrder, null);
  const w = win(outOfOrder);

  it("an untimed row runs to the next LATER start, skipping the backwards one", () => {
    // 19:00 is not after 20:00, so it cannot be where the 20:00 row ends;
    // the answer is 20:30. Half an hour later the row is still on.
    expect(rowsOnAt(w, timing, 20 * H3 + 15 * 60)).toContain("untimed");
  });

  it("and has ended once that later start arrives", () => {
    expect(rowsOnAt(w, timing, 20 * H3 + 31 * 60)).not.toContain("untimed");
  });
});

describe("rowsOnAt: many rows sharing one start", () => {
  const H4 = 3600;
  // The shape that made the scan quadratic: a long run of rows on the same
  // moment, each having to look past all the others to find the next start.
  const many: PlanRow[] = [
    ...Array.from({ length: 50 }, (_, i) => ({
      id: `same${i}`,
      type: "cue" as const,
      durationSec: null,
      hardStartSec: 21 * H4,
    })),
    { id: "next", type: "cue", durationSec: 60, hardStartSec: 21 * H4 + 10 * 60 },
  ];
  const timing = computeTiming(many, null);
  const w = win(many);

  it("has every one of them on, ending at the next distinct start", () => {
    const on = rowsOnAt(w, timing, 21 * H4 + 5 * 60);
    expect(on).toHaveLength(50);
    expect(on).toContain("same0");
    expect(on).toContain("same49");
  });

  it("and all of them off once it arrives", () => {
    // Half a minute into the next row: it is on, the fifty that ended when it
    // began are not. Sampled inside it rather than on its last second, because
    // a row is over AT its end — `start <= now < end`.
    expect(rowsOnAt(w, timing, 21 * H4 + 10 * 60 + 30)).toEqual(["next"]);
  });
});
