"use client";

import { useEffect } from "react";

import { keepTipsOnScreen } from "../lib/keepTipsOnScreen";

/**
 * App-wide: keeps tooltips on screen. (It used to block pinch-zoom on every
 * page too; since 6 Oct zoom is allowed and only `useZoomLock` blocks it.)
 */
export function ViewportLock() {
  // Tooltips are pseudo-elements and CSS cannot see the edge of the screen;
  // one listener for the whole app nudges any that would run off it.
  useEffect(() => keepTipsOnScreen(), []);
  return null;
}

/**
 * No pinch-zoom while `active` — the show page during a live show only.
 *
 * A stray pinch on the showcaller's phone or tablet mid-show can leave the
 * console zoomed into a corner with no obvious way back. Everywhere else, and
 * here before and after the show, zoom is allowed: people who need bigger
 * text use it (WCAG 1.4.4).
 *
 * Two parts, because iOS Safari ignores `user-scalable=no`: the viewport meta
 * for every other browser, and refusing Safari's own pinch (`gesture*`)
 * events. Double-tap zoom is `touch-action: manipulation` in CSS, not here —
 * cancelling `touchend` would also cancel the double-tap that opens a cell.
 */
export function useZoomLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    const before = meta?.content ?? null;
    if (meta) meta.content = `${before ?? "width=device-width, initial-scale=1"}, maximum-scale=1, user-scalable=no`;
    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stop);
    document.addEventListener("gesturechange", stop);
    document.addEventListener("gestureend", stop);
    return () => {
      if (meta && before != null) meta.content = before;
      document.removeEventListener("gesturestart", stop);
      document.removeEventListener("gesturechange", stop);
      document.removeEventListener("gestureend", stop);
    };
  }, [active]);
}
