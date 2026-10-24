"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AUDIT_WORDS, describeDevice } from "@opencall/core";
import { api } from "../../../lib/api";
import { early, lastRole } from "../../../lib/lastRole";
import { sendToSignIn } from "../../../lib/session";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection, CredentialsNavSection } from "../../../components/AdminNav";

type Entry = Awaited<ReturnType<typeof api.audit>>[number];


/**
 * Entries from before 22 Oct 2026 carry no device, and their address is the
 * hosting company's front-door server rather than the person's: the app read
 * the wrong header until then. The two were fixed in the same release, so a
 * missing device is how an old address is told apart.
 */
const OLD_ADDRESS_TIP =
  "Recorded before 22 October 2026, when the app noted the hosting company's server instead of the person's address. It does not say where this came from.";

/**
 * Who did what to accounts and access (System Administrators only): sign-ins
 * and failed ones, password changes, people invited, access changed, tokens
 * replaced, and anything deleted. Newest first.
 */
export default function AdminActivityPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null } | null>(null);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Asked for beside "who am I?" rather than after it when this browser was
    // last an administrator's — one round trip instead of two (see lastRole).
    const list = lastRole() === "admin" ? early(api.audit(300)) : null;
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) sendToSignIn(router);
        else if (m.role !== "admin") router.replace("/admin");
        else (list ?? api.audit(300)).then(setRows).catch(() => setFailed(true));
      })
      .catch(() => setFailed(true));
  }, [router]);

  const who = (r: Entry) => r.actorName ?? (r.actor === "admin" ? "System Administrator" : r.actor?.startsWith("company:") ? "Company access token" : r.actor ? "Account" : "Not signed in");

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Account activity" settings={<><AdminNavSection active="activity" /><CredentialsNavSection me={me} onSignedOut={() => router.replace("/admin")} /></>}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Account activity</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              Who signed in, changed a password, changed someone&apos;s access or deleted something. Failed sign-ins are kept for 90 days, everything else for two years.
            </p>
          </header>
          {failed ? (
            <div className="cmd-error" role="alert">Can&apos;t load the activity list because the app can&apos;t reach its server. Reload the page in a moment.</div>
          ) : rows == null ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Nothing recorded yet.</div>
          ) : (
            <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th data-tip="The phone, tablet or computer, as it describes itself">Device</th>
                    <th data-tip="The internet address it came from">From</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.action.includes("failed") || r.action.includes("throttled") ? "activity-warn" : ""}>
                      <td className="mono">{new Date(r.at).toLocaleString()}</td>
                      <td>{who(r)}</td>
                      <td>
                        {AUDIT_WORDS[r.action] ?? r.action}
                        {r.target?.startsWith("email:") && <span className="activity-sub"> · {r.target.slice(6)}</span>}
                        {r.action === "session.signed_out" && r.detail?.device && <span className="activity-sub"> · {describeDevice(r.detail.device).label}</span>}
                      </td>
                      <td>{r.detail?.ua ? describeDevice(r.detail.ua).label : <span className="activity-sub">—</span>}</td>
                      <td className="mono">
                        {r.ip == null ? (
                          "—"
                        ) : r.detail?.ua ? (
                          r.ip
                        ) : (
                          <span className="activity-sub" data-tip={OLD_ADDRESS_TIP}>
                            {r.ip}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
