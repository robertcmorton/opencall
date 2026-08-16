"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getAdminToken, setAdminToken } from "../lib/api";
import { BrandWordmark } from "../components/ui";

const ROUTE_BY_ROLE = { caller: "show", editor: "edit", follower: "view" } as const;

/**
 * A screen that refused a connection sends people here with `?next=` so they
 * land back where they were trying to go. Only same-site paths are honoured —
 * `//host` would leave the site entirely, so it is rejected.
 */
const safeNext = (value: string | null): string | null =>
  value && value.startsWith("/") && !value.startsWith("//") ? value : null;

/** Personal/company/admin access tokens are pasted here too — they start with a known prefix. */
const looksLikeAccessToken = (v: string): boolean => /^(usr_|co_|oc_)/i.test(v);

/**
 * Landing: crew enter their join code and land on the screen their role
 * allows — Showcaller (full console), Edit (content only), or View
 * (read-only). Access tokens (personal, company, admin) work here too and
 * lead to the dashboard. Admins head to /admin.
 */
export default function Landing() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [next, setNext] = useState<string | null>(null);

  // Read after mount: this page prerenders, and reading the query string during
  // render would disagree with the server-rendered HTML.
  useEffect(() => {
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, []);

  const submitLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoginBusy(true);
    setLoginError(null);
    api
      .login(email.trim(), password)
      .then(({ token }) => {
        setAdminToken(token);
        router.push(next ?? "/admin");
      })
      .catch((err) => {
        setLoginError(
          err instanceof Error && err.message.includes("429")
            ? "Too many attempts — wait a minute and try again."
            : "Invalid email or password.",
        );
        setLoginBusy(false);
      });
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = code.trim();
    if (!raw) return;
    setBusy(true);
    setError(null);

    if (looksLikeAccessToken(raw)) {
      // An access token, not a join code: sign in with it (tokens are
      // case-sensitive — use exactly what was pasted) and head to the dashboard.
      const previous = getAdminToken();
      setAdminToken(raw);
      api
        .me()
        .then((me) => {
          if (me.role == null) {
            setAdminToken(previous);
            setError("That access token isn't valid (or has been rotated). Check with your admin.");
            setBusy(false);
            return;
          }
          router.push(next ?? "/admin");
        })
        .catch(() => {
          setAdminToken(previous);
          setError("Couldn't verify that token — is the server reachable?");
          setBusy(false);
        });
      return;
    }

    const joinCode = raw.toUpperCase();
    api
      .resolveCode(joinCode)
      .then(({ role, rundownId }) => {
        router.push(`/${ROUTE_BY_ROLE[role]}/${rundownId}?code=${encodeURIComponent(joinCode)}`);
      })
      .catch(() => {
        setError("That code isn't valid (or has been revoked). Check with your showcaller.");
        setBusy(false);
      });
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 28,
        padding: "2rem 1.2rem",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ margin: 0 }}>
          <BrandWordmark size={32} />
        </h1>
        <p style={{ color: "var(--text-2)", margin: "6px 0 0" }}>
          Rundowns, show calling, and companion screens for live events.
        </p>
      </div>

      <form onSubmit={submit} className="panel" style={{ width: "min(420px, 92vw)", display: "grid", gap: 12 }}>
        <div>
          <label className="field-label">Join a show — or sign in</label>
          <input
            className="input mono"
            autoFocus
            size={1}
            placeholder="Join code or access token"
            style={{
              width: "100%",
              minWidth: 0,
              fontSize: "1.05rem",
              letterSpacing: looksLikeAccessToken(code.trim()) ? "0.02em" : "0.15em",
              textTransform: looksLikeAccessToken(code.trim()) ? "none" : "uppercase",
            }}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={64}
          />
        </div>
        {error && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={busy || !code.trim()}>
          {busy ? "Checking…" : "Join"}
        </button>
        <p style={{ margin: 0, color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          A code opens the run sheet <strong>read-only</strong> — that is the only thing a code does. Running or
          editing a show needs an account, because a code gets photographed off a wall and forwarded out of a group
          chat. Personal and company tokens (<code>usr_…</code>, <code>co_…</code>) sign you in to the dashboard.
          {/* An administrator's token still works in this box — the server decides
              what a token is worth, not this sentence. It is simply not named
              here: this is the public face of the app, and it should describe
              what an ordinary member of a crew needs, not enumerate the levels
              of access above them. The list was wrong anyway — three kinds of
              token, two prefixes. */}
        </p>
      </form>

      <form onSubmit={submitLogin} className="panel" style={{ width: "min(420px, 92vw)", display: "grid", gap: 10 }}>
        <label className="field-label" style={{ margin: 0 }}>
          Sign in with an account
        </label>
        <input
          className="input"
          type="email"
          autoComplete="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {loginError && <div style={{ color: "var(--over)", fontSize: "var(--fs-sm)" }}>{loginError}</div>}
        <button className="btn" type="submit" disabled={loginBusy || !email.trim() || !password}>
          {loginBusy ? "Signing in…" : "Sign in"}
        </button>
        <p style={{ margin: 0, color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>
          Accounts are created by your admin. No password yet? Your personal access token works in the box above.
        </p>
      </form>

      {/* No link to the admin dashboard, deliberately — do not add one back.
          The sign-in page is the most public surface this app has: it is what
          a stranger, a search crawler, or anyone handed a view-only link sees
          first, and it has no business naming the administrative surface or
          pointing at it. An administrator knows where their own dashboard is
          and can sign in here or go straight to it; nobody else needs telling
          it exists. This removes a signpost, not a lock — the lock is the
          server, which refuses every administrative read without a token. */}
    </main>
  );
}
