"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Render only the rows near the viewport.
 *
 * A long sheet puts every row in the page: 3,321 rows became 19,926 cells and
 * 37,122 DOM nodes, of which 24 were on screen. React reconciled all of it on
 * every render, ~196ms a time in production, and the console sat at 43% of the
 * main thread while nobody touched it. Cutting how OFTEN that happened got it
 * from 75% to 43%; nothing but cutting how MUCH is rendered will finish the
 * job.
 *
 * So a window of rows is rendered — the ones on screen plus a buffer either
 * side so scrolling never shows a blank — and the rest are represented by two
 * empty rows whose heights stand in for them. The scrollbar is unchanged
 * because the total height is unchanged.
 *
 * HEIGHTS ARE MEASURED, NOT ASSUMED. A cue sheet's rows are not uniform: the
 * notes column wraps to three lines on one row and none on the next, and a
 * guess would make the scrollbar jump under the thumb of somebody calling a
 * show. Every row that renders reports its height; rows never yet seen use the
 * average of those that have. The estimate is therefore wrong only for rows
 * nobody has looked at, and corrects itself the moment they scroll into view.
 *
 * The prefix sum is rebuilt by walking the array on each scroll. For a few
 * thousand rows that is microseconds — a real cost would be worth a Fenwick
 * tree, and this is not one.
 */
export interface RowWindow {
  /** First row index to render. */
  from: number;
  /** One past the last row index to render. */
  to: number;
  /** Pixels of empty space standing in for the rows before `from`. */
  padTop: number;
  /** Pixels of empty space standing in for the rows after `to`. */
  padBottom: number;
  /** Called after each render with the rows that actually drew, to learn their heights. */
  report: (heights: Map<number, number>) => void;
  /** True when the window is actually narrowing what renders. */
  active: boolean;
  /**
   * Where a row sits from the top of the table, whether or not it is rendered.
   *
   * This is what makes following the cue possible at all under a window. The
   * follow used to look up `tr.active-row` and centre the element it found —
   * and when the cue moved outside the rendered slice there WAS no element, so
   * it retried twenty times and gave up. The sheet kept perfect time and
   * simply stopped showing where it was. Scrolling to the offset brings the
   * row into the window, after which the element exists and can be centred
   * exactly.
   */
  offsetOf: (index: number) => number;
}

export function useRowWindow({
  count,
  scrollEl,
  enabled,
  overscanPx = 600,
  estimate = 34,
}: {
  count: number;
  scrollEl: HTMLElement | null;
  enabled: boolean;
  /** How far beyond the viewport to keep rendered, so a flick never shows blank. */
  overscanPx?: number;
  /** Starting guess for a row's height, until one has been measured. */
  estimate?: number;
}): RowWindow {
  const heights = useRef<number[]>([]);
  const measuredCount = useRef(0);
  const measuredTotal = useRef(0);
  const [, bump] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });

  const avg = measuredCount.current > 0 ? measuredTotal.current / measuredCount.current : estimate;

  /** Row offsets from the top of the table, using measured heights where known. */
  const offsets = useMemo(() => {
    const out = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) out[i + 1] = out[i]! + (heights.current[i] ?? avg);
    return out;
    // `view` is in the deps on purpose: a scroll is also when newly measured
    // heights should be folded in.
  }, [count, avg, view]);

  useEffect(() => {
    if (!scrollEl || !enabled) return;
    const read = () => setView({ top: scrollEl.scrollTop, height: scrollEl.clientHeight });
    read();
    scrollEl.addEventListener("scroll", read, { passive: true });
    const ro = new ResizeObserver(read);
    ro.observe(scrollEl);
    return () => {
      scrollEl.removeEventListener("scroll", read);
      ro.disconnect();
    };
  }, [scrollEl, enabled]);

  /**
   * Printing renders the whole sheet.
   *
   * A printed run sheet with sixty of its rows on it is not a run sheet. The
   * window is dropped for the duration and restored afterwards.
   */
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const on = () => setPrinting(true);
    const off = () => setPrinting(false);
    window.addEventListener("beforeprint", on);
    window.addEventListener("afterprint", off);
    return () => {
      window.removeEventListener("beforeprint", on);
      window.removeEventListener("afterprint", off);
    };
  }, []);

  const report = useCallback((seen: Map<number, number>) => {
    let changed = false;
    for (const [i, h] of seen) {
      const had = heights.current[i];
      if (had != null && Math.abs(had - h) < 0.5) continue;
      if (had == null) {
        measuredCount.current += 1;
        measuredTotal.current += h;
      } else {
        measuredTotal.current += h - had;
      }
      heights.current[i] = h;
      changed = true;
    }
    // Only re-render when a height actually moved, or this loops forever:
    // measuring causes a render, which measures again.
    if (changed) bump((n) => n + 1);
  }, []);

  const offsetOf = (index: number) => offsets[Math.max(0, Math.min(index, count))] ?? 0;

  const active = enabled && !printing && count > 0;
  if (!active) return { from: 0, to: count, padTop: 0, padBottom: 0, report, active: false, offsetOf };

  const first = view.top - overscanPx;
  const last = view.top + (view.height || 800) + overscanPx;
  let from = 0;
  while (from < count && offsets[from + 1]! < first) from += 1;
  let to = from;
  while (to < count && offsets[to]! <= last) to += 1;

  return {
    from,
    to: Math.max(to, from + 1),
    padTop: offsets[from]!,
    padBottom: Math.max(0, offsets[count]! - offsets[Math.max(to, from + 1)]!),
    report,
    active: true,
    offsetOf,
  };
}
