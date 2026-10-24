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
  const [lockdown, setLockdownState] = useState<{ on: boolean; since: string | null; by: string | null } | null>(null);
  const [arming, setArming] = useState(false);
  const [lockNote, setLockNote] = useState<string | null>(null);

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
        else {
          void load();
          void api.lockdown().then(setLockdownState).catch(() => undefined);
        }
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

  /**
   * Lockdown asks twice, like Stop: the first press arms it and says what it
   * will do; the second does it. Ending it is one press.
   */
  const pressLockdown = async () => {
    if (!lockdown?.on && !arming) {
      setArming(true);
      return;
    }
    setArming(false);
    try {
      const r = await api.setLockdown(!lockdown?.on);
      setLockdownState(r);
      setLockNote(
        r.on
          ? `Locked down. ${r.sessionsEnded} sign-in session${r.sessionsEnded === 1 ? "" : "s"} ended; view-only links and AI assistants are off.`
          : "Lockdown ended. View-only links and AI assistants work again; anyone signed out has to sign in again.",
      );
      void load();
    } catch {
      setLockNote("That didn't work — the app can't reach its server. Try again in a moment.");
    }
  };

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
          <section className={`panel lockdown-panel ${lockdown?.on ? "lockdown-on" : ""}`} aria-live="polite">
            <div style={{ flex: "1 1 320px" }}>
              <strong>{lockdown?.on ? "Lockdown is on" : "Lockdown"}</strong>
              <p className="alert-body" style={{ marginTop: 4 }}>
                {lockdown?.on
                  ? `Since ${lockdown.since ? new Date(lockdown.since).toLocaleString() : "a moment ago"}${lockdown.by ? `, by ${lockdown.by}` : ""}. View-only links and AI assistants are off; people signed out by it have to sign in again.`
                  : arming
                    ? "Press again to lock down. Every sign-in except yours ends, every view-only link and AI assistant goes off, and every open screen is disconnected — a show's screens come back only for people who sign in again. The administrator code, company codes and personal tokens still work: change those separately if one of them is the problem."
                    : "For when something is going on: ends every sign-in except yours, turns off every view-only link and AI assistant, and disconnects every open screen. Links come back as they were when you end it."}
              </p>
              {lockNote && <p className="alert-body" role="status">{lockNote}</p>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {arming && (
                <button type="button" className="btn btn-sm" onClick={() => setArming(false)}>
                  Cancel
                </button>
              )}
              <button type="button" className={`btn btn-sm ${lockdown?.on ? "" : "btn-danger"} ${arming ? "armed" : ""}`} onClick={() => void pressLockdown()} disabled={lockdown == null}>
                {lockdown?.on ? "End the lockdown" : arming ? "Press again to lock down" : "Lock everything down"}
              </button>
            </div>
          </section>

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
