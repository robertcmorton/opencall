"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { sendToSignIn } from "../../../lib/session";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection, CredentialsNavSection } from "../../../components/AdminNav";

type Item = Awaited<ReturnType<typeof api.notifications>>["items"][number];

/**
 * Security alerts (System Administrators only, 24 Oct 2026): a sign-in from a
 * new device or country, guessing from many addresses at once, one address
 * trying many accounts, one account reading many sheets, the administrator
 * code used from a new address, an assistant connected, someone's access
 * changed, the trap touched. Newest first; red ones are the urgent ones.
 * Each links to the timeline for whoever or wherever it is about.
 */
export default function AdminAlertsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null } | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () =>
    api
      .notifications()
      .then((r) => setItems(r.items))
      .catch(() => setFailed(true));

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) sendToSignIn(router);
        else if (m.role !== "admin") router.replace("/admin");
        else void load();
      })
      .catch(() => setFailed(true));
  }, [router]);

  const markRead = async (ids?: string[]) => {
    await api.markNotificationsRead(ids).catch(() => undefined);
    await load();
  };

  /** Where the timeline for this alert is: the person, else the address. */
  const timelineFor = (n: Item): string | null => {
    const ip = typeof n.detail?.ip === "string" ? n.detail.ip : null;
    if (n.userId) return `/admin/timeline?user=${encodeURIComponent(n.userId)}`;
    if (n.kind === "admin_code.new_address") return "/admin/timeline?actor=admin";
    if (ip) return `/admin/timeline?ip=${encodeURIComponent(ip)}`;
    return null;
  };

  const unread = items?.filter((n) => !n.readAt).length ?? 0;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Alerts" settings={<><AdminNavSection active="alerts" /><CredentialsNavSection me={me} onSignedOut={() => router.replace("/admin")} /></>}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem", display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px" }}>
              <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Alerts</h1>
              <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
                Things worth a look: sign-ins from somewhere new, guessing, the administrator code used from a new address, assistants connected and access changed. Red ones are urgent. Nothing here locks anyone out — you decide.
              </p>
            </div>
            {unread > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => void markRead()}>
                Mark all {unread} as read
              </button>
            )}
          </header>
          {failed ? (
            <div className="cmd-error" role="alert">Can&apos;t load the alerts because the app can&apos;t reach its server. Reload the page in a moment.</div>
          ) : items == null ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Loading…</div>
          ) : items.length === 0 ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Nothing yet. When something needs a look, it shows here and by Alerts in the menu.</div>
          ) : (
            <ul className="alert-list">
              {items.map((n) => {
                const link = timelineFor(n);
                return (
                  <li key={n.id} className={`alert-item ${n.urgent ? "alert-urgent" : ""} ${n.readAt ? "alert-read" : ""}`}>
                    <div className="alert-head">
                      <strong>{n.title}</strong>
                      <span className="alert-when mono">{new Date(n.at).toLocaleString()}</span>
                    </div>
                    {n.body && <p className="alert-body">{n.body}</p>}
                    <div className="alert-actions">
                      {link && (
                        <Link className="btn btn-sm" href={link} style={{ textDecoration: "none" }}>
                          See the timeline
                        </Link>
                      )}
                      {n.readAt ? (
                        <span className="activity-sub">Read{n.readBy ? ` by ${n.readBy}` : ""}</span>
                      ) : (
                        <button type="button" className="btn btn-sm" onClick={() => void markRead([n.id])}>
                          Mark as read
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
