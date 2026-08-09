"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventSummary } from "../lib/api";
import { MissingFields } from "./ui";

/**
 * Who can open what — for a company as well as an administrator.
 *
 * A company only ever sees the access that points at ITSELF. The filtering is
 * done on the server, not here: crew are freelancers who work for several
 * companies at once, and one company being able to read another's roster off
 * a shared person is not a display bug, it is a disclosure. What reaches this
 * component is already only what the viewer is entitled to know.
 *
 * So a person may appear in two companies' lists showing entirely different
 * access in each, and neither knows about the other. That is the intent.
 */
export function PeoplePanel({ companyName }: { companyName?: string | null }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.people>> | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.people().then(setData).catch((e: unknown) => setError(String((e as Error)?.message ?? e)));
    api.events().then(setEvents).catch(() => setEvents([]));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <div className="panel" style={{ borderColor: "var(--over)", color: "var(--over)" }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <InviteForm events={events} mailConfigured={data.mailConfigured} onDone={reload} />

      {data.invites.length > 0 && (
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>Invited, not joined yet</strong>
          {data.invites.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
              <span style={{ minWidth: 200 }}>{i.email}</span>
              <span style={{ color: "var(--text-3)" }}>expires {new Date(i.expiresAt).toLocaleDateString()}</span>
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(i.url)}>
                Copy link
              </button>
              <button
                className="btn btn-sm btn-ghost"
                style={{ color: "var(--over)" }}
                onClick={() => void api.revokeInvite(i.id).then(reload)}
              >
                Withdraw
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <strong>{companyName ? `People at ${companyName}` : "People"}</strong>
        {data.people.length === 0 && <span style={{ color: "var(--text-3)" }}>Nobody yet — invite someone above.</span>}
        {data.people.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
            <strong style={{ minWidth: 150 }}>{p.name}</strong>
            <span style={{ color: "var(--text-2)", minWidth: 200 }}>{p.email}</span>
            {!p.hasPassword && (
              <span className="chip" data-tip="They have not set a password yet — the invitation is still open">
                no password yet
              </span>
            )}
            <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {p.grants.map((g) => (
                <span key={`${g.kind}:${g.targetId}`} className="chip">
                  {g.kind === "company"
                    ? "Whole company"
                    : `${events.find((e) => e.id === g.targetId)?.name ?? "An event"}${g.kind === "view" ? " (view)" : ""}`}
                </span>
              ))}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}

/**
 * Inviting somebody.
 *
 * The access is chosen HERE, by the person who has it to give, and travels
 * with the invitation — so accepting can never grant more than was offered.
 *
 * When there is no mail server the invitation still exists; the link comes
 * back to be passed on by hand. That is the difference between a feature that
 * needs infrastructure and one that merely uses it when it is there.
 */
function InviteForm({
  events,
  mailConfigured,
  onDone,
}: {
  events: EventSummary[];
  mailConfigured: boolean;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<string>("");
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState<{ url?: string; emailed?: boolean; reason?: string; added?: boolean; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missing = [
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && "A valid email address",
    !scope && "What they may open",
  ].filter((v) => typeof v === "string") as string[];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    setResult(null);
    if (missing.length > 0) return;
    const [kind, targetId] = scope.split(":");
    void api
      .createInvite({ email: email.trim().toLowerCase(), grants: [{ kind: kind!, targetId: targetId ?? "" }] })
      .then((r) => {
        setResult(r);
        setEmail("");
        setTried(false);
        onDone();
      })
      .catch((err: unknown) => setError(String((err as Error)?.message ?? err)));
  };

  return (
    <form className="panel field-row" onSubmit={submit}>
      <div style={{ flexBasis: "100%" }}>
        <strong>Invite someone</strong>
        <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          They set their own name and password. What you choose here is exactly what they get.
        </span>
      </div>
      <div>
        <label className="field-label">Email address</label>
        <input
          className={"input " + (tried && missing.includes("A valid email address") ? "field-missing" : "")}
          type="email"
          placeholder="sam@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ minWidth: 240 }}
        />
      </div>
      <div>
        <label className="field-label">They may open</label>
        <select
          className={"input " + (tried && !scope ? "field-missing" : "")}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={{ minWidth: 240 }}
        >
          <option value="">Choose…</option>
          <option value="company:">Everything at this company</option>
          {events.length > 0 && (
            <optgroup label="One event only">
              {events.map((ev) => (
                <option key={ev.id} value={`event:${ev.id}`}>
                  {ev.name}
                </option>
              ))}
            </optgroup>
          )}
          {events.length > 0 && (
            <optgroup label="One event, view only">
              {events.map((ev) => (
                <option key={`v${ev.id}`} value={`view:${ev.id}`}>
                  {ev.name} (view only)
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="field-actions">
        <button className="btn btn-primary" type="submit">
          Send invitation
        </button>
      </div>
      {tried && missing.length > 0 && <MissingFields missing={missing} />}
      {error && <div className="missing-fields" style={{ borderColor: "var(--over)" }}>{error}</div>}
      {result?.added && (
        <div className="panel" style={{ flexBasis: "100%" }}>
          <strong>{result.name}</strong> already has an account — the access has been added to it.
        </div>
      )}
      {result?.url && (
        <div className="panel" style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
          <strong>{result.emailed ? "Invitation sent" : "Invitation ready — send this link"}</strong>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
            {result.emailed
              ? "It is on its way. The link works once and expires in seven days."
              : mailConfigured
                ? `The email could not be sent (${result.reason}). Pass this link on instead — it is still valid.`
                : "No mail server is set up on this install, so pass this link on however you like. It works once and expires in seven days."}
          </span>
          <code style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 8px", borderRadius: 4, wordBreak: "break-all" }}>
            {result.url}
          </code>
          <div>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => void navigator.clipboard.writeText(result.url!)}>
              Copy link
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
