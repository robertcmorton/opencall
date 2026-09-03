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
