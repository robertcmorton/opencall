"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { sendToSignIn } from "../../../lib/session";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection, CredentialsNavSection } from "../../../components/AdminNav";
import { ErrorLogPanel } from "../../../components/ErrorLogPanel";

/** The server error journal on its own page (admin only). */
export default function AdminErrorsPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null } | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) sendToSignIn(router); // no session: the sign-in screen, with the way back
        else if (m.role !== "admin") router.replace("/admin"); // signed in, but this page is the server's
      })
      // A request that FAILED is not a session that has ended. This used to
      // send people to the sign-in screen — and forget their token on the
      // way — whenever the server could not be reached for a moment, which
      // read as being logged out by a click on the menu. Say so and wait.
      .catch(() => setUnreachable(true));
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Error log" settings={<><AdminNavSection active="errors" /><CredentialsNavSection me={me} onSignedOut={() => router.replace("/admin")} /></>}>
        <main className="admin-main">
          {unreachable && (
            <div className="cmd-error" role="alert" style={{ marginBottom: 12 }}>
              Can't reach the sync server — you are still signed in. Reload in a moment.
            </div>
          )}
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Error log</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              Server, process, and browser errors — check regularly, fix what repeats.
            </p>
          </header>
          {me != null && me.role !== "admin" ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>Admins only.</div>
          ) : (
            <ErrorLogPanel onClose={() => router.push("/admin")} />
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
