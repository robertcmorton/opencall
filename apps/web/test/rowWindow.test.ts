import { describe, expect, it } from "vitest";
import { viewIsStale } from "../lib/useRowWindow";

/**
 * The window only knows where it is when something tells it, and when nothing
 * does the failure is total: it renders the rows for the wrong place, puts them
 * outside the viewport, and the sheet appears EMPTY — headers, the period rail,
 * and no rows. Seen on 2 September on a 2,114-row sheet on production, where a
 * fresh load of a running show drew a blank grid while the DOM held the rows
 * from the top of the sheet and the scroller sat near the bottom.
 *
 * So the window checks itself after every render. This is the check.
 */
describe("noticing the scroller moved without us", () => {
  const view = { top: 68_000, height: 900 };

  it("says nothing when the two agree", () => {
    expect(viewIsStale(68_000, 900, view)).toBe(false);
  });

  // The failure that matters: the sheet scrolled itself to the cue and the
  // window is still measuring from the top.
  it("catches a window left at the top of a scrolled sheet", () => {
    expect(viewIsStale(68_000, 900, { top: 0, height: 900 })).toBe(true);
  });

  it("catches the viewport changing size on its own", () => {
    expect(viewIsStale(68_000, 500, view)).toBe(true);
  });

  /**
   * Sub-pixel scroll positions are ordinary — trackpads, browser zoom,
   * fractional device pixels. Comparing exactly would report stale on every
   * render forever, and since reporting stale sets state, that is an infinite
   * render loop rather than a slow one.
   */
  it("ignores sub-pixel drift, which would otherwise never stop", () => {
    expect(viewIsStale(68_000.4, 900.3, view)).toBe(false);
    expect(viewIsStale(68_000.9, 900, view)).toBe(false);
    expect(viewIsStale(68_002, 900, view)).toBe(true);
  });
});
