"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { sendToSignIn } from "../../../lib/session";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection, CredentialsNavSection } from "../../../components/AdminNav";

type Entry = Awaited<ReturnType<typeof api.audit>>[number];

/** What each recorded action means, in words. */
const ACTION_LABEL: Record<string, string> = {
  "login.ok": "Signed in",
  "login.failed": "Failed sign-in",
  "login.throttled": "Sign-in paused (too many attempts)",
  "password.changed": "Changed their password",
  "password.change_failed": "Wrong current password",
  "password.reset_by_admin": "Password reset by an administrator",
  "invite.sent": "Invitation sent",
  "invite.withdrawn": "Invitation withdrawn",
  "invite.accepted": "Accepted an invitation",
  "user.created": "Account created",
  "user.updated": "Account details changed",
  "user.deleted": "Account deleted",
  "access.changed": "Access changed",
  "token.user_rotated": "Personal token replaced",
  "token.company_rotated": "Company token replaced",
  "company.created": "Company created",
  "company.deleted": "Company deleted",
  "event.deleted": "Event deleted",
  "event.archived": "Event archived",
  "sheet.deleted": "Show deleted",
  "sheet.archived": "Show archived",
  "sheet.reimported": "Show re-imported",
  "sheet.viewing_changed": "Show closed or reopened to viewers",
  "code.created": "View-only link created",
  "code.revoked": "View-only link revoked",
  "kind_of_show.deleted": "Kind of show deleted",
  "error_log.cleared": "Error log cleared",
};

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
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) sendToSignIn(router);
        else if (m.role !== "admin") router.replace("/admin");
        else api.audit(300).then(setRows).catch(() => setFailed(true));
      })
      .catch(() => setFailed(true));
  }, [router]);

  const who = (r: Entry) => r.actorName ?? (r.actor === "admin" ? "System Administrator" : r.actor?.startsWith("company:") ? "Company token" : r.actor ? "Account" : "Not signed in");

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Account activity" settings={<><AdminNavSection active="activity" /><CredentialsNavSection me={me} onSignedOut={() => router.replace("/admin")} /></>}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Account activity</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              Sign-ins, passwords, access and anything deleted. Failed sign-ins are kept 90 days, everything else two years.
            </p>
          </header>
          {failed ? (
            <div className="cmd-error" role="alert">Can't load the activity log — is the sync server reachable?</div>
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
                    <th>From</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.action.includes("failed") || r.action.includes("throttled") ? "activity-warn" : ""}>
                      <td className="mono">{new Date(r.at).toLocaleString()}</td>
                      <td>{who(r)}</td>
                      <td>
                        {ACTION_LABEL[r.action] ?? r.action}
                        {r.target?.startsWith("email:") && <span className="activity-sub"> · {r.target.slice(6)}</span>}
                      </td>
                      <td className="mono">{r.ip ?? "—"}</td>
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
