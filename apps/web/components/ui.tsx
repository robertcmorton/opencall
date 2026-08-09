"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
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
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className={`${className} ${open ? "is-on" : ""}`} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div
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
    <div style={{ textAlign: "right" }}>
      <div className="header-label">Event time{abbr ? ` · ${abbr}` : ""}</div>
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
};
