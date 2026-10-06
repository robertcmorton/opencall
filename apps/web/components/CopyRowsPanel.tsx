"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../lib/api";

/**
 * Copy the selected rows to another sheet: pick one of the company's sheets
 * you can edit, and they go on its end. Columns are matched by name; what the
 * other sheet has no column for is listed rather than silently dropped.
 */
export function CopyRowsPanel({ rundownId, rowIds, onClose }: { rundownId: string; rowIds: string[]; onClose: () => void }) {
  const [targets, setTargets] = useState<Awaited<ReturnType<typeof api.copyTargets>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof api.copyRows>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void api
      .copyTargets(rundownId)
      .then(setTargets)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [rundownId]);

  return (
    <div className="find-panel" role="dialog" aria-label="Copy rows to another sheet">
      <div className="find-row" style={{ alignItems: "center" }}>
        <strong style={{ flex: 1 }}>
          Copy {rowIds.length} row{rowIds.length === 1 ? "" : "s"} to the end of which sheet?
        </strong>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {error && <p className="find-count" style={{ color: "var(--over)" }}>{error}</p>}
      {result ? (
        <div style={{ display: "grid", gap: 6, fontSize: "var(--fs-sm)" }}>
          <span className="find-done">
            Copied {result.added} row{result.added === 1 ? "" : "s"} to the end of {result.target.name}.
          </span>
          {result.unmatchedColumns.length > 0 && (
            <span style={{ color: "var(--text-2)" }}>
              That sheet has no {result.unmatchedColumns.join(", ")} column{result.unmatchedColumns.length === 1 ? "" : "s"}, so those cells were not copied.
            </span>
          )}
          <Link href={`/edit/${result.target.id}`} style={{ color: "var(--accent-text)" }}>
            Open {result.target.name}
          </Link>
        </div>
      ) : targets == null ? (
        !error && <p className="find-count">Loading…</p>
      ) : targets.length === 0 ? (
        <p className="find-count">There is no other sheet in this company that you can edit.</p>
      ) : (
        <ul className="find-list">
          {targets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => {
                  setBusy(t.id);
                  setError(null);
                  void api
                    .copyRows(rundownId, t.id, rowIds)
                    .then(setResult)
                    .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
                    .finally(() => setBusy(null));
                }}
              >
                <span className="find-where">{busy === t.id ? "Copying…" : t.name}</span>
                <span className="find-col">{t.event}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
