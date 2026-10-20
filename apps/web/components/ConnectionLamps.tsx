"use client";

import { useEffect, useRef } from "react";

export type LampState = "ok" | "pending" | "offline" | "connecting";

/**
 * Two lights, top right: Sheet and Show (20 Oct, Robert's pick — they were
 * replaced by "✓ Saved" on 6 Oct and he missed them).
 *
 *  · Sheet — the run sheet's link: green when every change is saved and
 *    shared, amber while one is on its way, red when offline.
 *  · Show  — the live link that carries Start, Next and the clock: green when
 *    up, red when it has dropped.
 *
 * Each gives a soft flash when data comes in on its link, so a green light is
 * seen to be alive, not just connected. Colour is never the only signal: the
 * page puts words beside them whenever something is wrong.
 */
export function ConnectionLamps({
  sheet,
  show,
  sheetTip,
  showTip,
  onSheetActivity,
  onShowActivity,
}: {
  sheet: LampState;
  /** Null hides the Show light (a page with no live link). */
  show: LampState | null;
  sheetTip: string;
  showTip: string;
  /** Subscribe to "data arrived"; returns the unsubscribe. */
  onSheetActivity?: (fn: () => void) => () => void;
  onShowActivity?: (fn: () => void) => () => void;
}) {
  return (
    <span className="conn-lamps" role="status" aria-label={`Sheet ${words(sheet)}${show ? `, show ${words(show)}` : ""}`}>
      <Lamp label="Sheet" state={sheet} tip={sheetTip} subscribe={onSheetActivity} />
      {show && <Lamp label="Show" state={show} tip={showTip} subscribe={onShowActivity} />}
    </span>
  );
}

const words = (s: LampState) => (s === "ok" ? "connected" : s === "pending" ? "saving" : s === "offline" ? "offline" : "connecting");

function Lamp({ label, state, tip, subscribe }: { label: string; state: LampState; tip: string; subscribe?: (fn: () => void) => () => void }) {
  const dot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!subscribe) return;
    let last = 0;
    return subscribe(() => {
      const el = dot.current;
      const now = performance.now();
      // A burst of updates (a paste, a reconnect) is one flash, not a strobe.
      if (!el || now - last < 400) return;
      last = now;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
      // The Web Animations API: no re-render of the sheet for a blink.
      el.animate(
        [
          { transform: "scale(1.6)", filter: "brightness(1.7)", boxShadow: "0 0 0 3px color-mix(in srgb, currentColor 35%, transparent)" },
          { transform: "scale(1)", filter: "brightness(1)", boxShadow: "0 0 0 0 transparent" },
        ],
        { duration: 450, easing: "ease-out" },
      );
    });
  }, [subscribe]);
  return (
    <span className={`conn-lamp is-${state}`} data-tip={tip}>
      <span ref={dot} className="conn-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
