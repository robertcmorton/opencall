"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { findInSheet, replaceInSheet } from "@opencall/db/findReplace";

/**
 * Find (and replace) across the whole sheet: every text column, every row.
 * Matches are listed as you type; click one to go to it. Replace all is one
 * change, so one Undo takes it all back, and it never touches a locked row.
 */
export function FindReplacePanel({
  doc,
  revision,
  canEdit,
  columnTitle,
  rowLabel,
  onGoTo,
  onClose,
}: {
  doc: Y.Doc;
  /** Changes whenever the sheet does, so the matches stay current. */
  revision: number;
  canEdit: boolean;
  columnTitle: (columnId: string) => string;
  rowLabel: (rowId: string) => string;
  onGoTo: (rowId: string) => void;
  onClose: () => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const hits = useMemo(() => findInSheet(doc, find, { matchCase }), [doc, find, matchCase, revision]);
  const total = hits.reduce((n, h) => n + h.count, 0);

  return (
    <div className="find-panel" role="dialog" aria-label="Find and replace">
      <div className="find-row">
        <input
          ref={input}
          className="input"
          placeholder="Find"
          value={find}
          onChange={(e) => {
            setFind(e.target.value);
            setDone(null);
          }}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
        />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {canEdit && (
        <div className="find-row">
          <input className="input" placeholder="Replace with" value={replace} onChange={(e) => setReplace(e.target.value)} onKeyDown={(e) => e.key === "Escape" && onClose()} />
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={total === 0}
            onClick={() => {
              let r = { replaced: 0, cells: 0, lockedSkipped: 0 };
              doc.transact(() => {
                r = replaceInSheet(doc, find, replace, { matchCase });
              });
              setDone(
                `Replaced ${r.replaced} in ${r.cells} cell${r.cells === 1 ? "" : "s"}.` +
                  (r.lockedSkipped ? ` ${r.lockedSkipped} in locked rows left alone.` : "") +
                  " Undo takes it back.",
              );
            }}
          >
            Replace all
          </button>
        </div>
      )}
      <label className="find-option">
        <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case
      </label>
      {done && <p className="find-done">{done}</p>}
      {find && (
        <p className="find-count">
          {total === 0 ? "No matches." : `${total} match${total === 1 ? "" : "es"} in ${hits.length} cell${hits.length === 1 ? "" : "s"}`}
        </p>
      )}
      <ul className="find-list">
        {hits.slice(0, 200).map((h) => (
          <li key={`${h.rowId}:${h.columnId}`}>
            <button type="button" onClick={() => onGoTo(h.rowId)}>
              <span className="find-where">{rowLabel(h.rowId)}</span>
              <span className="find-col">{columnTitle(h.columnId)}</span>
              {h.count > 1 && <span className="find-n">×{h.count}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
