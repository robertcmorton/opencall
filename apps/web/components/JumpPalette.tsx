"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface JumpItem {
  id: string;
  /** The row's number as the sheet shows it ("12", "4a"), or "" for a heading. */
  number: string;
  title: string;
  /** Start time as shown, or null. */
  start: string | null;
  /** Every other cell's text, searched but not shown. */
  text: string;
}

/** Something to DO from the jump box (6 Oct): "start", "prompter", "add row". */
export interface JumpAction {
  id: string;
  label: string;
  /** Other words people might type for it. */
  keywords?: string;
  run: () => void;
}

const MAX = 30;

/**
 * Jump to a row: Cmd/Ctrl+K, type a number or words, Enter.
 *
 * A long sheet scrolls past the eye; during a show the caller knows "row 47"
 * or "the anthem" and should be there in two keystrokes rather than a
 * scrolling hunt. A number matches the row's number first (exactly, then
 * starting with it); words match the title first, then any cell.
 */
export function JumpPalette({
  items,
  actions = [],
  onJump,
  onClose,
}: {
  items: JumpItem[];
  /** Only the ones this person may do, here and now. */
  actions?: JumpAction[];
  onJump: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => input.current?.focus(), []);

  // Actions first: a word like "start" is far more likely to mean the action
  // than a row with "start" somewhere in its notes. A number never matches an
  // action, so "47" still goes straight to row 47.
  const actionHits = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return actions.slice(0, 6);
    if (/^\d/.test(query)) return [];
    const words = query.split(/\s+/);
    return actions.filter((a) => {
      const hay = `${a.label} ${a.keywords ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [q, actions]);

  const rowResults = useMemo(() => {
    const query = q.trim().toLowerCase();
    if (!query) return items.slice(0, MAX);
    const words = query.split(/\s+/);
    const scored: { item: JumpItem; score: number }[] = [];
    for (const item of items) {
      const num = item.number.toLowerCase();
      const title = item.title.toLowerCase();
      let score = 0;
      if (num && num === query) score = 100;
      else if (num && /^\d/.test(query) && num.startsWith(query)) score = 80;
      else if (words.every((w) => title.includes(w))) score = title.startsWith(query) ? 60 : 50;
      else if (words.every((w) => title.includes(w) || item.text.includes(w))) score = 20;
      if (score > 0) scored.push({ item, score });
    }
    // Stable: equal scores keep sheet order.
    return scored.sort((a, b) => b.score - a.score).slice(0, MAX).map((s) => s.item);
  }, [q, items]);

  type Entry = { kind: "action"; action: JumpAction } | { kind: "row"; item: JumpItem };
  const results: Entry[] = useMemo(
    () => [...actionHits.map((action) => ({ kind: "action" as const, action })), ...rowResults.map((item) => ({ kind: "row" as const, item }))],
    [actionHits, rowResults],
  );

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  const go = (i: number) => {
    const r = results[i];
    if (!r) return;
    onClose();
    if (r.kind === "action") r.action.run();
    else onJump(r.item.id);
  };

  return (
    <div className="jump-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="jump-box" role="dialog" aria-label="Jump to a row, or do something">
        <input
          ref={input}
          className="input jump-input"
          placeholder="A row number, some words, or something to do — like start or prompter"
          aria-label="Find a row or an action"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setAt((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setAt((a) => Math.max(0, a - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              go(at);
            }
          }}
        />
        <ul ref={list} className="jump-list" role="listbox">
          {results.length === 0 && <li className="jump-empty">Nothing on this sheet matches “{q}”.</li>}
          {results.map((r, i) => (
            <li
              key={r.kind === "action" ? `a:${r.action.id}` : r.item.id}
              data-i={i}
              role="option"
              aria-selected={i === at}
              className={`jump-item ${r.kind === "action" ? "is-action" : ""} ${i === at ? "is-on" : ""}`}
              onMouseEnter={() => setAt(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                go(i);
              }}
            >
              {r.kind === "action" ? (
                <>
                  <span className="jump-num" aria-hidden>
                    ↵
                  </span>
                  <span className="jump-title">{r.action.label}</span>
                  <span className="jump-start">Action</span>
                </>
              ) : (
                <>
                  <span className="jump-num">{r.item.number}</span>
                  <span className="jump-title">{r.item.title || "(untitled)"}</span>
                  <span className="jump-start">{r.item.start ?? ""}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
