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

  useEffect(() => {
    api
      .me()
      .then((m) => {
        setMe(m);
        if (m.role == null) sendToSignIn(router); // no session: the sign-in screen, with the way back
        else if (m.role !== "admin") router.replace("/admin"); // signed in, but this page is the server's
      })
      .catch(() => sendToSignIn(router));
  }, [router]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Error log" settings={<><AdminNavSection active="errors" /><CredentialsNavSection me={me} onSignedOut={() => router.replace("/admin")} /></>}>
        <main className="admin-main">
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
