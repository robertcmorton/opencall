"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventSummary } from "../lib/api";
import { PanelModal } from "./SharePanels";
import { Icon } from "./ui";

interface Grant {
  kind: string;
  targetId: string;
}

const KIND_LABEL: Record<string, string> = {
  admin: "Admin — everything",
  company: "Company — manage its events & below",
  event: "Event — manage one event",
  view: "View only — see one event",
};

/** The row a grant occupies in the database: (user, kind, target). */
const grantKey = (g: Grant): string => `${g.kind}:${g.targetId}`;

/** What a grant points at, named wherever the name is to hand. */
function targetName(g: Grant, companies: { id: string; name: string }[], events: EventSummary[]): string {
  if (g.kind === "admin") return "everything";
  if (g.kind === "company") return companies.find((c) => c.id === g.targetId)?.name ?? "unknown company";
  return events.find((e) => e.id === g.targetId)?.name ?? "unknown event";
}

/**
 * Users & access (admin only): the user database — who has control of what.
 * Each user gets a personal access token; grants decide their reach: admin,
 * a whole event company, a single event, or view-only access to an event.
 */
export function UsersPanel({
  companies,
  events,
}: {
  companies: { id: string; name: string }[];
  events: EventSummary[];
}) {
  const [users, setUsers] = useState<
    { id: string; name: string; email: string; accessToken: string | null; hasPassword: boolean; grants: Grant[] }[]
  >([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [grants, setGrants] = useState<Grant[]>([]);
  const [editing, setEditing] = useState<{ id: string; name: string; grants: Grant[] } | null>(null);

  const reload = useCallback(() => {
    api.users().then(setUsers).catch(() => setUsers([]));
  }, []);
  useEffect(reload, [reload]);

  const create = () => {
    if (!name.trim() || grants.length === 0) return;
    if (password && password.length < 8) {
      window.alert("Password must be at least 8 characters (or leave it empty).");
      return;
    }
    void api
      .createUser({ name: name.trim(), email: email.trim() || undefined, password: password || undefined, grants })
      .then(({ accessToken }) => {
        window.alert(
          password
            ? `User created. They sign in with their email and password.\n\nBackup access token (share securely if needed):\n${accessToken}`
            : `User created. Their personal access token (share it securely):\n\n${accessToken}\n\nThey enter it on the sign-in page — or set a password so they can sign in with email.`,
        );
        setName("");
        setEmail("");
        setPassword("");
        setGrants([]);
        setCreating(false);
        reload();
      });
  };

  return (
    <section className="card" style={{ marginBottom: 14, padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0, flex: 1 }}>
          Users & access{" "}
          <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "var(--fs-sm)" }}>
            — who has control of what
          </span>
        </h2>
        <button className="btn btn-sm" onClick={() => setCreating((c) => !c)}>
          {Icon.plus} User
        </button>
      </div>

      {creating && (
        <div className="panel" style={{ margin: "10px 0", display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Email (needed for password sign-in)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 230 }} />
            <input
              className="input"
              type="password"
              placeholder="Password (optional, min 8)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <GrantPicker
            companies={companies}
            events={events}
            held={grants}
            onAdd={(g) => setGrants((all) => [...all, g])}
          />
          {grants.length > 0 && (
            <GrantChips
              grants={grants}
              companies={companies}
              events={events}
              onRemove={(g) => setGrants((all) => all.filter((x) => grantKey(x) !== grantKey(g)))}
            />
          )}
          <div>
            <button className="btn btn-primary btn-sm" onClick={create} disabled={!name.trim() || grants.length === 0}>
              Create user & issue token
            </button>
          </div>
        </div>
      )}

      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {users.map((u) => (
          <li
            key={u.id}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderTop: "1px solid var(--border-subtle)", flexWrap: "wrap" }}
          >
            <strong style={{ minWidth: 140 }}>{u.name}</strong>
            <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>{u.email}</span>
            <span className="chip" title={u.hasPassword ? "Signs in with email + password" : "Token-only — set a password to enable email sign-in"}>
              {u.hasPassword ? "password ✓" : "no password"}
            </span>
            <span style={{ flex: 1, display: "flex", gap: 4, flexWrap: "wrap" }}>
              {u.grants.map((g) => (
                <span key={grantKey(g)} className="chip">
                  {g.kind}: {targetName(g, companies, events)}
                </span>
              ))}
              {u.grants.length === 0 && <span className="chip">no access</span>}
            </span>
            {/* Access was settable once, at creation, and never afterwards: this
                list rendered the grants as plain chips and the picker above only
                fed the create form. Putting somebody on the wrong event meant
                deleting the account and making it again, which throws away their
                password and their token. */}
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)}>
              Change access
            </button>
            {u.accessToken && (
              <button className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(u.accessToken!)}>
                Copy token
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                void api.rotateUserToken(u.id).then(({ accessToken }) => {
                  window.alert(`New token for ${u.name} (the old one stops working):\n\n${accessToken}`);
                  reload();
                })
              }
            >
              Rotate
            </button>
            <button
              className="btn btn-sm btn-ghost"
              title={u.hasPassword ? "Reset this user's password (signs out their devices)" : "Set a password so they can sign in with email"}
              onClick={() => {
                const pw = window.prompt(`${u.hasPassword ? "New" : "Set"} password for ${u.name} (min 8 characters)`);
                if (!pw) return;
                void api
                  .setUserPassword(u.id, pw)
                  .then(() => {
                    window.alert(`Password ${u.hasPassword ? "reset" : "set"} for ${u.name}. Their other sessions were signed out.`);
                    reload();
                  })
                  .catch((err) => window.alert(String(err)));
              }}
            >
              {u.hasPassword ? "Reset password" : "Set password"}
            </button>
            <button className="btn btn-sm btn-danger" onClick={() => void api.deleteUser(u.id).then(reload)}>
              Delete
            </button>
          </li>
        ))}
        {users.length === 0 && (
          <li style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "6px 0" }}>
            No users yet — create one and hand them their personal access token.
          </li>
        )}
      </ul>

      {editing && (
        <UserAccessEditor
          key={editing.id}
          user={editing}
          companies={companies}
          events={events}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

/**
 * Choosing one grant: what kind, and — unless it is admin — which company or
 * event it points at.
 *
 * Shared by the create form and the access editor because it is the same
 * question in both, asked of the same two lists.
 *
 * `held` is what the caller already has, and Add refuses a repeat rather than
 * appending it. user_grants is keyed on (user, kind, target), and POST /users
 * inserts each grant with no on-conflict clause — so choosing the same access
 * twice created the account and then failed the request on the second insert,
 * leaving a user with half their access and an error on screen.
 */
function GrantPicker({
  companies,
  events,
  held,
  onAdd,
}: {
  companies: { id: string; name: string }[];
  events: EventSummary[];
  held: Grant[];
  onAdd: (g: Grant) => void;
}) {
  const [kind, setKind] = useState<string>("view");
  const [target, setTarget] = useState("");

  const chosen: Grant = { kind, targetId: kind === "admin" ? "" : target };
  const incomplete = kind !== "admin" && !target;
  const already = !incomplete && held.some((g) => grantKey(g) === grantKey(chosen));

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
          setKind(e.target.value);
          setTarget("");
        }}
      >
        {Object.entries(KIND_LABEL).map(([k, label]) => (
          <option key={k} value={k}>
            {label}
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
      {already && (
        <span style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)" }}>They already have this.</span>
      )}
    </div>
  );
}

/** The grants on a form, each with a way to take it off again. */
function GrantChips({
  grants,
  companies,
  events,
  onRemove,
}: {
  grants: Grant[];
  companies: { id: string; name: string }[];
  events: EventSummary[];
  onRemove: (g: Grant) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {grants.map((g) => (
        <span key={grantKey(g)} className="chip">
          {g.kind}: {targetName(g, companies, events)}
          <button
            className="btn btn-sm btn-ghost"
            style={{ height: 18, padding: "0 4px" }}
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

/**
 * Changing what one account may open, from the administrator's side.
 *
 * Deliberately not the same warning the company-facing people list carries.
 * That one shows a slice — a freelancer's other companies never leave the
 * server — so it promises to leave the unseen part alone. GET /users has no
 * such filter: what is listed here IS the whole of somebody's access, and
 * taking a chip off takes it away everywhere. Saying "only what you can see"
 * on this screen would be true and useless, because that is all of it.
 *
 * There is no guard against an administrator removing their own admin grant
 * and locking themselves out: this component is not told which account is the
 * signed-in one, and the server does not refuse it either. Deleting yourself
 * with the button two along has always been possible for the same reason.
 */
function UserAccessEditor({
  user,
  companies,
  events,
  onClose,
  onSaved,
}: {
  user: { id: string; name: string; grants: Grant[] };
  companies: { id: string; name: string }[];
  events: EventSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [grants, setGrants] = useState<Grant[]>(user.grants);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setBusy(true);
    setError(null);
    api
      .patchUserGrants(user.id, grants)
      .then(onSaved)
      .catch((e: unknown) => {
        setError(String((e as Error)?.message ?? e));
        setBusy(false);
      });
  };

  return (
    <PanelModal onClose={onClose}>
      <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 340, maxWidth: 560 }}>
        <strong>What {user.name} may open</strong>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          This is all of it. Anything taken away here is taken away everywhere — their company, their events, and any
          other company they work for.
        </span>

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

        <GrantPicker companies={companies} events={events} held={grants} onAdd={(g) => setGrants([...grants, g])} />

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
