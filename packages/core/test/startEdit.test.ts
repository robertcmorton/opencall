import { describe, expect, it } from "vitest";
import { startEditRipples } from "../src/index";

const H = 3600;
const at = (h: number, m = 0) => h * H + m * 60;

/**
 * Editing a start time either moves the rest of the show or corrects one row,
 * and the two must not be confused. The bug that prompted these: correcting an
 * "am" to a "pm" is a twelve-hour change, and it was being added to every fixed
 * time below — so an 8 PM item came back as 8 AM.
 */
describe("startEditRipples", () => {
  describe("the reported bug: an AM typed for a PM", () => {
    // A bell mistyped as 5:26 AM, sitting between rows at 5:25 PM and 5:26 PM.
    const starts = [at(17, 25), at(5, 26), at(17, 26), at(17, 30)];

    it("does NOT move the rest of the sheet when the row is put right", () => {
      expect(startEditRipples(starts, 1, at(5, 26), at(17, 26))).toBe(false);
    });

    it("and does not move it when a correct row is knocked out of order either", () => {
      // 5:25 PM → 5:25 AM. Everything below stays where it is.
      expect(startEditRipples(starts, 0, at(17, 25), at(5, 25))).toBe(false);
    });
  });

  describe("the reason the ripple exists: the show is running late", () => {
    const starts = [at(19, 0), at(19, 10), at(19, 20), at(19, 40)];

    it("moves everything below when a row in order is moved, still in order", () => {
      // 19:10 → 19:15, still after 19:00 and before 19:20.
      expect(startEditRipples(starts, 1, at(19, 10), at(19, 15))).toBe(true);
    });

    it("moves them for a backwards nudge too, so long as order holds", () => {
      expect(startEditRipples(starts, 2, at(19, 20), at(19, 12))).toBe(true);
    });

    it("but not once the nudge would jump the row past its neighbour", () => {
      // 19:10 → 19:25 would put it after the 19:20 below it.
      expect(startEditRipples(starts, 1, at(19, 10), at(19, 25))).toBe(false);
    });
  });

  describe("edges", () => {
    it("a row given its first time moves nothing", () => {
      expect(startEditRipples([at(19, 0), null, at(19, 20)], 1, null, at(19, 10))).toBe(false);
    });

    it("the first and last rows are bounded only on the side that exists", () => {
      const starts = [at(19, 0), at(19, 10)];
      expect(startEditRipples(starts, 0, at(19, 0), at(18, 0))).toBe(true); // nothing above
      expect(startEditRipples(starts, 1, at(19, 10), at(23, 0))).toBe(true); // nothing below
    });

    it("rows sharing a moment are in order, not out of it", () => {
      // Concurrent rows are ordinary, so equal must not read as a violation:
      // the last of three at 20:00 can move to 20:15 with 20:30 below it.
      const starts = [at(20, 0), at(20, 0), at(20, 0), at(20, 30)];
      expect(startEditRipples(starts, 2, at(20, 0), at(20, 15))).toBe(true);
    });

    it("but nudging one of them past the others is a correction, not a shift", () => {
      // Moving the middle row to 20:15 leaves the row below it still at 20:00,
      // which is genuinely out of order — so nothing else is touched.
      const starts = [at(20, 0), at(20, 0), at(20, 0), at(20, 30)];
      expect(startEditRipples(starts, 1, at(20, 0), at(20, 15))).toBe(false);
    });

    it("skips over untimed rows when looking for the neighbours", () => {
      const starts = [at(19, 0), null, null, at(19, 10), null, at(19, 30)];
      expect(startEditRipples(starts, 3, at(19, 10), at(19, 20))).toBe(true);
      expect(startEditRipples(starts, 3, at(19, 10), at(18, 0))).toBe(false);
    });
  });
});
