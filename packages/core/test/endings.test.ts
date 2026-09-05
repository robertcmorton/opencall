import { describe, expect, it } from "vitest";
import { extraUnderWay, keepAfterResult, resultCalled, type EndingRow } from "../src/live";

const row = (id: string, index: number, outcome: string, skipped = false): EndingRow => ({ id, index, outcome, skipped });

/** A written block: full time at 9, then win / lose / golden / draw. */
const written = (skip: string[] = []) => [
  row("w1", 10, "win", skip.includes("w")), row("w2", 11, "win", skip.includes("w")),
  row("l1", 12, "lose", skip.includes("l")), row("l2", 13, "lose", skip.includes("l")),
  row("g1", 14, "golden", skip.includes("g")), row("g2", 15, "golden", skip.includes("g")), row("g3", 16, "golden", skip.includes("g")), row("g4", 17, "golden", skip.includes("g")),
  row("d1", 18, "draw", skip.includes("d")),
];
/** A built block on a sheet that wrote no endings: four golden rows and nothing else. */
const built = (skipAfter = 99) => [14, 15, 16, 17].map((i) => row(`g${i}`, i, "golden", i > skipAfter));

describe("is the extra period under way", () => {
  it("not before anything is called on a written sheet", () => {
    expect(extraUnderWay(written(), 9)).toBe(false);
  });
  it("once the results are struck, wherever the cue is", () => {
    expect(extraUnderWay(written(["w", "l", "d"]), 9)).toBe(true);
    expect(extraUnderWay(written(["w", "l", "d"]), 15)).toBe(true);
  });
  // A built block has no results to strike; the cue is the only signal.
  it("on a built block, once the show reaches it", () => {
    expect(extraUnderWay(built(), 13)).toBe(false);
    expect(extraUnderWay(built(), 14)).toBe(true);
    expect(extraUnderWay(built(), 16)).toBe(true);
  });
  it("is over once any of it has been struck", () => {
    expect(extraUnderWay(built(15), 15)).toBe(false);
  });
});

describe("which result has been called", () => {
  it("is open until one result plays and the others are struck", () => {
    expect(resultCalled(written())).toBeNull();
    expect(resultCalled(written(["w", "l", "d"]))).toBeNull(); // golden point called, not a result
    expect(resultCalled(written(["l", "d"]))).toBe("win");
  });
  it("on a built block, is only that one has been", () => {
    expect(resultCalled(built())).toBeNull();
    expect(resultCalled(built(15))).toBe("settled");
  });
});

describe("what stays in the order once a result is called", () => {
  const ids = (s: Set<string>) => [...s].sort();

  it("at the siren: the result, and none of the period", () => {
    expect(ids(keepAfterResult(written(), "win", 9))).toEqual(["w1", "w2"]);
  });

  it("calling golden point keeps the period and strikes the results", () => {
    expect(ids(keepAfterResult(written(), "golden", 9))).toEqual(["g1", "g2", "g3", "g4"]);
  });

  /**
   * THE FIRST SCORE WINS. A try in the second minute, with the cue on the
   * first half of golden point: the half that was being played stays, the
   * change of ends and the second half never happen.
   */
  it("mid-period: keeps what was played, strikes what never will be", () => {
    const playing = written(["w", "l", "d"]);
    expect(ids(keepAfterResult(playing, "win", 15))).toEqual(["g1", "g2", "w1", "w2"]);
    expect(ids(keepAfterResult(playing, "lose", 14))).toEqual(["g1", "l1", "l2"]);
  });

  it("after the period ran its length, all of it stays", () => {
    expect(ids(keepAfterResult(written(["w", "l", "d"]), "draw", 17))).toEqual(["d1", "g1", "g2", "g3", "g4"]);
    expect(ids(keepAfterResult(written(["w", "l", "d"]), "draw", 40))).toEqual(["d1", "g1", "g2", "g3", "g4"]);
  });

  it("does the same on a built block, which has nothing else to keep", () => {
    expect(ids(keepAfterResult(built(), "win", 15))).toEqual(["g14", "g15"]);
    expect(ids(keepAfterResult(built(), "win", 13))).toEqual([]);
  });
});

// ── The order every real sheet uses: results written ABOVE the extra period ──
import { endingBehindCue, keepAfterResult as keepAfter, resultCalled as called, type EndingRow as ER } from "../src/live";

const realSheet = (skipped: Partial<Record<string, boolean>> = {}): ER[] => {
  const mk = (id: string, index: number, outcome: string): ER => ({ id, index, outcome, skipped: !!skipped[id] });
  return [
    mk("win1", 2, "win"),
    mk("win2", 3, "win"),
    mk("lose1", 4, "lose"),
    mk("gp1", 5, "golden"), // holding
    mk("gp2", 6, "golden"), // first half
    mk("gp3", 7, "golden"), // change ends
    mk("gp4", 8, "golden"), // second half
    mk("draw1", 9, "draw"),
  ];
};
const applied = (rows: ER[], keep: Set<string>): ER[] => rows.map((r) => ({ ...r, skipped: !keep.has(r.id) }));

describe("results written above the golden block (the real-sheet order)", () => {
  it("at full time, Win keeps the win rows and strikes the whole extra period; the branch is still ahead", () => {
    const rows = realSheet();
    const after = applied(rows, keepAfter(rows, "win", 1));
    expect(after.filter((r) => !r.skipped).map((r) => r.id)).toEqual(["win1", "win2"]);
    expect(endingBehindCue(after, 1)).toEqual([]);
  });

  it("golden point called, then Win in the second half: the played golden rows stay and the win rows are BEHIND the cue", () => {
    // Golden called = the three results struck; the cue has reached the second half (index 8).
    const golden = realSheet({ win1: true, win2: true, lose1: true, draw1: true });
    const after = applied(golden, keepAfter(golden, "win", 8));
    expect(after.filter((r) => !r.skipped).map((r) => r.id)).toEqual(["win1", "win2", "gp1", "gp2", "gp3", "gp4"]);
    expect(called(after)).toBe("win");
    // The transport cannot reach these: they are above the cue.
    expect(endingBehindCue(after, 8).map((r) => r.id)).toEqual(["win1", "win2"]);
  });

  it("a try in the first half ends it there: the rest of the period is struck, the played part stays", () => {
    const golden = realSheet({ win1: true, win2: true, lose1: true, draw1: true });
    const after = applied(golden, keepAfter(golden, "win", 6));
    expect(after.filter((r) => !r.skipped).map((r) => r.id)).toEqual(["win1", "win2", "gp1", "gp2"]);
  });

  it("pressing the same result a second time changes nothing — the played golden rows do not vanish", () => {
    const golden = realSheet({ win1: true, win2: true, lose1: true, draw1: true });
    const first = applied(golden, keepAfter(golden, "win", 8));
    const second = applied(first, keepAfter(first, "win", 8));
    expect(second).toEqual(first);
  });

  it("changing the call after golden point swaps the branch and keeps what was played", () => {
    const golden = realSheet({ win1: true, win2: true, lose1: true, draw1: true });
    const first = applied(golden, keepAfter(golden, "win", 8));
    const swapped = applied(first, keepAfter(first, "lose", 8));
    expect(swapped.filter((r) => !r.skipped).map((r) => r.id)).toEqual(["lose1", "gp1", "gp2", "gp3", "gp4"]);
    expect(endingBehindCue(swapped, 8).map((r) => r.id)).toEqual(["lose1"]);
  });

  it("nothing is behind the cue while nothing has been called", () => {
    expect(endingBehindCue(realSheet(), 8)).toEqual([]);
  });
});
