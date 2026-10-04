"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type RowSnapshotView, type SheetChangeDetail, type VersionComparison } from "../../../../lib/api";
import { BackLink } from "../../../../components/BackLink";
import { dayOf, titleOf, whenDone } from "../../../../lib/changeLog";

/**
 * One change, in full: every field before and after, the rows it created and
 * deleted as they were, the rows it moved — and the two ways back.
 *
 * "Undo just this change" takes back this change alone and keeps everything
 * anybody has done since; what has been changed again since is left alone and
 * listed. "Restore to just before this" puts the whole sheet back to how it
 * was, which also undoes everything since — so it says what that is first.
 */
export default function ChangePage({ params }: { params: Promise<{ id: string; changeId: string }> }) {
  const { id, changeId } = use(params);
  const [c, setC] = useState<SheetChangeDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = () =>
    void api
      .sheetChange(changeId)
      .then(setC)
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : String(err)));
  useEffect(load, [changeId]);

  if (problem && !c)
    return (
      <main style={{ maxWidth: 760, margin: "4vh auto", padding: "0 16px", display: "grid", gap: 16 }}>
        <BackLink />
        <div className="panel">{problem}</div>
      </main>
    );
  if (!c) return <main style={{ padding: "4rem", textAlign: "center", color: "var(--text-3)" }}>Loading…</main>;

  const d = c.detail;
  const more = (shown: number, total: number) =>
    total > shown ? <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", margin: 0 }}>…and {total - shown} more not shown.</p> : null;

  return (
    <main style={{ maxWidth: 860, margin: "4vh auto", padding: "0 16px", display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <BackLink label="All changes" />
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{c.rundown?.name}</span>
      </div>

      <div style={{ display: "grid", gap: 4 }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>{titleOf(c)}</h1>
        <span style={{ color: "var(--text-2)" }}>
          {dayOf(c.at)}, {whenDone(c)}
        </span>
        <span style={{ color: "var(--text-2)" }}>{c.summary}</span>
      </div>

      {c.undoneByEntry && (
        <div className="panel" style={{ borderColor: "var(--warn)" }}>
          This change was undone by {c.undoneByEntry.actorName ?? "someone"} at {whenDone(c.undoneByEntry)}.{" "}
          <Link href={`/changes/${id}/${c.undoneByEntry.id}`} style={{ color: "var(--accent-text)" }}>
            See the undo
          </Link>
        </div>
      )}
      {c.undoesEntry && (
        <div className="panel">
          This took back an earlier change: {c.undoesEntry.summary} ({c.undoesEntry.actorName ?? "someone"}, {whenDone(c.undoesEntry)}).{" "}
          <Link href={`/changes/${id}/${c.undoesEntry.id}`} style={{ color: "var(--accent-text)" }}>
            See it
          </Link>
        </div>
      )}

      <WaysBack change={c} rundownId={id} onUndone={load} />

      {d.changed.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Changed ({d.counts.changed})</h2>
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table className="change-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>What</th>
                  <th>Before</th>
                  <th>After</th>
                </tr>
              </thead>
              <tbody>
                {d.changed.flatMap((r) =>
                  r.changes.map((f, i) => (
                    <tr key={`${r.id}:${f.key}`}>
                      {i === 0 ? (
                        <td rowSpan={r.changes.length} style={{ whiteSpace: "nowrap" }}>
                          <span style={{ color: "var(--text-3)" }}>{r.number}.</span> {r.title}
                        </td>
                      ) : null}
                      <td style={{ whiteSpace: "nowrap" }}>{f.field}</td>
                      <td className="change-before">{f.before || <em>empty</em>}</td>
                      <td className="change-after">{f.after || <em>empty</em>}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
          {more(d.changed.length, d.counts.changed)}
        </section>
      )}

      {d.added.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Added ({d.counts.added})</h2>
          {d.added.map((r) => (
            <RowCard key={r.id} row={r} tone="after" />
          ))}
          {more(d.added.length, d.counts.added)}
        </section>
      )}

      {d.removed.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Deleted ({d.counts.removed})</h2>
          {d.removed.map((r) => (
            <RowCard key={r.id} row={r} tone="before" />
          ))}
          {more(d.removed.length, d.counts.removed)}
        </section>
      )}

      {d.moved.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Moved ({d.counts.moved})</h2>
          <div className="panel" style={{ display: "grid", gap: 4 }}>
            {d.moved.map((r) => (
              <span key={r.id}>
                {r.title} <span style={{ color: "var(--text-3)" }}>· was row {r.from}, now row {r.number}</span>
              </span>
            ))}
          </div>
          {more(d.moved.length, d.counts.moved)}
        </section>
      )}

      {d.sheet.length > 0 && (
        <section style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>The sheet itself</h2>
          <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
            <table className="change-table">
              <tbody>
                {d.sheet.map((s) => (
                  <tr key={s.field}>
                    <td>{s.field}</td>
                    <td className="change-before">{s.before || <em>empty</em>}</td>
                    <td className="change-after">{s.after || <em>empty</em>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {d.truncated && (
        <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", margin: 0 }}>
          This change was large, so only its first rows of each kind are listed here. The counts are complete.
        </p>
      )}
    </main>
  );
}

function RowCard({ row, tone }: { row: RowSnapshotView; tone: "before" | "after" }) {
  const facts = [row.type, row.start ? `starts ${row.start}` : null, row.duration ? `runs ${row.duration}` : null].filter(Boolean).join(" · ");
  return (
    <div className={`panel change-row change-row-${tone}`} style={{ display: "grid", gap: 4 }}>
      <span>
        <span style={{ color: "var(--text-3)" }}>Row {row.number}.</span> <strong style={{ fontWeight: 600 }}>{row.title}</strong>
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}> · {facts}</span>
      </span>
      {Object.entries(row.cells).map(([col, text]) => (
        <span key={col} style={{ fontSize: "var(--fs-sm)", overflowWrap: "anywhere" }}>
          <span style={{ color: "var(--text-3)" }}>{col}:</span> {text}
        </span>
      ))}
    </div>
  );
}

/** Undo just this, or restore the whole sheet to just before it — each says what it will do first. */
function WaysBack({ change, rundownId, onUndone }: { change: SheetChangeDetail; rundownId: string; onUndone: () => void }) {
  const [undoing, setUndoing] = useState(false);
  const [undoArmed, setUndoArmed] = useState(false);
  const [outcome, setOutcome] = useState<Awaited<ReturnType<typeof api.undoSheetChange>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<VersionComparison | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);

  const undo = () => {
    setUndoing(true);
    setError(null);
    void api
      .undoSheetChange(change.id)
      .then((r) => {
        setOutcome(r);
        onUndone();
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        setUndoing(false);
        setUndoArmed(false);
      });
  };

  const n = preview?.counts;
  const previewLines = preview
    ? [
        preview.same ? "Nothing — the sheet is already as it was before this change." : null,
        n?.removed ? `Removes ${n.removed} row${n.removed === 1 ? "" : "s"} added since` : null,
        n?.added ? `Brings back ${n.added} row${n.added === 1 ? "" : "s"} deleted since` : null,
        n?.changed ? `Puts back ${n.changed} changed row${n.changed === 1 ? "" : "s"}` : null,
        n?.moved ? `Moves back ${n.moved} row${n.moved === 1 ? "" : "s"}` : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <strong>Take it back</strong>
      <div style={{ display: "grid", gap: 6 }}>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          <strong>Undo just this change</strong> puts back what this change altered and keeps everything anybody has done since. Anything
          changed again since is left alone and listed.
        </span>
        {change.canUndo ? (
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className={`btn ${undoArmed ? "btn-danger is-on" : "btn-primary"}`} disabled={undoing} onClick={() => (undoArmed ? undo() : setUndoArmed(true))}>
              {undoing ? "Undoing…" : undoArmed ? "Yes, undo this change" : "Undo just this change"}
            </button>
            {undoArmed && !undoing && (
              <button className="btn" onClick={() => setUndoArmed(false)}>
                Cancel
              </button>
            )}
          </span>
        ) : outcome ? null : (
          <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>{change.undoProblem}</span>
        )}
        {error && <span style={{ color: "var(--over)" }}>{error}</span>}
        {outcome && (
          <span style={{ display: "grid", gap: 2, fontSize: "var(--fs-sm)" }}>
            <span>
              {outcome.undone > 0 ? `Done — ${outcome.undone} thing${outcome.undone === 1 ? "" : "s"} put back.` : "Nothing could be put back."}
              {outcome.entryId && (
                <>
                  {" "}
                  <Link href={`/changes/${rundownId}/${outcome.entryId}`} style={{ color: "var(--accent-text)" }}>
                    See the undo
                  </Link>
                </>
              )}
            </span>
            {outcome.skipped.map((s, i) => (
              <span key={i} style={{ color: "var(--text-2)" }}>
                Left alone: {s.title} — {s.what} ({s.why})
              </span>
            ))}
          </span>
        )}
      </div>

      {change.beforeSnapshotId && (
        <div style={{ display: "grid", gap: 6, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
            <strong>Restore to just before this</strong> puts the whole sheet back to how it was before this change — which also undoes
            every change made since.
          </span>
          {restored ? (
            <span>
              Restored.{" "}
              <Link href={`/edit/${rundownId}`} style={{ color: "var(--accent-text)" }}>
                Open the sheet
              </Link>
            </span>
          ) : preview ? (
            <>
              <span style={{ display: "grid", gap: 2, fontSize: "var(--fs-sm)" }}>
                <span>Restoring now would:</span>
                {previewLines.map((l) => (
                  <span key={l} style={{ color: "var(--text-2)" }}>
                    · {l}
                  </span>
                ))}
              </span>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn btn-danger"
                  disabled={restoring || preview.same}
                  onClick={() => {
                    setRestoring(true);
                    void api
                      .restoreSnapshotInPlace(change.beforeSnapshotId!)
                      .then(() => setRestored(true))
                      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                      .finally(() => setRestoring(false));
                  }}
                >
                  {restoring ? "Restoring…" : "Yes, restore the whole sheet"}
                </button>
                <button className="btn" onClick={() => setPreview(null)}>
                  Cancel
                </button>
              </span>
            </>
          ) : (
            <span>
              <button
                className="btn"
                onClick={() =>
                  void api
                    .compareSnapshot(change.beforeSnapshotId!)
                    .then(setPreview)
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                }
              >
                Restore to just before this…
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
