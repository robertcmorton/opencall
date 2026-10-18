"use client";

import { useState } from "react";
import type { RowNote } from "../lib/useRowNotes";
import { Icon, EmptyState } from "./ui";

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
  /** The row a note just went to — said back, so sending is not a box that silently empties. */
  const [sentAbout, setSentAbout] = useState<string | null>(null);
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
        <span className="note-title">{titleOf(n.rowId) ?? "this row has been deleted"}</span>
      </button>
      {n.body && <p className="note-body">{n.body}</p>}
      <div className="note-meta">
        <span>
          {n.byName ?? "someone"}
          {n.byRole ? ` · ${n.byRole}` : ""} · {when(n.at)}
        </span>
        {!resolved && (
          <button type="button" className="btn btn-sm" onClick={() => onResolve(n.id)} data-tip="Mark this note as dealt with. It moves to the done list. It isn't deleted.">
            Resolve
          </button>
        )}
      </div>
    </li>
  );

  return (
    <div className="notes-panel">
      <header className="notes-head">
        {/* A view-only link can raise a note but not read any, so for them
            this is a message box, not a list (18 Oct). */}
        <strong>{compose ? "Note to the showcaller" : "Notes from the crew"}</strong>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close notes">
          {Icon.close}
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
              setSentAbout(compose.rowLabel);
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
              <span className="note-hint">Tap the row it’s about on the sheet. Each note is about one row.</span>
            )}
          </label>
          <textarea
            value={body}
            onChange={(e) => {
              setBody(e.target.value.slice(0, 280));
              setSentAbout(null);
            }}
            placeholder="Add more detail if you like. Sending the note on its own is enough to flag the row."
            rows={2}
            maxLength={280}
            // Always typeable: only sending waits for a row. Switched off until
            // a row was picked, it looked broken — a box you tap and cannot
            // type in — to the one person it is for (18 Oct).
          />
          <div className="note-compose-foot">
            <span className="note-count">{280 - body.length}</span>
            <button type="submit" className="btn btn-sm" disabled={!compose.rowId || sending}>
              {sending ? "Sending…" : "Raise note"}
            </button>
          </div>
          {sentAbout && (
            <p className="note-sent" role="status">
              {Icon.check} Sent — the showcaller can see your note about <strong>{sentAbout}</strong>.
            </p>
          )}
        </form>
      )}

      {/* The list is the showcaller's. Someone who can only raise notes never
          sees any, and "No notes right now" under the box they had just sent
          one from read as "it didn't send" — and took the half of a phone
          screen they needed for tapping the row. */}
      {compose ? null : open.length === 0 ? (
        <EmptyState
          compact
          icon={Icon.note}
          title="No notes right now"
          text="When someone spots a problem on a row — a wrong name, a missing cue — they raise a note on it, and it shows up here."
        />
      ) : (
        <ul className="notes-list">{open.map((n) => line(n, false))}</ul>
      )}

      {!compose && done.length > 0 && (
        <>
          <button type="button" className="btn btn-sm btn-ghost notes-done-toggle" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Hide" : "Show"} {done.length} dealt with
          </button>
          {showDone && <ul className="notes-list">{done.map((n) => line(n, true))}</ul>}
        </>
      )}
    </div>
  );
}
