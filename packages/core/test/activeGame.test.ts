import { describe, expect, it } from "vitest";
import { activeOutcomeGame, type ActiveGameInput } from "../src/live";

/**
 * A double-header: two matches, each with a block of endings.
 *
 *   0-3   game 1, the match
 *   4-6   game 1's endings   (golden, win, lose)
 *   7-10  game 2, the match
 *   11-13 game 2's endings
 */
const endingGameAt: (number | null)[] = [
  null, null, null, null, 1, 1, 1, null, null, null, null, 2, 2, 2,
];
const base: ActiveGameInput = { games: [1, 2], endingGameAt, liveIndex: 2, called: () => false };
const at = (patch: Partial<ActiveGameInput>) => activeOutcomeGame({ ...base, ...patch });

describe("which match the chooser is about", () => {
  it("asks about the match being played", () => {
    expect(at({ liveIndex: 2 })).toBe(1);
    expect(at({ liveIndex: 5 })).toBe(1);
  });

  it("moves on once the first match is settled", () => {
    expect(at({ liveIndex: 8, called: (g) => g === 1 })).toBe(2);
  });

  /**
   * The bug this was written for. Calling golden point strikes the win, lose
   * and draw rows, so the block ends at the last golden row — and the moment
   * the cue steps off it, the result of the match just played was being asked
   * about no more, ever.
   */
  it("keeps asking about a match it walked past without a result", () => {
    expect(at({ liveIndex: 7 })).toBe(1);
    expect(at({ liveIndex: 10 })).toBe(1);
  });

  // Not at the cost of the match actually on air: game 2's endings are what
  // still change what plays.
  it("gives way when the next match's endings come into view", () => {
    expect(at({ liveIndex: 11 })).toBe(2);
    expect(at({ liveIndex: 13 })).toBe(2);
  });

  it("does not linger once the result is called", () => {
    expect(at({ liveIndex: 8, called: () => true })).toBe(2);
  });

  it("has nothing to ask about on a sheet with no endings", () => {
    expect(at({ games: [] })).toBeNull();
  });

  // One match: there is never another question.
  it("stays on the only match there is", () => {
    expect(activeOutcomeGame({ games: [1], endingGameAt, liveIndex: 13, called: () => true })).toBe(1);
  });
});
