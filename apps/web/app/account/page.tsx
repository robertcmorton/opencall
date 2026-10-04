"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, API_URL, type AssistantConnection } from "../../lib/api";
import { sendToSignIn } from "../../lib/session";
import { passwordProblem, PASSWORD_HINT } from "@opencall/core";

/** My account: who I am, what I can access, and my details. */
export default function AccountPage() {
  const [me, setMe] = useState<Awaited<ReturnType<typeof api.me>> | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");

  const router = useRouter();
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    void api
      .me()
      .then((m) => {
        // "My account" with no account: the sign-in screen, and back here after.
        if (m.role == null) {
          sendToSignIn(router);
          return;
        }
        setMe(m);
        setName(m.name ?? "");
        setEmail(m.email ?? "");
      })
      // A request that failed is not a session that has ended: the page
      // says the server is out of reach rather than signing anyone out.
      .catch(() => setUnreachable(true));
  }, [router]);

  if (!me)
    return (
      <main style={{ padding: "4rem", textAlign: "center", color: "var(--text-3)" }}>
        {unreachable ? "Can't reach the sync server — you are still signed in. Reload in a moment." : "Loading…"}
      </main>
    );

  const access =
    me.role === "admin"
      ? "Administrator — full access to every company, event, and show."
      : me.role === "company"
        ? `Company access for ${me.teamName ?? "your company"} — create events and views, run shows.`
        : me.role === "user"
          ? (me.grants ?? []).length > 0
            ? `Access: ${(me.grants ?? []).map((g) => g.kind).join(", ")}`
            : "No grants yet — ask your admin."
          : "Not signed in.";

  return (
    <main style={{ maxWidth: 560, margin: "6vh auto", padding: "0 1.2rem", display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>My account</h1>
        <span style={{ flex: 1 }} />
        <Link href="/admin" style={{ color: "var(--accent-text)", fontSize: "var(--fs-sm)" }}>
          ← Dashboard
        </Link>
      </div>

      <div className="panel" style={{ display: "grid", gap: 6 }}>
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          {me.role === "user" ? `${me.name}${me.email ? ` · ${me.email}` : ""}` : me.role === "company" ? me.teamName : me.role === "admin" ? "System Administrator" : "—"}
        </div>
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>{access}</div>
      </div>

      {me.role === "user" ? (
        <>
          <form
            className="panel"
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              void api
                .updateMe({ name: name.trim() || undefined, email: email.trim() || undefined })
                .then(() => setSaved("Details saved."))
                .catch((err) => setSaved(String(err)));
            }}
          >
            <strong>My details</strong>
            <div>
              <label className="field-label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button className="btn btn-primary" type="submit">
                Save details
              </button>
              {saved && <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{saved}</span>}
            </div>
          </form>

          <form
            className="panel"
            style={{ display: "grid", gap: 10 }}
            onSubmit={(e) => {
              e.preventDefault();
              const problem = passwordProblem(next, email);
              if (problem) {
                window.alert(problem);
                return;
              }
              void api
                .changePassword(current, next)
                .then(() => {
                  setCurrent("");
                  setNext("");
                  window.alert("Password changed. Other signed-in devices and connected assistants were signed out.");
                })
                .catch((err) => window.alert(String(err)));
            }}
          >
            <strong>Change password</strong>
            <div>
              <label className="field-label">Current password</label>
              <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <label className="field-label">New password ({PASSWORD_HINT.toLowerCase()})</label>
              <input className="input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} style={{ width: "100%" }} />
            </div>
            <div>
              <button className="btn btn-primary" type="submit">
                Change password
              </button>
            </div>
          </form>
        </>
      ) : (
        <div className="panel" style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          You're signed in with a {me.role === "admin" ? "server admin" : me.role === "company" ? "company" : ""} token —
          token sign-ins have no editable profile. Email accounts (created under Users &amp; access) can edit their name,
          email, and password here.
        </div>
      )}

      <AssistantsPanel />
    </main>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/**
 * AI assistants connected to this account, and how to connect one. Only an
 * account (signed in with email, or its personal token) can have them; for a
 * company or server token the list is refused and the panel stays away.
 */
function AssistantsPanel() {
  const [list, setList] = useState<AssistantConnection[] | null>(null);
  const [refused, setRefused] = useState(false);
  const load = () =>
    void api
      .assistants()
      .then((r) => setList(r.assistants))
      .catch(() => setRefused(true));
  useEffect(load, []);
  if (refused) return null;
  const mcpUrl = `${API_URL}/mcp`;
  return (
    <div className="panel" style={{ display: "grid", gap: 10 }}>
      <strong>AI assistants</strong>
      <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
        An assistant such as Claude can read your run sheets and, if you allow it, change them — only the sheets you can, never
        running the show. To connect one, add a custom connector with this address and sign in when it asks:
      </span>
      <code style={{ fontSize: "var(--fs-sm)", padding: "6px 8px", borderRadius: 6, background: "var(--surface-2, rgba(127,127,127,.12))", overflowWrap: "anywhere" }}>
        {mcpUrl}
      </code>
      {list == null ? (
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>Loading…</span>
      ) : list.length === 0 ? (
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>No assistants connected.</span>
      ) : (
        list.map((a) => (
          <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", display: "grid", gap: 2 }}>
              <span>
                {a.name}
                {a.host ? <span style={{ color: "var(--text-3)" }}> · {a.host}</span> : null}
              </span>
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                {a.scopes.includes("sheets:write") ? "Reads and changes sheets" : "Reads sheets"} · connected {day(a.connectedAt)}
                {a.lastUsedAt ? ` · last used ${day(a.lastUsedAt)}` : ""} · ends {day(a.endsAt)}
              </span>
            </div>
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (!window.confirm(`Disconnect ${a.name}? It will stop working at once.`)) return;
                void api
                  .disconnectAssistant(a.id)
                  .then(load)
                  .catch((err) => window.alert(String(err)));
              }}
            >
              Disconnect
            </button>
          </div>
        ))
      )}
    </div>
  );
}
