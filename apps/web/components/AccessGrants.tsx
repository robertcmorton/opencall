"use client";

import { useEffect, useState, type ReactNode } from "react";
import { api, type EventSummary } from "../lib/api";
import { PanelModal } from "./SharePanels";

/**
 * Granting access, on every screen that grants it.
 *
 * There were two of everything in here: the company-facing people list had its
 * own label function and its own editor, the administrator's account database
 * had another pair, and they had drifted — different words for the same grant,
 * and a duplicate-grant refusal on one screen only. They were never meant to be
 * two; they became two because the two panels were written separately.
 *
 * One thing they must NOT share is the warning about what saving reaches, and
 * that is the `note` prop on the editor below.
 */

/** One row of user_grants: how far the reach goes, and what it points at. */
export interface Grant {
  kind: string;
  targetId: string;
}

/** A company, named. All either screen is told about one. */
type Company = { id: string; name: string };

/** The row a grant occupies in the database: (user, kind, target). */
export const grantKey = (g: Grant): string => `${g.kind}:${g.targetId}`;

/**
 * The kinds of reach, in words.
 *
 * Phrased to match the optgroups on the invitation form on the same page
 * ("Everything at one company", "One event, view only"), because it is the
 * same question asked of the same two lists. They used to be written for an
 * administrator — "Company — manage its events & below" — which was fine while
 * this picker only appeared on the account database; it is now also on the
 * company-facing people list, where "& below" is jargon for the reader.
 */
const KIND_LABEL: Record<string, string> = {
  admin: "Everything on this server",
  company: "Everything at one company",
  event: "One event only",
  view: "One event, view only",
};

/**
 * What a grant is called, on screen.
 *
 * ONE wording, because the same access has to read the same everywhere. There
 * were two and they disagreed: the people list printed the target's bare name
 * ("Acme"), the account database printed the internal kind word in front of it
 * ("company: Acme"). The first could not tell a company grant from an event of
 * the same name — it guarded against confusing two companies and introduced
 * confusing a company with an event — and the second showed a database column
 * to the reader.
 *
 * The words are the server's own: describeGrants() in apps/sync/src/api.ts
 * writes "everything at <company>" and "<event> (view only)" into invitation
 * emails and onto the accept screen. So what somebody is offered when they are
 * invited is what the chip says about them afterwards.
 *
 * The fallbacks generalise instead of saying "unknown", because a name missing
 * here is ordinary rather than broken. Both screens are given `api.events()`,
 * which leaves ARCHIVED events out (GET /events skips them without
 * ?archived=1), and neither archiving nor DELETE /events removes the grants
 * pointing at the event — so a grant can outlive the name of what it points at.
 * "unknown event", which is what the account database used to print, sends the
 * reader looking for a fault that is not there.
 */
export function grantLabel(g: Grant, companies: Company[], events: EventSummary[]): string {
  if (g.kind === "admin") return "Everything on this server";
  if (g.kind === "company") {
    const name = companies.find((c) => c.id === g.targetId)?.name;
    return name ? `Everything at ${name}` : "A whole company";
  }
  const name = events.find((e) => e.id === g.targetId)?.name ?? "An event";
  return g.kind === "view" ? `${name} (view only)` : name;
}

/** The grants on a form, each with a way to take it off again. */
export function GrantChips({
  grants,
  companies,
  events,
  onRemove,
}: {
  grants: Grant[];
  companies: Company[];
  events: EventSummary[];
  onRemove: (g: Grant) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {grants.map((g) => (
        <span key={grantKey(g)} className="chip">
          {grantLabel(g, companies, events)}
          {/* The two copies differed here in the glyph (× against ✕) and in
              whether the button had a fixed height. Nothing depended on either,
              and one of them had to win. */}
          <button
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: 6, height: 18, padding: "0 4px" }}
            data-tip="Take this away"
            onClick={() => onRemove(g)}
          >
            ✕
          </button>
        </span>
      ))}
    </div>
  );
}

/** The grants to send: what was added, plus a complete choice nobody added. */
export const withPending = (grants: Grant[], pending: Grant | null): Grant[] =>
  pending && !grants.some((g) => grantKey(g) === grantKey(pending)) ? [...grants, pending] : grants;


/**
 * Choosing one grant: how far the reach goes, and — unless it is everything —
 * which company or event it points at.
 *
 * Shared by the create-user form and the access editor because it is the same
 * question in both, asked of the same two lists.
 *
 * `held` is what the caller already has, and Add refuses a repeat rather than
 * appending it. user_grants is keyed on (user, kind, target), and POST /users
 * inserts each grant with no on-conflict clause — so choosing the same access
 * twice created the account and then failed the request on the second insert,
 * leaving a user with half their access and an error on screen. The people list
 * used to drop the repeat silently instead, which is safe but says nothing; the
 * refusal is the behaviour worth keeping.
 */
export function GrantPicker({
  companies,
  events,
  held,
  allowAdmin,
  onAdd,
  onPending,
}: {
  companies: Company[];
  events: EventSummary[];
  held: Grant[];
  /**
   * Whether "Everything on this server" is on offer. No default: this is a
   * privilege gate, and a gate that opens when nobody mentions it is not one.
   *
   * Off for the company-facing screen. grantInScope() in apps/sync/src/scope.ts
   * refuses an `admin` grant from any caller that is not itself an
   * administrator, and PATCH /users/:id/grants refuses the WHOLE request when
   * one grant is refused — so offering it there would build an edit that loses
   * the rest of itself when saved.
   */
  allowAdmin: boolean;
  onAdd: (g: Grant) => void;
  /**
   * A choice that is complete but has not been added. Saving counts it: on
   * production an administrator chose an event for someone, pressed Save, and
   * nothing changed — "Add access" had never been pressed, because it was not
   * obvious that choosing and adding were two different things.
   */
  onPending?: (g: Grant | null) => void;
}) {
  const [wanted, setWanted] = useState<string>("view");
  const [target, setTarget] = useState("");

  // Only the kinds this caller could actually finish. A company with no events
  // yet is the ordinary case: "One event only" and "One event, view only" both
  // led to an empty "Choose event…" and an Add button that stayed disabled with
  // nothing saying why. The single select the people list used to carry left
  // such a group out entirely, which is the behaviour kept here.
  const kinds = Object.keys(KIND_LABEL).filter((k) =>
    k === "admin" ? allowAdmin : k === "company" ? companies.length > 0 : events.length > 0,
  );
  // Derived from `kinds` rather than trusted from state: both lists arrive from
  // a fetch that can land after this first renders, so a kind chosen — or
  // defaulted to — while a list was still empty must not survive it filling.
  const kind = kinds.includes(wanted) ? wanted : (kinds[0] ?? "");

  // Neither of today's two callers can reach this: the account database always
  // passes allowAdmin, and the people list cannot load at all for anyone
  // without a company grant (peopleScope() in apps/sync/src/api.ts answers 401,
  // so the panel shows the error instead of a person), which means its company
  // list is never empty. It is here so that a third caller cannot end up
  // rendering an empty select above a button that does nothing.
  if (kinds.length === 0)
    return (
      <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
        Nothing to give yet — make a company or an event first.
      </span>
    );

  const chosen: Grant = { kind, targetId: kind === "admin" ? "" : target };
  const incomplete = kind !== "admin" && !target;
  const already = !incomplete && held.some((g) => grantKey(g) === grantKey(chosen));
  // A complete choice nobody has added yet — the thing Save must not lose.
  const pending = !incomplete && !already && kind !== "admin" ? chosen : null;
  const pendingKey = pending ? grantKey(pending) : null;
  useEffect(() => {
    onPending?.(pending);
    // grantKey is the identity; the object itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  const add = () => {
    if (incomplete || already) return;
    onAdd(chosen);
    setTarget("");
  };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {/* Changing the kind clears the target. Companies and events are two
          different lists of ids: picking an event and then switching to
          "Company" left the event's id in place, and because the second select
          has no option matching it the box showed nothing chosen while Add
          stayed enabled — one click away from a company grant pointing at an
          event, which the server has no way to recognise as wrong. */}
      <select
        className="input"
        value={kind}
        onChange={(e) => {
          setWanted(e.target.value);
          setTarget("");
        }}
      >
        {kinds.map((k) => (
          <option key={k} value={k}>
            {KIND_LABEL[k]}
          </option>
        ))}
      </select>
      {kind === "company" && (
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose company…</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {(kind === "event" || kind === "view") && (
        <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose event…</option>
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name}
            </option>
          ))}
        </select>
      )}
      <button className="btn btn-sm" onClick={add} disabled={incomplete || already}>
        Add access
      </button>
      {/* Said out loud rather than as a tooltip: a disabled button takes no
          pointer events, so anything hung off hover never appears — the button
          would simply go dead with no reason given. */}
      {already && <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>They already have this.</span>}
      {incomplete && (
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>Choose which {kind === "company" ? "company" : "event"} first.</span>
      )}
      {pending && <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>Included when you save.</span>}
    </div>
  );
}

/**
 * Changing what one person may open.
 *
 * Sends back only the grants it was shown; the server keeps the rest and works
 * out the removals itself (PATCH /users/:id/grants → mergeGrants). So a company
 * editing a freelancer cannot disturb the other companies that person works
 * for, and is not told they exist.
 *
 * There is no guard against an administrator removing their own admin grant and
 * locking themselves out: this component is not told which account is the
 * signed-in one, and the server does not refuse it either. Deleting yourself
 * from the account list has always been possible for the same reason.
 */
export function AccessEditor({
  person,
  companies,
  events,
  note,
  allowAdmin,
  onClose,
  onSaved,
}: {
  person: { id: string; name: string; grants: Grant[] };
  companies: Company[];
  events: EventSummary[];
  /**
   * What saving here reaches, in words — the one thing the two screens must not
   * share, so the caller supplies it.
   *
   * The company-facing list shows a slice: /people hands over only the grants
   * pointing at the viewer's own companies, and the PATCH keeps the rest, so
   * that screen can promise to leave the unseen part alone. The account
   * database has no such filter — what it lists IS the whole of somebody's
   * access, and taking a chip off takes it away everywhere. "Only the access
   * you can see is changed" is true on both screens and useful on one.
   */
  note: ReactNode;
  /** Passed through to the picker; see GrantPicker's own note on why. */
  allowAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grants, setGrants] = useState<Grant[]>(person.grants);
  const [pending, setPending] = useState<Grant | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    api
      .patchUserGrants(person.id, withPending(grants, pending))
      .then(onSaved)
      .catch((e: unknown) => {
        setError(String((e as Error)?.message ?? e));
        setBusy(false);
      });
  };

  return (
    <PanelModal onClose={onClose}>
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 340, maxWidth: 560 }}>
        <strong>What {person.name} may open</strong>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>{note}</span>

        {grants.length === 0 ? (
          <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>
            Nothing — they will not be able to open anything.
          </span>
        ) : (
          <GrantChips
            grants={grants}
            companies={companies}
            events={events}
            onRemove={(g) => setGrants(grants.filter((x) => grantKey(x) !== grantKey(g)))}
          />
        )}

        <GrantPicker
          companies={companies}
          events={events}
          held={grants}
          allowAdmin={allowAdmin}
          onAdd={(g) => setGrants([...grants, g])}
          onPending={setPending}
        />

        {error && <div className="missing-fields" style={{ borderColor: "var(--over)" }}>{error}</div>}

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            {busy ? "Saving…" : "Save access"}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </PanelModal>
  );
}
