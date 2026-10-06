"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type EventSummary } from "../lib/api";
import { AccessEditor, GrantChips, GrantPicker, grantKey, grantLabel, type Grant, withPending } from "./AccessGrants";
import { Icon } from "./ui";
import { passwordProblem, PASSWORD_HINT, PASSWORD_MIN } from "@opencall/core";
import { ConfirmButton } from "./ConfirmButton";
import { askText, say, sayError, showSecret } from "../lib/dialogs";

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
    { id: string; name: string; email: string; hasToken: boolean; hasPassword: boolean; grants: Grant[] }[]
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
    const problem = password ? passwordProblem(password, email) : null;
    if (problem) {
      say(`${problem} (Or leave the password box empty, and they can sign in with an access token instead.)`, "error");
      return;
    }
    void api
      .createUser({ name: name.trim(), email: email.trim() || undefined, password: password || undefined, grants: withPending(grants, pending) })
      .then(({ accessToken }) => {
        void showSecret({
          title: "Account made",
          message: password
            ? "They sign in with their email and password. Here is their access token too: a long sign-in code they can use instead. Keep it private, like a password."
            : "This is their access token, a long sign-in code. Send it to them privately, like a password. They paste it into the box on the front page. Or set them a password so they can sign in with their email.",
          secret: accessToken,
        });
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
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <h2 style={{ fontSize: "1.02rem", fontWeight: 650, margin: 0, flex: 1 }}>
          Users & access{" "}
          <span style={{ color: "var(--text-3)", fontWeight: 400, fontSize: "var(--fs-sm)" }}>
            — who can open and change what
          </span>
        </h2>
        <button className="btn btn-sm" onClick={() => setCreating((c) => !c)} data-tip="Make an account for someone">
          {Icon.plus} User
        </button>
      </div>

      {creating && (
        <div className="panel" style={{ margin: "10px 0", display: "grid", gap: "var(--space-3)" }}>
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
            <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <input className="input" placeholder="Email (needed to sign in with a password)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ minWidth: 230 }} />
            <input
              className="input"
              type="password"
              placeholder={`Password (optional, at least ${PASSWORD_MIN} characters)`}
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
              Create account
            </button>
          </div>
        </div>
      )}

      <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0 }}>
        {users.map((u) => (
          <li
            key={u.id}
            style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", padding: "6px 0", borderTop: "1px solid var(--border-subtle)", flexWrap: "wrap" }}
          >
            <strong style={{ minWidth: 140 }}>{u.name}</strong>
            <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)" }}>{u.email}</span>
            <span className="chip" title={u.hasPassword ? "Signs in with email and password" : "Can only sign in with an access token. Set a password so they can sign in with their email."}>
              {u.hasPassword ? "password ✓" : "no password"}
            </span>
            <span style={{ flex: 1, display: "flex", gap: "var(--space-1)", flexWrap: "wrap" }}>
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
            <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)} data-tip="Choose which companies and events this person can open">
              Change access
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                void api.rotateUserToken(u.id).then(({ accessToken }) => {
                  void showSecret({
                    title: `New access token for ${u.name}`,
                    message: "Their old one has stopped working. Send them this one privately.",
                    secret: accessToken,
                  });
                  reload();
                })
              }
              data-tip="Make a new access token for this person. Their old one stops working straight away."
            >
              New token
            </button>
            <button
              className="btn btn-sm btn-ghost"
              title={u.hasPassword ? "Give this person a new password. They will be signed out on their other devices." : "Set a password so they can sign in with their email"}
              onClick={async () => {
                // Hidden as it is typed — the browser prompt this replaced
                // showed the password in plain text on the admin's screen.
                const pw = await askText({
                  title: `${u.hasPassword ? "New" : "Set a"} password for ${u.name}`,
                  label: "Password",
                  hint: PASSWORD_HINT,
                  inputType: "password",
                  validate: (v) => passwordProblem(v, u.email),
                });
                if (!pw) return;
                void api
                  .setUserPassword(u.id, pw)
                  .then(() => {
                    say(`Password ${u.hasPassword ? "changed" : "set"} for ${u.name}. They have been signed out everywhere else.`, "success");
                    reload();
                  })
                  .catch((err) => sayError(err));
              }}
            >
              {u.hasPassword ? "Reset password" : "Set password"}
            </button>
            <ConfirmButton
              className="btn btn-sm btn-danger"
              label="Delete account"
              confirmLabel="Press again to delete it"
              onConfirm={() => void api.deleteUser(u.id).then(reload)}
              data-tip="Delete this person's account. You can't undo it."
            />
          </li>
        ))}
        {users.length === 0 && (
          <li style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", padding: "6px 0" }}>
            No accounts yet. Press + User to make one.
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
          note="This is everything they can open. Anything you take away here is gone everywhere: their company, their events, and any other company they work for."
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
