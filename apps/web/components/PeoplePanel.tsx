"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventSummary } from "../lib/api";
import { byDate } from "../lib/pickOrder";
import { AccessEditor, grantKey, grantLabel, type Grant } from "./AccessGrants";
import { MissingFields } from "./ui";
import { ConfirmButton } from "./ConfirmButton";

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
export function PeoplePanel({
  companyName,
  /**
   * Every company the viewer may hand out, for naming one in an invitation.
   *
   * Only an admin is given a list: a company signed in as itself has exactly
   * one and being asked which would be a strange question, so its invitations
   * carry an empty id that the server resolves to whoever asked. Empty here
   * therefore means "you have no choice to make", not "we could not load it".
   */
  companies = [],
}: {
  companyName?: string | null;
  companies?: { id: string; name: string }[];
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.people>> | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; grants: Grant[] } | null>(null);

  const reload = useCallback(() => {
    api.people().then(setData).catch((e: unknown) => setError(String((e as Error)?.message ?? e)));
    api.events().then((evs) => setEvents(byDate(evs))).catch(() => setEvents([]));
  }, []);
  useEffect(reload, [reload]);

  if (error) return <div className="panel" style={{ borderColor: "var(--over)", color: "var(--over)" }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
      <InviteForm events={events} companies={companies} mailConfigured={data.mailConfigured} onDone={reload} />

      {data.invites.length > 0 && (
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <strong>Invited, not joined yet</strong>
          {data.invites.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
              <span style={{ minWidth: 200 }}>{i.email}</span>
              <span style={{ color: "var(--text-3)" }}>link stops working {new Date(i.expiresAt).toLocaleDateString()}</span>
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(i.url)} data-tip="Copy their invitation link, so you can send it to them yourself">
                Copy link
              </button>
              <ConfirmButton
                className="btn btn-sm btn-ghost"
                style={{ color: "var(--over)" }}
                label="Cancel invitation"
                confirmLabel="Press again to cancel it"
                onConfirm={() => void api.revokeInvite(i.id).then(reload)}
                data-tip="Cancel this invitation. The link stops working straight away."
              />
            </div>
          ))}
        </section>
      )}

      <section className="panel" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
        <strong>{companyName ? `People at ${companyName}` : "People"}</strong>
        {data.people.length === 0 && <span style={{ color: "var(--text-3)" }}>Nobody yet. Invite someone using the form above.</span>}
        {data.people.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
            <strong style={{ minWidth: 150 }}>{p.name}</strong>
            <span style={{ color: "var(--text-2)", minWidth: 200 }}>{p.email}</span>
            {!p.hasPassword && (
              <span className="chip" data-tip="They haven't chosen a password yet, so they haven't finished joining">
                no password yet
              </span>
            )}
            <span style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
              {p.grants.map((g) => (
                <span key={grantKey(g)} className="chip">
                  {grantLabel(g, companies, events)}
                </span>
              ))}
            </span>
            {/* Access stopped being permanent. Somebody put on the wrong event
                had to be deleted and invited again, which loses their password
                and their history for a typo. */}
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)} data-tip="Choose which events this person can open">
              Change access
            </button>
          </div>
        ))}
      </section>

      {/* `allowAdmin` is off and belongs off: a company handing out `admin`
          would be a company granting itself the whole installation, which
          grantInScope() in apps/sync/src/scope.ts refuses — and the PATCH
          refuses the whole edit when one grant is refused, so the option would
          cost the rest of it. An administrator, who may do it, has the account
          database below this panel.
          The `note` is the wording this screen needs and the account database
          must not use; the shared editor says why. */}
      {editing && (
        <AccessEditor
          key={editing.id}
          person={editing}
          companies={companies}
          events={events}
          note="You only see their access at your company, and only that changes. If they also work for another company, that stays as it is."
          allowAdmin={false}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
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
  companies,
  onDone,
}: {
  events: EventSummary[];
  companies: { id: string; name: string }[];
  mailConfigured: boolean;
  onDone: () => void;
}) {
  const [email, setEmail] = useState("");
  const [scope, setScope] = useState<string>("");
  const [tried, setTried] = useState(false);
  const [result, setResult] = useState<{ url?: string; emailed?: boolean; reason?: string; added?: boolean; name?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const missing = [
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && "A complete email address",
    !scope && "What they can open",
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
          We send them a link. They choose their own name and password. They can open exactly what you pick here, and
          nothing else.
        </span>
      </div>
      <div>
        <label className="field-label">Email address</label>
        <input
          className={"input " + (tried && missing.includes("A complete email address") ? "field-missing" : "")}
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
          aria-label="They may open"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={{ minWidth: 240 }}
        >
          <option value="">Choose…</option>
          {/* Which company, when there is more than one to mean.
              This offered a single "Everything at this company" carrying an
              empty id. For a company signing in as itself that is right — it
              has one, and the server fills the id in. For an admin, who can
              reach every company, there was no way to say which, and the empty
              id was not refused: it was written down as a grant that matches
              nothing, or failed the invitation outright. */}
          {companies.length > 0 ? (
            <optgroup label="Showcaller — runs every event at one company">
              {companies.map((c) => (
                <option key={c.id} value={`company:${c.id}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          ) : (
            <option value="company:">Everything at this company</option>
          )}
          {events.length > 0 && (
            <optgroup label="Showcaller — runs one event">
              {events.map((ev) => (
                <option key={ev.id} value={`event:${ev.id}`}>
                  {ev.name}
                </option>
              ))}
            </optgroup>
          )}
          {events.length > 0 && (
            <optgroup label="Producer — writes the run sheets for one event, but can't start the show">
              {events.map((ev) => (
                <option key={`e${ev.id}`} value={`edit:${ev.id}`}>
                  {ev.name} — Producer
                </option>
              ))}
            </optgroup>
          )}
          {events.length > 0 && (
            <optgroup label="Crew — can look at the run sheets for one event">
              {events.map((ev) => (
                <option key={`v${ev.id}`} value={`view:${ev.id}`}>
                  {ev.name} — Crew
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
          <strong>{result.name}</strong> already has an account, so we added this access to it. They don&apos;t need to do anything.
        </div>
      )}
      {result?.url && (
        <div className="panel" style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <strong>{result.emailed ? "Invitation sent" : "Invitation ready. Send them this link."}</strong>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
            {result.emailed
              ? "The email is on its way. The link works once, and stops working after seven days."
              : mailConfigured
                ? `We couldn't send the email (${result.reason}). Send them this link yourself instead. It still works.`
                : "This app can't send emails, so send them this link yourself, in any message. The link works once, and stops working after seven days."}
          </span>
          <code style={{ background: "var(--bg)", border: "1px solid var(--border)", padding: "6px 8px", borderRadius: "var(--r-xs)", wordBreak: "break-all" }}>
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
