"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { serializeCsv } from "@opencall/core";
import { api, type EventSummary } from "../../../lib/api";
import { sendToSignIn } from "../../../lib/session";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection, CredentialsNavSection } from "../../../components/AdminNav";

type Entry = Awaited<ReturnType<typeof api.timeline>>["entries"][number];
type Source = Entry["source"];

const SOURCES: { key: Source; label: string; tip: string }[] = [
  { key: "activity", label: "Pages and screens", tip: "Pages opened, and show screens joining, leaving and being refused" },
  { key: "show", label: "Show actions", tip: "Start, Stop, cue moves, messages — and the clock's own moves" },
  { key: "account", label: "Sign-ins and access", tip: "Sign-ins, wrong passwords, access changed, things deleted" },
  { key: "edit", label: "Edits", tip: "Changes made to sheets" },
  { key: "error", label: "Errors", tip: "Faults, with the steps that led up to them" },
];

/** A datetime-local value for an ISO time, in this device's own zone. */
const localInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/**
 * The timeline (System Administrators only, 24 Oct 2026): one person's — or
 * one sheet's, one device's, one address's — story in time order. Pages
 * opened, show screens joining and dropping, show actions, sign-ins, edits
 * and errors, from the last 90 days. For "is something going on that
 * shouldn't be?" and for "what happened just before this went wrong?".
 */
function Timeline() {
  const router = useRouter();
  const params = useSearchParams();
  const [me, setMe] = useState<{ role: string | null } | null>(null);
  const [people, setPeople] = useState<{ id: string; name: string }[]>([]);
  const [sheets, setSheets] = useState<{ id: string; name: string }[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  // The filters live in the address, so a link from an alert lands filtered
  // and a filtered view can be passed on.
  const who = params.get("user") ?? (params.get("actor") === "admin" ? "admin" : "");
  const sheet = params.get("sheet") ?? "";
  const device = params.get("device") ?? "";
  const ip = params.get("ip") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const sources = useMemo(() => new Set((params.get("sources") ?? SOURCES.map((s) => s.key).join(",")).split(",") as Source[]), [params]);
  // The clock moves the cue every few seconds of a show; worth seeing when
  // retracing a fault, noise when looking for a person. Off unless asked for.
  const withClock = params.get("clock") === "1";
  const shown = entries ?? [];

  const setFilter = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/admin/timeline?${next.toString()}`);
  };

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) sendToSignIn(router);
        else if (m.role !== "admin") router.replace("/admin");
        else {
          void api.users().then((u) => setPeople(u.map(({ id, name }) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => undefined);
          void api
            .events(true)
            .then((evs: EventSummary[]) => setSheets(evs.flatMap((e) => e.rundowns.map((r) => ({ id: r.id, name: `${r.name} — ${e.name}` })))))
            .catch(() => undefined);
        }
      })
      .catch(() => setFailed(true));
  }, [router]);

  useEffect(() => {
    if (me?.role !== "admin") return;
    setEntries(null);
    api
      .timeline({
        user: who && who !== "admin" ? who : undefined,
        actor: who === "admin" ? "admin" : undefined,
        sheet: sheet || undefined,
        device: device || undefined,
        ip: ip || undefined,
        from: from || undefined,
        to: to || undefined,
        sources: [...sources].join(","),
        clock: withClock ? "1" : undefined,
        limit: 500,
      })
      .then((r) => setEntries(r.entries))
      .catch(() => setFailed(true));
  }, [me, who, sheet, device, ip, from, to, sources, withClock]);

  const exportCsv = () => {
    if (!entries) return;
    const rows = [
      ["When", "Who", "What", "Sheet", "Device", "Device id", "Place", "Address", "Record"],
      ...shown.map((e) => [new Date(e.at).toLocaleString(), e.who ?? "", e.what, e.sheet ?? "", e.device ?? "", e.deviceId ?? "", e.place ?? "", e.ip ?? "", e.source]),
    ];
    const blob = new Blob([serializeCsv(rows)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `opencall-timeline-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = Boolean(who || sheet || device || ip || from || to);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Timeline" settings={<><AdminNavSection active="timeline" /><CredentialsNavSection me={me} onSignedOut={() => router.replace("/admin")} /></>}>
        <main className="admin-main">
          <header style={{ marginBottom: "1rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Timeline</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              What each person and device did, in order: pages opened, show screens joining and dropping, show actions, sign-ins, edits and errors. The last 90 days. Places are worked out from the internet address and can be wrong, especially for phones.
            </p>
          </header>

          <div className="timeline-filters panel">
            <label>
              Person
              <select value={who} onChange={(e) => setFilter({ user: e.target.value && e.target.value !== "admin" ? e.target.value : null, actor: e.target.value === "admin" ? "admin" : null })}>
                <option value="">Everyone</option>
                <option value="admin">Administrator (server code)</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sheet
              <select value={sheet} onChange={(e) => setFilter({ sheet: e.target.value || null })}>
                <option value="">Every sheet</option>
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              From
              <input type="datetime-local" value={localInput(from || null)} onChange={(e) => setFilter({ from: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </label>
            <label>
              To
              <input type="datetime-local" value={localInput(to || null)} onChange={(e) => setFilter({ to: e.target.value ? new Date(e.target.value).toISOString() : null })} />
            </label>
            <div className="timeline-sources" role="group" aria-label="Which records">
              {SOURCES.map((s) => (
                <label key={s.key} data-tip={s.tip}>
                  <input
                    type="checkbox"
                    checked={sources.has(s.key)}
                    onChange={(e) => {
                      const next = new Set(sources);
                      if (e.target.checked) next.add(s.key);
                      else next.delete(s.key);
                      setFilter({ sources: next.size === SOURCES.length ? null : [...next].join(",") || "none" });
                    }}
                  />
                  {s.label}
                </label>
              ))}
              <label data-tip="Each time the clock moved the cue by itself — many during a show">
                <input type="checkbox" checked={withClock} onChange={(e) => setFilter({ clock: e.target.checked ? "1" : null })} />
                The clock&apos;s own moves
              </label>
            </div>
            {(device || ip) && (
              <div className="timeline-chips">
                {device && (
                  <button type="button" className="btn btn-sm" onClick={() => setFilter({ device: null })} data-tip="Show every device again">
                    One device: {device.slice(0, 8)}… ✕
                  </button>
                )}
                {ip && (
                  <button type="button" className="btn btn-sm" onClick={() => setFilter({ ip: null })} data-tip="Show every address again">
                    Address {ip} ✕
                  </button>
                )}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
              {filtered && (
                <button type="button" className="btn btn-sm" onClick={() => router.replace("/admin/timeline")}>
                  Clear filters
                </button>
              )}
              <button type="button" className="btn btn-sm" onClick={exportCsv} disabled={!shown.length} data-tip="Download what's shown, to open in Excel or Google Sheets">
                Export to a spreadsheet
              </button>
            </div>
          </div>

          {failed ? (
            <div className="cmd-error" role="alert">Can&apos;t load the timeline because the app can&apos;t reach its server. Reload the page in a moment.</div>
          ) : entries == null ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Loading…</div>
          ) : shown.length === 0 ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Nothing recorded for this.</div>
          ) : (
            <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
              <table className="activity-table timeline-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Sheet</th>
                    <th>Device</th>
                    <th>Place</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e, i) => {
                    const id = `${e.at}-${i}`;
                    const trail = Array.isArray(e.detail?.trail) ? (e.detail!.trail as { at: number; kind: string; what: string }[]) : null;
                    const warn = e.source === "error" || e.kind === "refused" || e.kind === "trap" || e.kind === "login.failed" || (e.kind === "disconnect" && e.detail?.code === 1006);
                    return (
                      <tr key={id} className={`${warn ? "activity-warn" : ""} timeline-${e.source}`}>
                        <td className="mono">{new Date(e.at).toLocaleString()}</td>
                        <td>
                          {e.userId ? (
                            <button type="button" className="link-button" onClick={() => setFilter({ user: e.userId, actor: null })} data-tip="Only this person">
                              {e.who ?? "Account"}
                            </button>
                          ) : (
                            (e.who ?? <span className="activity-sub">—</span>)
                          )}
                        </td>
                        <td>
                          {e.what}
                          {e.source === "edit" && e.rundownId && typeof e.detail?.changeId === "string" && (
                            <>
                              {" "}
                              <Link href={`/changes/${e.rundownId}/${e.detail.changeId}`}>See the change</Link>
                            </>
                          )}
                          {trail && trail.length > 0 && (
                            <>
                              {" "}
                              <button type="button" className="link-button" onClick={() => setOpen(open === id ? null : id)}>
                                {open === id ? "Hide the steps" : `The ${trail.length} steps before it`}
                              </button>
                              {open === id && (
                                <ol className="timeline-trail">
                                  {trail.map((s, k) => (
                                    <li key={k}>
                                      <span className="mono">{new Date(s.at).toLocaleTimeString()}</span> {s.kind}: {s.what}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </>
                          )}
                        </td>
                        <td>
                          {e.rundownId ? (
                            <button type="button" className="link-button" onClick={() => setFilter({ sheet: e.rundownId })} data-tip="Only this sheet">
                              {e.sheet ?? "A sheet"}
                            </button>
                          ) : (
                            <span className="activity-sub">—</span>
                          )}
                        </td>
                        <td>
                          {e.deviceId ? (
                            <button type="button" className="link-button" onClick={() => setFilter({ device: e.deviceId })} data-tip="Only this device">
                              {e.device ?? "A device"}
                            </button>
                          ) : (
                            (e.device ?? <span className="activity-sub">—</span>)
                          )}
                        </td>
                        <td>
                          {e.ip ? (
                            <button type="button" className="link-button" onClick={() => setFilter({ ip: e.ip })} data-tip={`Everything from ${e.ip}`}>
                              {e.place ?? e.ip}
                            </button>
                          ) : (
                            (e.place ?? <span className="activity-sub">—</span>)
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="activity-sub" style={{ marginTop: 10 }}>
            Places from{" "}
            <a href="https://db-ip.com" rel="noreferrer">
              IP Geolocation by DB-IP
            </a>
            .
          </p>
        </main>
      </WithSideNav>
    </div>
  );
}

export default function AdminTimelinePage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense fallback={null}>
      <Timeline />
    </Suspense>
  );
}
