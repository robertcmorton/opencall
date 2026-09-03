"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventTypeSpec } from "@opencall/core";
import { api, ApiError } from "../../../lib/api";
import { sendToSignIn } from "../../../lib/session";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection, CredentialsNavSection } from "../../../components/AdminNav";
import { EventTypesPanel, ImportedSheetsPanel } from "../../../components/EventTypesPanel";

/**
 * Kinds of show, and the sheets they were run from.
 *
 * One page because they are one subject: what a kind of show is, and the
 * evidence for whether the app reads that kind of sheet properly.
 */
export default function AdminEventTypesPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null; canManage?: boolean } | null>(null);
  const [custom, setCustom] = useState<EventTypeSpec[]>([]);

  const reload = useCallback(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe({ role: null }));
    api.eventTypes().then(setCustom).catch(() => setCustom([]));
    api.events().catch((err) => {
      // No session, or a dead one → the sign-in screen, with the way back.
      if (err instanceof ApiError && err.status === 401) sendToSignIn(router);
    });
  }, [router]);
  useEffect(reload, [reload]);

  const mayManage = me == null || me.role === "admin" || me.role === "company" || Boolean(me.canManage);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Kinds of show" settings={<><AdminNavSection active="event-types" role={me?.role} /><CredentialsNavSection me={me} onSignedOut={reload} /></>}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Kinds of show</h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              What a run sheet is for decides how it can end. Each sheet carries its own, so one event can hold two
              sports at once.
            </p>
          </header>
          {mayManage ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <EventTypesPanel />
              <ImportedSheetsPanel custom={custom} />
            </div>
          ) : (
            <div className="panel" style={{ color: "var(--text-2)" }}>
              Ask whoever runs your company to add a kind of show.
            </div>
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
