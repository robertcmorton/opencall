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
  /** A line of colour swatches — the row highlights. */
  | { swatches: { key: string; label: string; css: string | null; on?: boolean; onSelect: () => void }[] }
  /** A quiet line of explanation. */
  | { note: ReactNode }
  | {
      label: ReactNode;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      /** A short line under the label. */
      hint?: ReactNode;
      /** Ticked: what the selection already is. */
      checked?: boolean;
      /** Set in from the left — the choices under an item that opened them. */
      indent?: boolean;
      keepOpen?: boolean;
      tone?: "positive" | "warn";
    };

export function RowMenu({
  x,
  y,
  entries,
  onClose,
  touch = false,
  sheet = false,
}: {
  x: number;
  y: number;
  entries: RowMenuEntry[];
  onClose: () => void;
  /** Opened by a finger: targets a finger can hit (44px, Apple's minimum). */
  touch?: boolean;
  /** On a phone: a panel up from the bottom, full width, where the thumb is. */
  sheet?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || sheet) return;
    const r = el.getBoundingClientRect();
    const gap = 8;
    setAt({
      left: x + r.width + gap > window.innerWidth ? Math.max(gap, x - r.width) : x,
      top: y + r.height + gap > window.innerHeight ? Math.max(gap, window.innerHeight - r.height - gap) : y,
    });
  }, [x, y, entries.length, sheet]);

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

  // Closing hands the keyboard back to wherever it was — a keyboard user
  // must not be dropped at the top of the page.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    return () => {
      if (before && before !== document.body && before.isConnected) before.focus({ preventScroll: true });
    };
  }, []);

  // The first item takes the keyboard, so arrows and Enter work at once.
  // Not for a finger: there is no keyboard, and a focus ring on the first
  // item reads as "already chosen".
  useEffect(() => {
    if (!touch) box.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [touch]);

  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <>
    {/* Behind a phone's sheet, so the sheet reads as on top and a tap above
        it closes it rather than landing on the row underneath. */}
    {sheet && <div className="row-menu-backdrop no-print" aria-hidden />}
    <div
      ref={box}
      className={`row-menu no-print ${touch ? "is-touch" : ""} ${sheet ? "is-sheet" : ""}`}
      role="menu"
      style={sheet ? undefined : { left: at.left, top: at.top }}
      onKeyDown={move}
      onContextMenu={(e) => e.preventDefault()}
    >
      {entries.map((entry, i) => {
        if (entry === "sep") return <div key={i} className="menu-sep" role="separator" />;
        if ("swatches" in entry)
          return (
            <div key={i} className="row-menu-swatches" role="group" aria-label="Colour">
              {entry.swatches.map((sw) => (
                <button
                  key={sw.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={!!sw.on}
                  className={`color-swatch ${sw.css == null ? "color-swatch-none" : ""} ${sw.on ? "is-on" : ""}`}
                  style={sw.css ? { background: sw.css } : undefined}
                  data-tip={sw.label}
                  aria-label={sw.label}
                  onClick={() => {
                    sw.onSelect();
                    onClose();
                  }}
                />
              ))}
            </div>
          );
        if ("note" in entry)
          return (
            <div key={i} className="row-menu-note" role="note">
              {entry.note}
            </div>
          );
        if ("heading" in entry)
          return (
            <div key={i} className="row-menu-heading" role="presentation">
              {entry.heading}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role={entry.checked != null ? "menuitemradio" : "menuitem"}
            className={`row-menu-item ${entry.danger ? "is-danger" : ""} ${entry.tone ? `is-${entry.tone}` : ""} ${entry.indent ? "is-indent" : ""}`}
            aria-checked={entry.checked}
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              if (!entry.keepOpen) onClose();
            }}
          >
            <span>
              {entry.checked != null && <span className="row-menu-check">{entry.checked ? "✓" : ""}</span>}
              {entry.label}
            </span>
            {entry.hint && <span className="row-menu-hint">{entry.hint}</span>}
          </button>
        );
      })}
      {sheet && (
        <button type="button" className="row-menu-item row-menu-cancel" onClick={onClose}>
          Cancel
        </button>
      )}
    </div>
    </>
  );
}
