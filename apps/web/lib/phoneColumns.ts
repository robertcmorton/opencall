/**
 * The phone layout's column widths — the SAME numbers the stylesheet forces.
 *
 * Below the breakpoint, globals.css pins the row number, the time, the
 * duration and each role column to a fixed pixel width with `!important`,
 * and hides the countdown column. The sheet's own width maths did not know:
 * it went on sharing the grid out by percentage from the wider layout's
 * numbers, so the pixels the stylesheet took off those columns went to
 * nobody — a strip of empty table down the right of every row on a phone,
 * 84px on a 694px grid, white on the light sheet. Handing the remainder to
 * the item column from CSS (`width: auto`) does not work in Chrome's fixed
 * layout; it left the column at its percentage and the strip where it was.
 *
 * So the maths uses these when the same media query matches, the shares add
 * up to the grid again, and test/phoneColumns.test.ts fails the moment the
 * stylesheet and this file disagree.
 */
export const PHONE_MEDIA = "(max-width: 760px), (max-height: 500px)";

export const COL_W_PHONE = { rownum: 32, time: 84, dur: 54, role: 42 } as const;
