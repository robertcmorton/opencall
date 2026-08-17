"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type EventSummary } from "../../../lib/api";
import { byDate, byName } from "../../../lib/pickOrder";
import { WithSideNav } from "../../../components/SideNav";
import { AdminNavSection } from "../../../components/AdminNav";
import { UsersPanel } from "../../../components/UsersPanel";
import { PeoplePanel } from "../../../components/PeoplePanel";

/** Users & access on its own page (admin only). */
export default function AdminUsersPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ role: string | null; teamName?: string; canManage?: boolean } | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([]);

  const reload = useCallback(() => {
    api
      .me()
      .then(setMe)
      .catch(() => setMe({ role: null }));
    api
      .events()
      .then((evs) => setEvents(byDate(evs)))
      .catch((err) => {
        // Not signed in (or not allowed) → the dashboard carries the sign-in gate.
        if (err instanceof ApiError && err.status === 401) router.replace("/admin");
      });
    api.companies().then((cs) => setCompanies(byName(cs))).catch(() => setCompanies([]));
  }, [router]);
  useEffect(reload, [reload]);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)" }}>
      <WithSideNav title="Users & access" settings={<AdminNavSection active="users" role={me?.role} />}>
        <main className="admin-main">
          <header style={{ marginBottom: "1.25rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
              Users &amp; access
            </h1>
            <p style={{ color: "var(--text-2)", margin: "2px 0 0", fontSize: "var(--fs-sm)" }}>
              {me?.role === "admin"
                ? "Who has control of what — accounts, passwords, and grants."
                : "Who at your company can open what. People who also work elsewhere keep that to themselves: you see only the access that points at you."}
            </p>
          </header>
          {/* Everyone with people to administer gets the scoped view; an
              administrator additionally gets the whole account database, with
              tokens and passwords, which is a different and larger thing. */}
          {me != null && me.role !== "admin" && me.role !== "company" && !me.canManage ? (
            <div className="panel" style={{ color: "var(--text-2)" }}>
              You do not administer anybody. Ask whoever runs your company to give you access.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <PeoplePanel companyName={me?.role === "company" ? me.teamName : null} companies={companies} />
              {me?.role === "admin" && (
                <div>
                  <h2 style={{ fontSize: "1.05rem", fontWeight: 650, margin: "0 0 8px" }}>Every account on this server</h2>
                  <UsersPanel companies={companies} events={events} />
                </div>
              )}
            </div>
          )}
        </main>
      </WithSideNav>
    </div>
  );
}
