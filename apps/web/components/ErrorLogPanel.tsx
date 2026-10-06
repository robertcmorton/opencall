"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface ErrorRow {
  id: string;
  at: string;
  source: string;
  message: string;
  stack: string | null;
  url: string | null;
  userAgent: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolution: string | null;
}

/** Where it went wrong, in words: the app's server, or somebody's browser. */
const SOURCE_WORD: Record<string, string> = {
  server: "server",
  process: "server",
  client: "browser",
};

const SOURCE_COLOR: Record<string, string> = {
  server: "var(--over)",
  process: "var(--over)",
  client: "var(--warn)",
};

/**
 * Admin-only error journal: everything that breaks — server, process, or any
 * visitor's browser — lands here for regular review and fixing.
 */
export function ErrorLogPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ErrorRow[] | null>(null);
  const [resolved, setResolved] = useState<ErrorRow[]>([]);
  /**
   * Entries marked fixed stay in the log, hidden, with what fixed them — so a
   * fault that comes back can be seen to have been here before. Shown on ask.
   */
  const [showResolved, setShowResolved] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(() => {
    Promise.all([api.errors(), api.errors(200, true)])
      .then(([open, done]) => {
        setRows(open);
        setResolved(done);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, []);
  const shown = rows == null ? null : showResolved ? [...rows, ...resolved].sort((a, b) => b.at.localeCompare(a.at)) : rows;
  useEffect(reload, [reload]);

  return (
    <section className="card" style={{ marginBottom: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0 }}>
          Error log{" "}
          <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "var(--fs-sm)" }}>
            — things that went wrong on the server or in someone&apos;s browser, newest first
          </span>
        </h2>
        <span style={{ flex: 1 }} />
        {resolved.length > 0 && (
          <button
            className={`btn btn-sm ${showResolved ? "is-on" : ""}`}
            aria-pressed={showResolved}
            onClick={() => setShowResolved((v) => !v)}
            data-tip="Show the problems already marked as fixed, and what fixed them"
          >
            {showResolved ? "Hide" : "Show"} resolved ({resolved.length})
          </button>
        )}
        <button className="btn btn-sm" onClick={reload} data-tip="Check for new entries">
          Refresh
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={!rows || rows.length === 0}
          onClick={() => void api.clearErrors().then(reload)}
          data-tip="Empty the error log for good. Do this once you have dealt with everything in it."
        >
          Clear log
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          ✕
        </button>
      </div>

      {failed && (
        <p style={{ color: "var(--over)", fontSize: "var(--fs-sm)", margin: "10px 0 0" }}>
          Couldn’t load the error log. Either the app can’t reach its server, or you are not signed in as a System
          Administrator. Reload the page to try again.
        </p>
      )}
      {shown != null && shown.length === 0 && !failed && (
        <p style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", margin: "10px 0 0" }}>
          {resolved.length > 0 ? "Nothing is wrong right now. Everything in the log has been marked as fixed." : "Nothing has gone wrong. Check again after the next show."}
        </p>
      )}

      {shown != null && shown.length > 0 && (
        <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, maxHeight: 420, overflowY: "auto" }}>
          {shown.map((r) => (
            <li key={r.id} style={{ borderTop: "1px solid var(--border-subtle)", padding: "7px 0" }}>
              <button
                type="button"
                onClick={() => setOpenId(openId === r.id ? null : r.id)}
                style={{
                  all: "unset",
                  cursor: "pointer",
                  display: "flex",
                  gap: 10,
                  alignItems: "baseline",
                  width: "100%",
                }}
              >
                <span className="mono" style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", whiteSpace: "nowrap" }}>
                  {new Date(r.at).toLocaleString()}
                </span>
                <span
                  className="chip"
                  style={{ color: SOURCE_COLOR[r.source] ?? "var(--text-2)", borderColor: SOURCE_COLOR[r.source] ?? "var(--border)" }}
                >
                  {SOURCE_WORD[r.source] ?? r.source}
                </span>
                <span
                  style={{
                    fontSize: "var(--fs-sm)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    color: r.resolvedAt ? "var(--text-3)" : undefined,
                    textDecoration: r.resolvedAt ? "line-through" : undefined,
                  }}
                >
                  {r.message}
                </span>
                {r.resolvedAt && <span className="chip" style={{ color: "var(--under)", borderColor: "var(--under)" }}>fixed</span>}
              </button>
              {r.resolvedAt && (
                <div style={{ margin: "3px 0 0", fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
                  Fixed: {r.resolution ?? "—"}{" "}
                  <span style={{ color: "var(--text-3)" }}>
                    · {r.resolvedBy ?? "someone"}, {new Date(r.resolvedAt).toLocaleString()}
                  </span>
                </div>
              )}
              {openId === r.id && (
                <div style={{ margin: "6px 0 2px", fontSize: "var(--fs-xs)", color: "var(--text-2)", display: "grid", gap: 4 }}>
                  {r.url && <div className="mono">{r.url}</div>}
                  {r.userAgent && <div style={{ color: "var(--text-3)" }}>{r.userAgent}</div>}
                  {r.stack && (
                    <pre className="mono" style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 180, overflowY: "auto", background: "var(--bg-2)", padding: 8, borderRadius: 6 }}>
                      {r.stack}
                    </pre>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
