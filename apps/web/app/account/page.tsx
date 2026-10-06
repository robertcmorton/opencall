"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, API_URL, type AssistantConnection } from "../../lib/api";
import { sendToSignIn } from "../../lib/session";
import { passwordProblem, PASSWORD_HINT } from "@opencall/core";
import { Icon } from "../../components/ui";

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
        {unreachable ? "The app can't reach its server right now. You are still signed in. Reload the page in a moment." : "Loading…"}
      </main>
    );

  const access =
    me.role === "admin"
      ? "System Administrator. You can open and change every company, event and show."
      : me.role === "company"
        ? `You are signed in for ${me.teamName ?? "your company"}. You can make events, share view-only links and run shows.`
        : me.role === "user"
          ? (me.grants ?? []).length > 0
            ? `What you can do: ${[...new Set((me.grants ?? []).map((g) => ACCESS_WORDS[g.kind] ?? g.kind))].join(", ")}.`
            : "You can't open anything yet. Ask your System Administrator to give you access."
          : "You are not signed in.";

  return (
    <main style={{ maxWidth: 560, margin: "6vh auto", padding: "0 1.2rem", display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-3)" }}>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>My account</h1>
        <span style={{ flex: 1 }} />
        <Link href="/admin" style={{ color: "var(--accent-text)", fontSize: "var(--fs-sm)", display: "inline-block", padding: "4px 0" }}>
          {Icon.arrowLeft} Dashboard
        </Link>
      </div>

      <div className="panel" style={{ display: "grid", gap: "var(--space-2)" }}>
        <div style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          {me.role === "user" ? `${me.name}${me.email ? ` · ${me.email}` : ""}` : me.role === "company" ? me.teamName : me.role === "admin" ? "System Administrator" : "—"}
        </div>
        <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>{access}</div>
      </div>

      {me.role === "user" ? (
        <>
          <form
            className="panel"
            style={{ display: "grid", gap: "var(--space-3)" }}
            onSubmit={(e) => {
              e.preventDefault();
              void api
                .updateMe({ name: name.trim() || undefined, email: email.trim() || undefined })
                .then(() => setSaved("Details saved."))
                .catch((err) => setSaved(err instanceof Error ? err.message : String(err)));
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
            <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
              <button className="btn btn-primary" type="submit">
                Save details
              </button>
              {saved && <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{saved}</span>}
            </div>
          </form>

          <form
            className="panel"
            style={{ display: "grid", gap: "var(--space-3)" }}
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
                  window.alert("Your password is changed. Any other phones or computers signed in as you have been signed out, and so have any AI assistants you connected.");
                })
                .catch((err) => window.alert(err instanceof Error ? err.message : String(err)));
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
          You signed in with {me.role === "admin" ? "an administrator" : me.role === "company" ? "a company" : "an"} access
          token (a long sign-in code), so there is no name, email or password to change here. People who sign in with an
          email and password can change their details on this page.
        </div>
      )}

      <AssistantsPanel />
    </main>
  );
}

/** What each kind of access lets you do, in words, for the summary at the top. */
const ACCESS_WORDS: Record<string, string> = {
  admin: "everything in this app",
  company: "run every event at a company",
  company_view: "look at every event at a company",
  event: "run one event",
  edit: "write the run sheets for one event",
  view: "look at the run sheets for one event",
};

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
    <div className="panel" style={{ display: "grid", gap: "var(--space-3)" }}>
      <strong>AI assistants</strong>
      <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
        You can connect an AI assistant (a chat helper) to your account. It can read your run sheets and, if you say yes,
        change them. It can only reach the sheets you can, and it can never run a show. To connect one, add this web
        address in your assistant&apos;s settings as a new connector, then sign in when it asks:
      </span>
      <code style={{ fontSize: "var(--fs-sm)", padding: "6px 8px", borderRadius: "var(--r-sm)", background: "var(--surface-2, rgba(127,127,127,.12))", overflowWrap: "anywhere" }}>
        {mcpUrl}
      </code>
      {list == null ? (
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>Loading…</span>
      ) : list.length === 0 ? (
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>You have not connected any AI assistants.</span>
      ) : (
        list.map((a) => (
          <div key={a.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px", display: "grid", gap: 2 }}>
              <span>
                {a.name}
                {a.host ? <span style={{ color: "var(--text-3)" }}> · {a.host}</span> : null}
              </span>
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
                {a.scopes.includes("sheets:write") ? "Can read and change your sheets" : "Can read your sheets"}
                {a.scopes.includes("errors:read") ? ", can read the error log" : ""} · connected {day(a.connectedAt)}
                {a.lastUsedAt ? ` · last used ${day(a.lastUsedAt)}` : ""} · stops working {day(a.endsAt)}
              </span>
            </div>
            <button
              className="btn"
              type="button"
              onClick={() => {
                if (!window.confirm(`Disconnect ${a.name}? It will stop working straight away and won't be able to see your sheets.`)) return;
                void api
                  .disconnectAssistant(a.id)
                  .then(load)
                  .catch((err) => window.alert(err instanceof Error ? err.message : String(err)));
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
