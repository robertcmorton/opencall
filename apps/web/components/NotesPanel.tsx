"use client";

import { useState } from "react";
import type { RowNote } from "../lib/useRowNotes";

/**
 * Notes the crew have raised against rows, and the way to answer them.
 *
 * The sheet's comments column is written before the day starts and read by
 * nobody after it. This is the other direction: a camera operator says "this
 * one" during the show, and the person calling it sees which line they meant.
 *
 * Resolved rather than deleted, because "this was queried at the time, by
 * camera 2" is worth knowing at the debrief — see the endpoint's own note.
 */
export function NotesPanel({
  notes,
  titleOf,
  numberOf,
  onResolve,
  onGoToRow,
  onClose,
  compose,
}: {
  notes: RowNote[];
  /** What the sheet calls that row — a note about "row 47" helps nobody. */
  titleOf: (rowId: string) => string | null;
  numberOf: (rowId: string) => string;
  onResolve: (noteId: string) => void;
  onGoToRow: (rowId: string) => void;
  onClose: () => void;
  /** Present only for somebody holding a view-only link — see `raise`. */
  compose?: { rowId: string | null; rowLabel: string | null; onSend: (body: string) => Promise<void> };
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const open = notes.filter((n) => !n.resolvedAt);
  const done = notes.filter((n) => n.resolvedAt);

  const when = (iso: string): string => {
    const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (secs < 60) return "just now";
    if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const line = (n: RowNote, resolved: boolean) => (
    <li key={n.id} className={`note-item ${resolved ? "is-done" : ""}`}>
      <button type="button" className="note-row" onClick={() => onGoToRow(n.rowId)} data-tip="Go to this row">
        <span className="note-num">{numberOf(n.rowId) || "—"}</span>
        <span className="note-title">{titleOf(n.rowId) ?? "row no longer on the sheet"}</span>
      </button>
      {n.body && <p className="note-body">{n.body}</p>}
      <div className="note-meta">
        <span>
          {n.byName ?? "someone"}
          {n.byRole ? ` · ${n.byRole}` : ""} · {when(n.at)}
        </span>
        {!resolved && (
          <button type="button" className="btn btn-sm" onClick={() => onResolve(n.id)} data-tip="Dealt with — it stays on the record">
            Resolve
          </button>
        )}
      </div>
    </li>
  );

  return (
    <div className="notes-panel">
      <header className="notes-head">
        <strong>Notes from the crew</strong>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close notes">
          ✕
        </button>
      </header>

      {compose && (
        <form
          className="note-compose"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!compose.rowId || sending) return;
            setSending(true);
            try {
              await compose.onSend(body.trim());
              setBody("");
            } finally {
              setSending(false);
            }
          }}
        >
          <label className="note-compose-row">
            {compose.rowId ? (
              <>
                About <strong>{compose.rowLabel}</strong>
              </>
            ) : (
              // Nothing to attach it to: a note with no row is the comments
              // column again, which is the thing this exists to replace.
              <span className="note-hint">Pick a row on the sheet first — a note belongs to a line.</span>
            )}
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 280))}
            placeholder="Optional — the tap is the message, this is the detail"
            rows={2}
            maxLength={280}
            disabled={!compose.rowId}
          />
          <div className="note-compose-foot">
            <span className="note-count">{280 - body.length}</span>
            <button type="submit" className="btn btn-sm" disabled={!compose.rowId || sending}>
              {sending ? "Sending…" : "Raise note"}
            </button>
          </div>
        </form>
      )}

      {open.length === 0 ? (
        <p className="notes-empty">Nothing raised.</p>
      ) : (
        <ul className="notes-list">{open.map((n) => line(n, false))}</ul>
      )}

      {done.length > 0 && (
        <>
          <button type="button" className="btn btn-sm btn-ghost notes-done-toggle" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide" : "Show"} {done.length} resolved
          </button>
          {showDone && <ul className="notes-list">{done.map((n) => line(n, true))}</ul>}
        </>
      )}
    </div>
  );
}
