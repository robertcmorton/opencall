import { describe, expect, it } from "vitest";
import { resultDueNow, type ResultDueInput } from "../src/live";

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
