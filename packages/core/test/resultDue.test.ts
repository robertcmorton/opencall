import { describe, expect, it } from "vitest";
import { resultDueNow, buildOfferDue, type ResultDueInput } from "../src/live";

/**
 * The result chooser is a bar across the foot of a LIVE screen.
 *
 * Up for the whole second half it is just something covering rows, and the
 * showcaller stops seeing it. It appears for the last half-minute of whatever
 * runs into the decision — long enough to read three buttons and press one
 * while the siren goes and a producer talks in your ear — and not before.
 */
const base: ResultDueInput = {
  liveIndex: 3, // the second half
  firstEndingIndex: 4,
  lastExtraIndex: -1,
  extraPlaying: false,
  remainingInRowSec: 600,
  notBeforeIndex: 3,
  called: false,
  lastEndingIndex: 8, // the endings run rows 4-8
  bufferSec: 30,
};
const at = (patch: Partial<ResultDueInput>) => resultDueNow({ ...base, ...patch });

describe("when the result chooser is due", () => {
  it("stays away for the body of the half", () => {
    expect(at({ remainingInRowSec: 600 })).toBe(false);
    expect(at({ remainingInRowSec: 120 })).toBe(false);
    expect(at({ remainingInRowSec: 31 })).toBe(false);
  });

  it("arrives on the buffer, to the second", () => {
    expect(at({ remainingInRowSec: 30 })).toBe(true);
    expect(at({ remainingInRowSec: 5 })).toBe(true);
    expect(at({ remainingInRowSec: 0 })).toBe(true);
  });

  it("stays once the half runs over", () => {
    // Stoppage time, a video referee, a streaker. The siren has not gone by
    // the sheet's reckoning but the decision is closer, not further away.
    expect(at({ remainingInRowSec: -90 })).toBe(true);
  });

  it("is there if the show has reached the endings with nothing called", () => {
    // Otherwise there is no way to call the result at all.
    expect(at({ liveIndex: 4, remainingInRowSec: 600 })).toBe(true);
    expect(at({ liveIndex: 9, remainingInRowSec: 600 })).toBe(true);
  });

  it("stays after a result is called, so it can be undone", () => {
    expect(at({ called: true, liveIndex: 0, remainingInRowSec: 9999 })).toBe(true);
    // Still inside the endings: the chosen branch is on air and a wrong call
    // is still worth being able to take back.
    expect(at({ called: true, liveIndex: 6, remainingInRowSec: 10 })).toBe(true);
    expect(at({ called: true, liveIndex: 8, remainingInRowSec: 10 })).toBe(true);
  });

  // It used to stay up for the rest of the day. Once the ending it chose has
  // played out, the decision is history and the bar is a strip of a live
  // screen doing nothing.
  it("goes once the show is past the endings it chose between", () => {
    expect(at({ called: true, liveIndex: 9, remainingInRowSec: 10 })).toBe(false);
    expect(at({ called: true, liveIndex: 40, remainingInRowSec: 10 })).toBe(false);
  });

  it("stays put when the sheet cannot say where the endings finish", () => {
    expect(at({ called: true, liveIndex: 99, lastEndingIndex: -1 })).toBe(true);
  });

  it("will not ask before the period where a result is possible", () => {
    // An ad break between the second half and the endings would otherwise put
    // the chooser up at the end of the ad break — half an hour early.
    expect(at({ liveIndex: 2, notBeforeIndex: 3, remainingInRowSec: 1 })).toBe(false);
  });

  it("falls back to the buffer alone when the sheet names no period", () => {
    expect(at({ notBeforeIndex: -1, remainingInRowSec: 10 })).toBe(true);
    expect(at({ notBeforeIndex: -1, remainingInRowSec: 600 })).toBe(false);
  });

  it("does not ask on a row that is not the one running into the endings", () => {
    expect(at({ liveIndex: 1, notBeforeIndex: -1, remainingInRowSec: 1 })).toBe(false);
  });

  it("says nothing while a row with no duration is on air", () => {
    // A milestone takes no time; there is no countdown to be inside of.
    expect(at({ remainingInRowSec: null })).toBe(false);
  });
});

describe("the second question, after the extra period", () => {
  const extra = { ...base, extraPlaying: true, lastExtraIndex: 9, liveIndex: 9 };

  it("does not sit there for the whole of extra time", () => {
    expect(resultDueNow({ ...extra, remainingInRowSec: 1200 })).toBe(false);
    expect(resultDueNow({ ...extra, remainingInRowSec: 31 })).toBe(false);
  });

  it("arrives for the last half-minute of it", () => {
    expect(resultDueNow({ ...extra, remainingInRowSec: 30 })).toBe(true);
    expect(resultDueNow({ ...extra, remainingInRowSec: -10 })).toBe(true);
  });

  it("stays if the show has run past the extra period uncalled", () => {
    expect(resultDueNow({ ...extra, liveIndex: 10, remainingInRowSec: 600 })).toBe(true);
  });

  it("is not held back by the earlier rows of the extra period", () => {
    // Sitting on the break-and-reset row before the period itself.
    expect(resultDueNow({ ...extra, liveIndex: 8, remainingInRowSec: 5 })).toBe(false);
  });
});

/**
 * Golden point may end at any moment, and usually does.
 *
 * A try in the second minute ends the match with nine minutes of block still
 * printed below the cue. If the chooser waited for the last half-minute of the
 * last row — the rule for a period played out in full — the one result that
 * actually happened would be uncallable until somebody noticed and cued past
 * it, live, with a producer talking in their ear.
 */
describe("a period the first score ends", () => {
  const inExtra: ResultDueInput = {
    ...base,
    extraPlaying: true,
    firstEndingIndex: 4,
    lastExtraIndex: 9, // the block runs rows 5-9
    lastEndingIndex: 14,
    remainingInRowSec: 600,
  };

  it("keeps the chooser up for every second of golden point", () => {
    for (const liveIndex of [5, 6, 7, 8, 9])
      expect(resultDueNow({ ...inExtra, liveIndex, suddenDeathFromIndex: 5 })).toBe(true);
  });

  // The cost is a bar across the foot of the screen covering rows, which is
  // why it is not simply the rule everywhere: a score in the second minute of
  // an extra time that is PLAYED OUT settles nothing.
  it("still waits for the end when the period is played out", () => {
    for (const liveIndex of [5, 6, 7, 8])
      expect(resultDueNow({ ...inExtra, liveIndex, suddenDeathFromIndex: -1 })).toBe(false);
    expect(resultDueNow({ ...inExtra, liveIndex: 9, suddenDeathFromIndex: -1 })).toBe(false);
    expect(resultDueNow({ ...inExtra, liveIndex: 9, remainingInRowSec: 20, suddenDeathFromIndex: -1 })).toBe(true);
  });

  /**
   * A FINAL is both in one block: extra time rows 5-8 played out, then golden
   * point at row 9. The chooser must stay away for the first ten minutes and
   * be there for all of what follows.
   */
  it("splits a final between the two", () => {
    const final = { ...inExtra, suddenDeathFromIndex: 9 };
    for (const liveIndex of [5, 6, 7, 8]) expect(resultDueNow({ ...final, liveIndex })).toBe(false);
    expect(resultDueNow({ ...final, liveIndex: 9 })).toBe(true);
  });

  // Absent means the old rule, so every sheet that never asked keeps what it had.
  it("defaults to the late rule when nobody says", () => {
    expect(resultDueNow({ ...inExtra, liveIndex: 6 })).toBe(false);
  });
});

/**
 * The offer to BUILD an extra period, on a sheet with no endings written. It
 * used to sit there for the whole of the second half — measured live, four
 * and a half minutes before full time — which is the exact thing the chooser
 * above is built not to do.
 */
describe("when the offer to build an extra period is due", () => {
  const at = (liveIndex: number, remainingInRowSec: number | null) =>
    buildOfferDue({ liveIndex, decisionIndex: 16, remainingInRowSec, bufferSec: 30 });

  it("is always due on the full-time row itself", () => {
    expect(at(16, 12)).toBe(true);
    expect(at(16, null)).toBe(true);
  });

  it("stays away for the body of the half before it", () => {
    expect(at(15, 282)).toBe(false);
    expect(at(15, 31)).toBe(false);
  });

  it("arrives in the last half-minute, and stays once the half runs over", () => {
    expect(at(15, 30)).toBe(true);
    expect(at(15, 0)).toBe(true);
    expect(at(15, -40)).toBe(true);
  });

  it("is never due two rows out, or with no show", () => {
    expect(at(14, 5)).toBe(false);
    expect(at(-1, 5)).toBe(false);
  });
});
