"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { type AccessPerson, api, API_URL, copyViewOnlyLink, type SnapshotSummary, type VersionComparison } from "../lib/api";
import type { ColumnDef } from "@opencall/db/doc";
import { defaultViewColumns } from "@opencall/core";
import { ConfirmButton } from "./ConfirmButton";
import { askText, sayError } from "../lib/dialogs";

const panelStyle: React.CSSProperties = {
  margin: "0 0 12px",
  fontSize: "var(--fs-sm)",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-3)",
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
    <div className="panel" style={{ flexBasis: "100%", display: "flex", flexWrap: "wrap", gap: "var(--space-2)", alignItems: "center", marginTop: 4 }}>
      <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>This link shows:</span>
      {columns.map((c) => (
        <label key={c.key} style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-1)", opacity: locked(c) ? 0.6 : 1 }}>
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
          Go back to the usual columns
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
  const [people, setPeople] = useState<AccessPerson[]>([]);
  /** The URL just copied, so the panel can say so. */
  const [copied, setCopied] = useState<string | null>(null);
  const reload = () => {
    void api.joinCodes(rundownId).then(setCodes);
    void api.viewers(rundownId).then(setViewers).catch(() => setViewers([]));
    void api.rundownPeople(rundownId).then(setPeople).catch(() => setPeople([]));
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
          A view-only link lets people look at this run sheet without changing anything. Everyone gets the same link,
          so send it to anyone who needs to follow along. To run or edit the show, people need an account.
        </span>
        {/* One button, and it always works.
            There was a "who is this link for?" box first, which asked a question
            the link cannot answer: it is one URL and anyone holding it can open
            the sheet, so naming it described the sender's intention rather than
            anything the link does. And nothing could be copied until a link had
            been made, so the common case — "send the crew the sheet" — took two
            steps and a decision. Copy makes one if there is not one yet. */}
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }}>
          <button
            className="btn btn-sm btn-primary"
            data-tip="Copy a link that lets people look at this run sheet. Anyone with it can follow the show, but nobody can change anything with it."
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
            <span style={{ color: "var(--under)", fontSize: "var(--fs-sm)" }}>Copied. Paste it into a message to your crew.</span>
          )}
        </div>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          {live.map((c) => (
            <li key={c.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
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
                  data-tip="Open the link to see exactly what your crew will see"
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
                <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }} data-tip="People can type this code on the front page instead of using the link">
                  or type {c.joinCode}
                </span>
              )}
              <button
                className="btn btn-sm"
                data-tip="Choose which columns people see with this link. Normally it shows what fits on a phone: when, what, and whose job it is."
                onClick={() => setEditingCols(editingCols === c.id ? null : c.id)}
              >
                Columns
              </button>
              <ConfirmButton
                className="btn btn-sm btn-ghost"
                style={{ color: "var(--over)" }}
                data-tip="Turn this link off. It stops working for everyone straight away, and the list of who opened it is cleared."
                label="Turn off"
                confirmLabel="Press again to turn it off"
                onConfirm={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}
              />
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
        {live.length === 0 && <span style={{ color: "var(--text-3)" }}>No links yet. Press Copy view-only link to make one.</span>}

        {guests.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <strong style={{ color: "var(--warn)" }}>Older guest links — still open</strong>
            <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)", marginBottom: 6 }}>
              We don&apos;t make guest passes any more. These old ones still let people look at the sheet, but they never
              asked for a name, so you can&apos;t see who is using them in the list below. Once you have sent people a
              view-only link instead, turn these off.
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {guests.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-2)", minWidth: 120 }}>
                    {c.label ?? <span style={{ color: "var(--text-3)" }}>Guest with no name</span>}
                  </span>
                  {c.token && (
                    <button
                      className="btn btn-sm"
                      onClick={() => void navigator.clipboard.writeText(`${window.location.origin}/guest/${c.token}`)}
                    >
                      Copy link
                    </button>
                  )}
                  <ConfirmButton
                    className="btn btn-sm btn-ghost"
                    style={{ color: "var(--over)" }}
                    data-tip="Turn this link off. It stops working for everyone straight away."
                    label="Turn off"
                    confirmLabel="Press again to turn it off"
                    onConfirm={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}

        {withdrawn.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
            <strong style={{ color: "var(--warn)" }}>No longer working</strong>
            <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)", marginBottom: 6 }}>
              Showcaller and Producer codes don&apos;t work any more. Anyone who uses one is asked to sign in instead. Turn
              them off to tidy up.
            </span>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {withdrawn.map((c) => (
                <li key={c.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
                  <code style={{ opacity: 0.6, letterSpacing: "0.15em" }}>{c.joinCode}</code>
                  <span style={{ color: "var(--text-3)" }}>{c.role === "caller" ? "Showcaller code" : c.role === "editor" ? "Producer code" : c.role}</span>
                  <button className="btn btn-sm btn-ghost" onClick={() => void api.revokeJoinCode(rundownId, c.id).then(reload)}>
                    Turn off
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <strong>Who can open this sheet with an account</strong>
          {people.length === 0 ? (
            <span style={{ display: "block", color: "var(--text-3)" }}>Only the System Administrator.</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {people.map((p) => (
                <li key={`${p.name}|${p.email ?? ""}`} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
                  <strong style={{ minWidth: 120 }}>{p.name}</strong>
                  {p.email && <span style={{ color: "var(--text-2)" }}>{p.email}</span>}
                  <span className="chip">{p.access}</span>
                  <span style={{ color: "var(--text-3)" }}>{p.via}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
          <strong>Who has opened a link</strong>
          {viewers.length === 0 ? (
            <span style={{ display: "block", color: "var(--text-3)" }}>Nobody has opened a link yet.</span>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              {viewers.map((v) => (
                <li key={v.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
                  <strong style={{ minWidth: 120 }}>{v.name}</strong>
                  {v.roles && (
                    <span
                      style={{ color: "var(--accent-text)", background: "var(--accent-soft)", border: "1px solid var(--accent)", borderRadius: "var(--r-xs)", padding: "0 5px", fontWeight: 600 }}
                      data-tip="The job they said they do when they opened the link. They chose it themselves."
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
      data-tip="Make the sheet look like this version again. A copy of how it looks now is saved first, called Before restore."
      onClick={() => {
        if (!armed) {
          setArmed(true);
          window.setTimeout(() => setArmed(false), 3500);
          return;
        }
        void api
          .restoreSnapshotInPlace(snapshotId)
          .then(() => window.location.reload())
          .catch((err) => sayError(err));
      }}
    >
      {armed ? "Press again to replace the sheet" : "Restore here"}
    </button>
  );
}

const KIND_TAG: Record<string, string> = {
  assistant: "AI",
  edit: "Edit",
  show_start: "Show start",
  restore: "Restore",
  import: "Import",
};

const names = (rows: { number: number; title: string }[], total: number) => {
  const shown = rows.slice(0, 6).map((r) => `${r.number}. ${r.title}`);
  return total > shown.length ? `${shown.join(", ")} and ${total - shown.length} more` : shown.join(", ");
};
const rowWord = (n: number) => (n === 1 ? "a row" : `${n.toLocaleString()} rows`);

/**
 * "What would restoring this undo?" — the sheet as it is now against this
 * version, in plain lines, before anybody presses Restore. The point is the
 * work done SINCE that version: restoring takes all of it back, not only the
 * change somebody regrets.
 */
function WhatRestoringUndoes({ snapshotId }: { snapshotId: string }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<VersionComparison | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  if (!open)
    return (
      <button
        className="btn-link"
        style={{ justifySelf: "start", fontSize: "var(--fs-sm)" }}
        onClick={() => {
          setOpen(true);
          void api
            .compareSnapshot(snapshotId)
            .then(setC)
            .catch((err: unknown) => setFailed(err instanceof Error ? err.message : String(err)));
        }}
      >
        What would restoring this undo?
      </button>
    );
  const lines: string[] = [];
  if (c) {
    if (c.same) lines.push("Nothing. The sheet already matches this version.");
    const n = c.counts;
    if (n.removed) lines.push(`Removes ${rowWord(n.removed)} added since: ${names(c.removed, n.removed)}`);
    if (n.added) lines.push(`Brings back ${rowWord(n.added)} deleted since: ${names(c.added, n.added)}`);
    for (const r of c.changed.slice(0, 8)) lines.push(`Puts back ${r.number}. ${r.title}: ${r.fields.join(", ")}`);
    if (n.changed > 8) lines.push(`…and changes to ${(n.changed - 8).toLocaleString()} more rows`);
    if (n.moved) lines.push(`Moves back ${rowWord(n.moved)}: ${names(c.moved, n.moved)}`);
    if (c.sheet.length) lines.push(`Also puts back the sheet's ${c.sheet.join(", ").toLowerCase()}`);
  }
  return (
    <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-2)", display: "grid", gap: 2, paddingTop: 2 }}>
      {failed ? failed : !c ? "Checking…" : lines.map((l, i) => <span key={i}>{l}</span>)}
    </span>
  );
}

/**
 * Version history, floating over the sheet rather than shoving it down.
 *
 * This opened inline, above the grid, so asking "what did this look like an
 * hour ago?" moved every row down the screen — and on a live sheet the row
 * that moves is the cue the showcaller is reading. Same reasoning, and the
 * same PanelModal, as the sharing panel above it.
 */
export function HistoryPanel({ rundownId, open = true, onClose }: { rundownId: string; open?: boolean; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
  // Bumped on every reload so an opened comparison is not left showing how the
  // sheet compared the LAST time the panel was open.
  const [generation, setGeneration] = useState(0);
  const reload = () =>
    void api.snapshots(rundownId).then((list) => {
      setSnapshots(list);
      setGeneration((g) => g + 1);
    });
  // The panel stays mounted while closed, so it re-reads on every opening:
  // versions saved since (an assistant saves one before each change) must show.
  useEffect(() => {
    if (open) reload();
  }, [rundownId, open]);

  return (
    <PanelModal onClose={onClose}>
      <div className="panel" style={panelStyle}>
        <span style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
          <strong style={{ flex: 1 }}>Version history</strong>
          <Link href={`/changes/${rundownId}`} style={{ color: "var(--accent-text)", fontSize: "var(--fs-sm)" }}>
            Every change, in detail →
          </Link>
        </span>
        <div>
          <button
            className="btn btn-sm"
            data-tip="Save a copy of the sheet as it is right now, so you can go back to it later"
            onClick={async () => {
              const label = await askText({
                title: "Save a version now",
                label: "Name it, so you can find it later",
                value: "Saved by hand",
                confirmLabel: "Save version",
              });
              if (label !== null) void api.createSnapshot(rundownId, label || undefined).then(reload).catch((err) => sayError(err));
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
            data-tip="A spreadsheet file of what really happened: when each row actually started and how long it ran"
          >
            Download as-run report (CSV)
          </a>
        </div>
        {snapshots.length === 0 && (
          <span style={{ color: "var(--text-3)" }}>
            No versions yet. A version is saved for you when a show starts, and before every change an AI assistant makes.
          </span>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-3)", maxHeight: "55vh", overflowY: "auto" }}>
          {snapshots.map((s) => (
            <li
              key={`${s.id}:${generation}`}
              style={{ display: "grid", gap: "var(--space-1)", paddingBottom: 10, borderBottom: "1px solid var(--border, rgba(127,127,127,.2))" }}
            >
              <span>
                {KIND_TAG[s.kind ?? ""] && <span className={`version-tag version-tag-${s.kind}`}>{KIND_TAG[s.kind ?? ""]}</span>}
                {s.label ?? "Untitled"}
              </span>
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                {new Date(s.createdAt).toLocaleString()}
                {s.by ? ` · ${s.kind === "assistant" ? `for ${s.by}` : s.by}` : ""}
              </span>
              <WhatRestoringUndoes snapshotId={s.id} />
              {/* Both of THIS version's buttons together, so neither can wrap
                  onto a line where it reads as belonging to the next one. */}
              <span style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
                <RestoreHereButton snapshotId={s.id} />
                <button
                  className="btn btn-sm"
                  data-tip="Make a new show from this version. This show stays as it is."
                  onClick={() =>
                    void api
                      .restoreSnapshot(s.id)
                      .then(({ id }) => (window.location.href = `/show/${id}`))
                  }
                >
                  Restore as copy
                </button>
              </span>
            </li>
          ))}
        </ul>
        <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          Close
        </button>
      </div>
    </PanelModal>
  );
}
