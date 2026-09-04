"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventSummary } from "../lib/api";
import { AccessEditor, GrantChips, GrantPicker, grantKey, grantLabel, type Grant, withPending } from "./AccessGrants";
import { Icon } from "./ui";

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
  const [pending, setPending] = useState<Grant | null>(null);
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
      .createUser({ name: name.trim(), email: email.trim() || undefined, password: password || undefined, grants: withPending(grants, pending) })
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
          {/* `allowAdmin`: this panel is admin-only — the page renders it for
              role "admin" alone — so making another administrator is a choice
              it may offer. The company-facing people list passes false. */}
          <GrantPicker
            companies={companies}
            events={events}
            held={grants}
            allowAdmin
            onAdd={(g) => setGrants((all) => [...all, g])}
            onPending={setPending}
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
            <button className="btn btn-primary btn-sm" onClick={create} disabled={!name.trim() || (grants.length === 0 && !pending)}>
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
                  {grantLabel(g, companies, events)}
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

      {/* The `note` is deliberately not the warning the company-facing people
          list carries. That one shows a slice — a freelancer's other companies
          never leave the server — so it can promise to leave the unseen part
          alone. GET /users has no such filter: what is listed here IS the whole
          of somebody's access, so saying "only what you can see" would be true
          and useless. */}
      {editing && (
        <AccessEditor
          key={editing.id}
          person={editing}
          companies={companies}
          events={events}
          note="This is all of it. Anything taken away here is taken away everywhere — their company, their events, and any other company they work for."
          allowAdmin
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
