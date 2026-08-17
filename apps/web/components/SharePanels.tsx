"use client";

import { useEffect, useState } from "react";
import { api, API_URL, copyViewOnlyLink, type SnapshotSummary } from "../lib/api";
import type { ColumnDef } from "@opencall/db/doc";
import { defaultViewColumns } from "@opencall/core";

const panelStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: "var(--fs-sm)",
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxWidth: 580,
};

/**
 * View-only links, and who is holding them.
 *
 * One kind of link now. Caller and editor codes were withdrawn: a code is a
 * thing that gets photographed off a wall and forwarded out of a group chat,
 * and neither of those should end with a stranger holding the transport.
 * Running or editing a show takes an account with a password.
 *
 * This replaced two panels that did nearly the same thing — a "join code" and
 * a "guest pass" — which nothing on screen distinguished.
 */
/**
 * What one link may show.
 *
 * The default is the phone-shaped set — a link is opened at the side of a
 * pitch far more often than at a desk — and anything else is an addition
 * somebody made deliberately. "Back to the default" is offered because a set
 * that has drifted is worth being able to undo without re-ticking six boxes.
 */
function ColumnChoice({
  columns,
  roleColumnKeys,
  chosen,
  onChange,
}: {
  columns: ColumnDef[];
  roleColumnKeys: string[];
  chosen: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const fallback = defaultViewColumns(
    columns.map((c) => ({ key: c.key, kind: c.kind })),
    roleColumnKeys,
  );
  const shown = new Set(chosen && chosen.length > 0 ? chosen : fallback);
  // The structural three are the sheet: without them there is nothing to read.
  const locked = (c: ColumnDef) => c.kind === "title" || c.kind === "startTime" || c.kind === "duration";
  return (
    <div className="panel" style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 4 }}>
      <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>Shows:</span>
      {columns.map((c) => (
        <label key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, opacity: locked(c) ? 0.6 : 1 }}>
          <input
            type="checkbox"
            checked={shown.has(c.key)}
            disabled={locked(c)}
            onChange={(e) => {
              const next = new Set(shown);
              if (e.target.checked) next.add(c.key);
              else next.delete(c.key);
              onChange([...columns.filter((x) => next.has(x.key)).map((x) => x.key)]);
            }}
          />
          {c.title}
        </label>
      ))}
      {chosen && chosen.length > 0 && (
        <button className="btn btn-sm btn-ghost" onClick={() => onChange(null)}>
          Back to the default
        </button>
      )}
    </div>
  );
}

/**
 * A panel that floats OVER the sheet rather than sitting on top of it.
 *
 * These opened inline, above the grid, which pushed the run sheet down the
 * screen — so asking a question about sharing moved the rows somebody was
 * reading, and on a live sheet that is the cue moving. A pop-up asks the
 * question without disturbing what is underneath, and leaves the moment it is
 * answered.
 *
 * Escape closes as well as the backdrop: this can open mid-show, and a way out
 * that needs aiming is not a way out.
 */
export function PanelModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="panel-modal no-print" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function JoinCodesPanel({
  rundownId,
  columns = [],
  roleColumnKeys = [],
  onClose,
}: {
  rundownId: string;
  columns?: ColumnDef[];
  roleColumnKeys?: string[];
  onClose: () => void;
}) {
  const [codes, setCodes] = useState<
    {
      id: string;
      kind?: string;
      token?: string | null;
      joinCode: string | null;
      role: string;
      label: string | null;
      columns?: Record<string, boolean> | null;
    }[]
  >([]);
  const [editingCols, setEditingCols] = useState<string | null>(null);
  const [viewers, setViewers] = useState<Awaited<ReturnType<typeof api.viewers>>>([]);
  /** The URL just copied, so the panel can say so. */
  const [copied, setCopied] = useState<string | null>(null);
  const reload = () => {
    void api.joinCodes(rundownId).then(setCodes);
    void api.viewers(rundownId).then(setViewers).catch(() => setViewers([]));
  };
  useEffect(reload, [rundownId]);

  const urlFor = (code: string) => `${window.location.origin}/view/${rundownId}?code=${code}`;
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });

  // Three states, and they are genuinely different things.
  //
  //   live      — the one kind of link there is now.
  //   guests    — the older "guest pass": a different URL that still opens the
  //               sheet read-only, but asks nobody for a name, so its holders
  //               never appear in the list below. No longer issued. Listed
  //               here because until now there was no way to revoke one at all.
  //   withdrawn — caller and editor codes. These are refused outright.
  const live = codes.filter((c) => c.kind !== "guest" && c.role === "follower");
  const guests = codes.filter((c) => c.kind === "guest");
  const withdrawn = codes.filter((c) => c.kind !== "guest" && c.role !== "follower");

  return (
    <PanelModal onClose={onClose}>
      <div className="panel" style={panelStyle}>
        <strong>View-only links</strong>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          A link opens this run sheet read-only, and it is the same link for everybody — send it to whoever needs to
          watch. Running or editing the show needs an account.
        </span>
        {/* One button, and it always works.
            There was a "who is this link for?" box first, which asked a question
            the link cannot answer: it is one URL and anyone holding it can open
            the sheet, so naming it described the sender's intention rather than
            anything the link does. And nothing could be copied until a link had
            been made, so the common case — "send the crew the sheet" — took two
            steps and a decision. Copy makes one if there is not one yet. */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="btn btn-sm btn-primary"
            data-tip="Copies a link that opens this run sheet read-only. Anyone with it can watch; nobody with it can change anything."
            onClick={() =>
              void copyViewOnlyLink(rundownId).then((url) => {
                setCopied(url);
                reload();
              })
            }
          >
            Copy view-only link
          </button>
          {copied && (
            <span style={{ color: "var(--under)", fontSize: "var(--fs-sm)" }}>Copied — paste it wherever your crew is.</span>
          )}
        </div>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {live.map((c) => (
            <li key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              {/* The LINK is the thing. It used to lead with the six-character
                  code, which made the panel look like something to read out and
                  have somebody type — and typing it is the fallback, not the
                  point. The URL is shown as a URL, and the code sits after it in
                  small type for the case where someone is looking at a printed
                  sheet rather than a screen. */}
              {c.joinCode && (
                <a
                  href={urlFor(c.joinCode)}
                  style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-sm)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }}
                  data-tip="Opens the read-only view, exactly as a recipient sees it"
                >
                  /view/{rundownId}?code={c.joinCode}
                </a>
              )}
              {c.joinCode && (
                <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(urlFor(c.joinCode!))}>
                  Copy link
                </button>
              )}
              {c.joinCode && (
                <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }} data-tip="Can be typed on the sign-in page instead of following the link">
                  or type {c.joinCode}
                </span>
              )}
              <button
                className="btn btn-sm"
                data-tip="Choose what this link shows. The default is what fits a phone — when, what, and whose job."
                onClick={() => setEditingCols(editingCols === c.id ? null : c.id)}
              >
                Columns
              </button>
              <button
                className="btn btn-sm btn-ghost"
                style={{ color: "var(--over)" }}
                data-tip="Revoke: this link stops working everywhere immediately, and its viewer list goes with it"
                onClick={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}
              >
                Revoke
              </button>
              {editingCols === c.id && (
                <ColumnChoice
                  columns={columns}
                  roleColumnKeys={roleColumnKeys}
                  chosen={c.columns ? Object.keys(c.columns) : null}
                  onChange={(next) => void api.setCodeColumns(rundownId, c.id, next).then(reload)}
                />
              )}
            </li>
          ))}
        </ul>
        {live.length === 0 && <span style={{ color: "var(--text-3)" }}>No links yet.</span>}

        {guests.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <strong style={{ color: "var(--warn)" }}>Older guest links — still open</strong>
            <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)", marginBottom: 6 }}>
              Guest passes are no longer issued. These still open the sheet read-only, but they never asked for a name, so
              whoever is holding them will not appear below. Revoke them once you have replaced them with a view-only link.
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {guests.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-2)", minWidth: 120 }}>
                    {c.label ?? <span style={{ color: "var(--text-3)" }}>unnamed guest pass</span>}
                  </span>
                  {c.token && (
                    <button
                      className="btn btn-sm"
                      onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/guest/${c.token}`)}
                    >
                      Copy link
                    </button>
                  )}
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ color: "var(--over)" }}
                    data-tip="Revoke: this link stops working immediately, for everyone holding it"
                    onClick={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {withdrawn.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <strong style={{ color: "var(--warn)" }}>No longer working</strong>
            <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)", marginBottom: 6 }}>
              Caller and editor codes have been withdrawn. Anyone holding one is told to sign in. Revoke them to tidy up.
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {withdrawn.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                  <code style={{ opacity: 0.6, letterSpacing: "0.15em" }}>{c.joinCode}</code>
                  <span style={{ color: "var(--text-3)" }}>{c.role}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <strong>Who has it open</strong>
          {viewers.length === 0 ? (
            <span style={{ display: "block", color: "var(--text-3)" }}>Nobody has opened a link yet.</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {viewers.map((v) => (
                <li key={v.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
                  <strong style={{ minWidth: 120 }}>{v.name}</strong>
                  {v.roles && (
                    <span
                      style={{ color: "var(--accent-text)", background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: 4, padding: "0 5px", fontWeight: 600 }}
                      data-tip="What they picked as their role — their own words, not an assignment"
                    >
                      {v.roles}
                    </span>
                  )}
                  <span style={{ color: "var(--text-2)" }}>
                    {[v.os, v.browser, v.screen].filter(Boolean).join(" · ")}
                  </span>
                  {v.ip && <span style={{ color: "var(--text-3)" }}>{v.ip}</span>}
                  {v.link && <span style={{ color: "var(--text-3)" }}>via {v.link}</span>}
                  <span style={{ color: "var(--text-3)" }}>last seen {when(v.lastSeenAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          Close
        </button>
      </div>
    </PanelModal>
  );
}

function RestoreHereButton({ snapshotId }: { snapshotId: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`btn btn-sm ${armed ? "btn-danger is-on" : ""}`}
      data-tip="Replace this rundown's content with this version (a 'Before restore' snapshot is saved first)"
      onClick={() => {
        if (!armed) {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3500);
          return;
        }
        void api
          .restoreSnapshotInPlace(snapshotId)
          .then(() => window.location.reload())
          .catch((err) => window.alert(String(err)));
      }}
    >
      {armed ? "Replace current content?" : "Restore here"}
    </button>
  );
}

export function HistoryPanel({ rundownId, onClose }: { rundownId: string; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  const reload = () => void api.snapshots(rundownId).then(setSnapshots);
  useEffect(reload, [rundownId]);

  return (
    <div className="panel" style={panelStyle}>
      <strong>Version history</strong>
      <div>
        <button
          className="btn btn-sm"
          onClick={() => {
            const label = window.prompt("Version label", "Manual save");
            if (label !== null) void api.createSnapshot(rundownId, label || undefined).then(reload);
          }}
        >
          Save version now
        </button>
      </div>
      <div>
        <a
          className="btn btn-sm"
          style={{ textDecoration: "none" }}
          href={`${API_URL}/rundowns/${rundownId}/report?format=csv`}
          download
        >
          Download as-run report (CSV)
        </a>
      </div>
      {snapshots.length === 0 && <span style={{ color: "var(--text-3)" }}>No versions yet. One is saved automatically when a show starts.</span>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {snapshots.map((s) => (
          <li key={s.id} style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ flex: 1 }}>
              {s.label ?? "Untitled"}{" "}
              <span style={{ color: "var(--text-3)" }}>{new Date(s.createdAt).toLocaleString()}</span>
            </span>
            <RestoreHereButton snapshotId={s.id} />
            <button
              className="btn btn-sm"
              data-tip="Copy this version into a NEW rundown, leaving the current one untouched"
              onClick={() =>
                void api
                  .restoreSnapshot(s.id)
                  .then(({ id }) => (window.location.href = `/show/${id}`))
              }
            >
              Restore as copy
            </button>
          </li>
        ))}
      </ul>
      <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
