"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * The right-click menu on a row, as a spreadsheet has one.
 *
 * Opens where the mouse is and stays on screen (flipped up or left near an
 * edge). Escape, a click anywhere else, scrolling by hand or choosing an
 * item closes it. An item can keep it open — Start show asks again in place
 * when the sheet has something worth a look first.
 */

export type RowMenuEntry =
  | { heading: string }
  | "sep"
  | {
      label: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** A short line under the label. */
      hint?: ReactNode;
      keepOpen?: boolean;
      tone?: "positive" | "warn";
    };

export function RowMenu({ x, y, entries, onClose }: { x: number; y: number; entries: RowMenuEntry[]; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    setAt({
      left: x + r.width + gap > window.innerWidth ? Math.max(gap, x - r.width) : x,
      top: y + r.height + gap > window.innerHeight ? Math.max(gap, window.innerHeight - r.height - gap) : y,
    });
  }, [x, y, entries.length]);

  useEffect(() => {
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    // A person scrolling closes it; the sheet scrolling itself (following
    // the walkthrough, a row coming into view) must not, or it vanished
    // under the pointer before an item could be chosen.
    const away = () => onClose();
    const wheel = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key);
    window.addEventListener("wheel", wheel, true);
    window.addEventListener("touchmove", wheel, true);
    window.addEventListener("resize", away);
    window.addEventListener("blur", away);
    return () => {
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", key);
      window.removeEventListener("wheel", wheel, true);
      window.removeEventListener("touchmove", wheel, true);
      window.removeEventListener("resize", away);
      window.removeEventListener("blur", away);
    };
  }, [onClose]);

  // The first item takes the keyboard, so arrows and Enter work at once.
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, []);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={box}
      className="row-menu no-print"
      role="menu"
      style={{ left: at.left, top: at.top }}
      onKeyDown={move}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry === "sep") return <div key={i} className="menu-sep" role="separator" />;
        if ("heading" in entry)
          return (
            <div key={i} className="row-menu-heading">
              {entry.heading}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role="menuitem"
            className={`row-menu-item ${entry.danger ? "is-danger" : ""} ${entry.tone ? `is-${entry.tone}` : ""}`}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              if (!entry.keepOpen) onClose();
            }}
          >
            <span>{entry.label}</span>
            {entry.hint && <span className="row-menu-hint">{entry.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
