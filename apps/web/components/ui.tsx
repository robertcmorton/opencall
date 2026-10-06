"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatTimeOfDay, zoneAbbreviation, zoneSecondsOfDay } from "@opencall/core";

/** Close on outside pointerdown or Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** Toolbar button that opens a dropdown menu. */
export function Dropdown({
  label,
  children,
  align = "left",
  className = "btn",
  ariaLabel,
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
  /** For an icon-only trigger (the ⋯ menus): what a screen reader calls it. */
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * Keep the menu on the screen.
   *
   * It is anchored to one side of its button, which is a decision made before
   * anything knows how wide the menu is or where the button ended up. On a row
   * whose ⋯ sits near the right edge that put half the items past the window,
   * and the items that fell off were the ones a menu keeps for last — rename,
   * archive, delete.
   *
   * Measured after opening and nudged back by however much it overhangs, which
   * needs no flipping rules and cannot pick the wrong side. Re-measured on
   * resize because a menu can be open across one.
   *
   * BEFORE THE PAINT, not after it. As a passive effect this ran once the
   * browser had already drawn the menu where the CSS put it — below the button
   * and unclamped — so for one frame the page contained something hanging off
   * the bottom of it, and the page grew a scrollbar to reach it. The clamp
   * landed a frame later and the scrollbar went away again: a flicker on every
   * single menu opening, worst on the import screen where the ⋯ sits low in a
   * tall panel. A layout effect runs after the DOM is updated and before
   * anything is drawn, so the first frame anybody sees is the placed one.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = menuRef.current;
      const wrap = ref.current;
      if (!el || !wrap) return;
      const pad = 8;
      const w = wrap.getBoundingClientRect();
      // Measured from the BUTTON and the menu's layout box, never from the
      // menu's own rect: it opens with an animation that moves `transform`,
      // so a rect read while that is running is 4px out AND the animation
      // overrides any transform written back. Position wins where transform
      // would have been fought over.
      const mw = el.offsetWidth;
      const mh = el.offsetHeight;

      // The PAGE's box, not the window's.
      //
      // `window.innerWidth` counts the gutter a scrollbar will sit in, so
      // clamping to it puts the menu in space that stops existing the moment
      // one appears — and then the two axes feed each other. Measured on the
      // admin dashboard: the menu landed 7px past the content box, which
      // raised a horizontal scrollbar; that bar took 15px of height, which
      // pushed the body past the viewport and raised a vertical one; that took
      // 15px of width, moving the menu further out again. Both bars on a page
      // that fits, from a menu that was told the window was wider than the
      // page.
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      let x = align === "left" ? w.left : w.right - mw;
      x = Math.max(pad, Math.min(x, vw - pad - mw));

      let y = w.bottom + 5;
      if (y + mh > vh - pad) {
        // Hang it above the button when there is room; otherwise sit it as low
        // as it fits. Never push the top off — losing the first item is no
        // better than losing the last.
        const above = w.top - 5 - mh;
        y = above > pad ? above : Math.max(pad, vh - pad - mh);
      }

      el.style.left = `${Math.round(x - w.left)}px`;
      el.style.right = "auto";
      el.style.top = `${Math.round(y - w.top)}px`;
    };
    place();
    // The menu's height settles after its first paint (and can change if its
    // contents do), so re-place on both.
    const raf = requestAnimationFrame(place);
    const ro = new ResizeObserver(place);
    if (menuRef.current) ro.observe(menuRef.current);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open, align, ref]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" aria-label={ariaLabel} aria-expanded={open} className={`${className} ${open ? "is-on" : ""}`} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          className="menu"
          style={{ top: "calc(100% + 5px)", [align]: 0 } as React.CSSProperties}
          onClick={(e) => {
            // Menu links/buttons close the menu unless flagged to keep it open.
            if ((e.target as HTMLElement).closest("[data-keep-open]")) return;
            setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Ticking clock for surface headers — always the EVENT's wall clock (its
 * location's timezone, DST-aware), never the viewer's device time.
 */
export function HeaderClock({ use24h, timeZone }: { use24h: boolean; timeZone?: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Math.floor(zoneSecondsOfDay(Date.now(), timeZone)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeZone]);
  const abbr = timeZone ? zoneAbbreviation(timeZone) : "";
  return (
    <div className="header-clock-block">
      {/* "Time of day", not "event time". The clock reads the EVENT's timezone,
          which is the whole point of it — but "event time" invited the reading
          "the time the event starts", next to a readout that is the time right
          now. The zone is still named beside it, so what it is measuring is
          not in doubt. */}
      <div className="header-label">Time of day{abbr ? ` · ${abbr}` : ""}</div>
      <div className="header-clock mono">{now != null ? formatTimeOfDay(now, use24h) : "--:--:--"}</div>
    </div>
  );
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** The favicon's mark — a tiny rundown with its live row and go dot. */
/**
 * The product's name, in ONE place.
 *
 * It appears in the sidebar, the landing page, the dashboard, both exports,
 * the diagnostics line and the PWA manifest. Spelt out at each of those it is
 * eight edits and a missed one; here it is a single line, which is what makes
 * a change of name a decision rather than a project.
 */
export const BRAND = { first: "Open", second: "Call" } as const;
export const BRAND_NAME = `${BRAND.first}${BRAND.second}`;

/**
 * The name set as a logotype rather than left as running text.
 *
 * It reads as a set with the mark and the app icons: the same accent blue as
 * the live row in the mark, the weight split across the two halves so the
 * word has a stress, and the tracking pulled in so it sits as one shape.
 */
export function BrandWordmark({ size = 20, mark = true }: { size?: number; mark?: boolean }) {
  return (
    <span className="brand-wordmark" style={{ fontSize: size }}>
      {mark && <BrandMark size={Math.round(size * 1.05)} />}
      <span className="bw-text">
        <span className="bw-first">{BRAND.first}</span>
        <span className="bw-second">{BRAND.second}</span>
      </span>
    </span>
  );
}

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden style={{ flexShrink: 0 }}>
      <rect width="96" height="96" rx="18" fill="var(--raised)" />
      <rect x="16" y="20" width="64" height="10" rx="3" fill="var(--warn)" opacity="0.55" />
      <rect x="16" y="36" width="64" height="10" rx="3" fill="var(--accent)" />
      <rect x="16" y="52" width="64" height="10" rx="3" fill="var(--border)" />
      <rect x="16" y="68" width="40" height="10" rx="3" fill="var(--border)" />
      <circle cx="72" cy="73" r="9" fill="var(--under)" />
    </svg>
  );
}

export const Icon = {
  /** Three bars. The one shape everybody reads as "there is a menu here". */
  menu: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 4h11M2.5 8h11M2.5 12h11" {...stroke} strokeWidth={1.7} />
    </svg>
  ),
  close: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" {...stroke} strokeWidth={1.7} />
    </svg>
  ),
  /** A pen, nib down: the Ink control on the run sheet. */
  pen: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M10.5 2.5l3 3L6 13l-3.5 1 1-3.5z" {...stroke} strokeWidth={1.5} />
      <path d="M9 4l3 3" {...stroke} strokeWidth={1.5} />
    </svg>
  ),
  /** A block eraser, tilted, over the line it is rubbing out. */
  eraser: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M9.8 2.7l3.5 3.5L8 11.5H4.8L2.7 9.4z" {...stroke} strokeWidth={1.5} />
      <path d="M6.6 5.9l3.5 3.5M4.5 13.7h9" {...stroke} strokeWidth={1.5} />
    </svg>
  ),
  play: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <path d="M4 2.5v11l9-5.5z" fill="currentColor" />
    </svg>
  ),
  pause: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <path d="M4.5 2.5v11M11.5 2.5v11" {...stroke} strokeWidth={2.6} />
    </svg>
  ),
  prev: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <path d="M12.5 2.5v11l-8-5.5z" fill="currentColor" />
      <path d="M3 2.5v11" {...stroke} strokeWidth={2.2} />
    </svg>
  ),
  next: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <path d="M3.5 2.5v11l8-5.5z" fill="currentColor" />
      <path d="M13 2.5v11" {...stroke} strokeWidth={2.2} />
    </svg>
  ),
  stop: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <rect x="3" y="3" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  ),
  plus: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <path d="M8 3v10M3 8h10" {...stroke} strokeWidth={2} />
    </svg>
  ),
  columns: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <rect x="2" y="3" width="12" height="10" rx="1.5" {...stroke} />
      <path d="M6.5 3v10M10.5 3v10" {...stroke} />
    </svg>
  ),
  dots: (
    <svg width="13" height="13" viewBox="0 0 16 16">
      <circle cx="3" cy="8" r="1.4" fill="currentColor" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" />
      <circle cx="13" cy="8" r="1.4" fill="currentColor" />
    </svg>
  ),
  check: (
    <svg width="12" height="12" viewBox="0 0 16 16">
      <path d="M2.5 8.5l3.5 3.5 7.5-8" {...stroke} strokeWidth={2} />
    </svg>
  ),
  /*
   * Added 6 Oct to replace the loose symbols (↺ ↻ ✎ ⚠ ⇣ ▤ ▾ ← ↑ 🔗 ⌫) that
   * sat on buttons in whatever shape each font drew them — one set, one
   * weight, one size, so the app reads as one thing.
   */
  undo: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M5.5 3.5L2.5 6.5l3 3" {...stroke} />
      <path d="M2.5 6.5h7a4 4 0 010 8h-2" {...stroke} />
    </svg>
  ),
  redo: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M10.5 3.5l3 3-3 3" {...stroke} />
      <path d="M13.5 6.5h-7a4 4 0 000 8h2" {...stroke} />
    </svg>
  ),
  /** A pencil: changing the sheet, writing a note. */
  edit: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M11 2.5l2.5 2.5L5.5 13H3v-2.5z" {...stroke} strokeWidth={1.5} />
    </svg>
  ),
  /** A speech bubble: notes the crew raise against a row. */
  note: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M2.5 3.5h11v7.5h-6l-3 2.5V11h-2z" {...stroke} strokeWidth={1.5} />
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.2L14.2 13H1.8z" {...stroke} strokeWidth={1.5} />
      <path d="M8 6.5v3" {...stroke} strokeWidth={1.6} />
      <circle cx="8" cy="11.3" r="0.9" fill="currentColor" />
    </svg>
  ),
  /** Lines of text on a page: the prompter. */
  prompter: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <rect x="2.5" y="2" width="11" height="12" rx="1.5" {...stroke} strokeWidth={1.5} />
      <path d="M5 5.5h6M5 8h6M5 10.5h4" {...stroke} strokeWidth={1.5} />
    </svg>
  ),
  /** Down to the live row — "follow the show". */
  follow: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 2.5v8M4.5 7l3.5 3.5L11.5 7M3.5 13.5h9" {...stroke} />
    </svg>
  ),
  arrowLeft: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M13 8H3.5M7.5 4L3.5 8l4 4" {...stroke} />
    </svg>
  ),
  arrowUp: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M8 13V3.5M4 7.5l4-4 4 4" {...stroke} />
    </svg>
  ),
  chevronDown: (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 6l4.5 4.5L12.5 6" {...stroke} strokeWidth={2} />
    </svg>
  ),
  chevronRight: (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
      <path d="M6 3.5l4.5 4.5L6 12.5" {...stroke} strokeWidth={2} />
    </svg>
  ),
  link: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M6.8 9.2a3 3 0 004.2 0l2-2a3 3 0 00-4.2-4.2l-.9.9" {...stroke} strokeWidth={1.5} />
      <path d="M9.2 6.8a3 3 0 00-4.2 0l-2 2a3 3 0 004.2 4.2l.9-.9" {...stroke} strokeWidth={1.5} />
    </svg>
  ),
  /** A T with a stroke through it: take the formatting off. */
  clearFormat: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <path d="M3.5 3.5h9M8 3.5V13" {...stroke} strokeWidth={1.5} />
      <path d="M2.5 13.5l11-11" {...stroke} strokeWidth={1.3} />
    </svg>
  ),
};

/**
 * What is still missing, said before anyone presses the button.
 *
 * A form that refuses silently is indistinguishable from one that is broken,
 * and a form that lets a half-filled thing through leaves the gap for someone
 * to find at a venue. Every field is named, so the fix is obvious without
 * hunting the form for the empty one.
 */
export function MissingFields({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <div className="missing-fields" role="alert">
      <strong>Still needed</strong>
      <ul>
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
    </div>
  );
}
