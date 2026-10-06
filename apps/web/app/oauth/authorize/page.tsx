"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, getAdminToken, type AssistantRequest } from "../../../lib/api";
import { signInPath } from "../../../lib/session";

/**
 * "Allow this assistant?" — where an AI assistant sends a person to approve
 * its connection to their account. It reads only what the account can, and
 * changes only what the account can, so the page says whose account it is.
 */
export default function AuthorizePage() {
  const router = useRouter();
  const [params, setParams] = useState<Record<string, string> | null>(null);
  const [request, setRequest] = useState<AssistantRequest | null>(null);
  const [ticked, setTicked] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!getAdminToken()) {
      router.replace(signInPath(window.location.pathname, window.location.search));
      return;
    }
    const p = Object.fromEntries(new URLSearchParams(window.location.search));
    setParams(p);
    void api
      .authorizeCheck(p)
      .then((r) => {
        if (r.redirect) {
          window.location.replace(r.redirect);
          return;
        }
        setRequest(r);
        setTicked((r.scopes ?? []).filter((s) => s.available).map((s) => s.key));
      })
      .catch((err: unknown) => setProblem(err instanceof Error ? err.message : String(err)));
  }, [router]);

  const decide = (allow: boolean) => {
    if (!params) return;
    setBusy(true);
    void api
      .authorizeDecide(params, allow, ticked)
      .then((r) => window.location.assign(r.redirect))
      .catch((err: unknown) => {
        setBusy(false);
        setProblem(err instanceof Error ? err.message : String(err));
      });
  };

  const shell = (children: React.ReactNode) => (
    <main style={{ maxWidth: 520, margin: "8vh auto", padding: "0 1.2rem", display: "grid", gap: 14 }}>{children}</main>
  );

  if (problem || request?.fatal)
    return shell(
      <div className="panel" style={{ display: "grid", gap: 8 }}>
        <strong>This assistant can&apos;t be connected</strong>
        <span style={{ color: "var(--text-2)" }}>{request?.fatal ?? problem}</span>
      </div>,
    );
  if (!request?.client) return shell(<div style={{ color: "var(--text-3)", textAlign: "center" }}>Loading…</div>);

  const { client, account, scopes = [] } = request;
  return shell(
    <>
      <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Connect {client.name} to OpenCall?</h1>
      <div className="panel" style={{ display: "grid", gap: 4, fontSize: "var(--fs-sm)" }}>
        <span style={{ color: "var(--text-2)" }}>
          It will work as <strong>{account?.name ?? account?.email ?? "you"}</strong>
          {account?.name && account.email ? ` (${account.email})` : ""}. It can only open the sheets you can open.
        </span>
        <span style={{ color: "var(--text-3)" }}>
          {client.loopbackOnly
            ? "It is an app running on this computer."
            : client.host
              ? `After you answer, you go back to ${client.host}.`
              : null}
        </span>
      </div>

      <div className="panel" style={{ display: "grid", gap: 12 }}>
        <strong>It wants to:</strong>
        {scopes.map((s) => (
          <label key={s.key} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", alignItems: "start", opacity: s.available ? 1 : 0.6 }}>
            <input
              type="checkbox"
              checked={ticked.includes(s.key)}
              disabled={!s.available || (s.key === "sheets:read" && ticked.includes("sheets:write"))}
              onChange={(e) => setTicked((t) => (e.target.checked ? [...t, s.key] : t.filter((k) => k !== s.key)))}
              style={{ marginTop: 4 }}
            />
            <span>{s.title}</span>
            <span />
            <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
              {s.available ? s.detail : (s.whyNot ?? "Your account can't do this, so you can't let the assistant do it either.")}
            </span>
          </label>
        ))}
      </div>

      <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--text-2)", fontSize: "var(--fs-sm)", display: "grid", gap: 4 }}>
        <li>It can never start a show, move it on, or stop it.</li>
        <li>While a show is running, it can only change words and strike rows.</li>
        <li>It can&apos;t change a sheet while someone else is editing it.</li>
        <li>Before each change it makes, a copy of the sheet is saved in Version history, so you can always undo it.</li>
        <li>You can disconnect it at any time from My account.</li>
      </ul>

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button className="btn" type="button" disabled={busy} onClick={() => decide(false)}>
          Don&apos;t allow
        </button>
        <button className="btn btn-primary" type="button" disabled={busy || ticked.length === 0} onClick={() => decide(true)}>
          Allow
        </button>
      </div>
    </>,
  );
}
