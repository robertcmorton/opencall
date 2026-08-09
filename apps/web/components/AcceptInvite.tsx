"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setAdminToken } from "../lib/api";
import { BrandWordmark, MissingFields } from "./ui";

/**
 * Joining, from an invitation.
 *
 * What the invitation gives is shown BEFORE anything is typed — the company,
 * and the events in words rather than ids. Somebody handed a link in an email
 * should be able to see what they are accepting without accepting it first.
 *
 * The access itself is not settable here: it was decided by whoever sent the
 * invitation and travels on the server side of the link. This screen collects
 * a name and a password, and nothing else.
 */
export function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [invite, setInvite] = useState<{ email: string; name: string | null; company: string | null; access: string } | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .invite(token)
      .then((i) => {
        setInvite(i);
        if (i.name) setName(i.name);
      })
      .catch((e: unknown) => setDead(String((e as Error)?.message ?? e)));
  }, [token]);

  const missing = [
    !name.trim() && "Your name",
    password.length < 8 && "A password of at least 8 characters",
  ].filter((v) => typeof v === "string") as string[];

  if (dead)
    return (
      <main className="viewer-gate">
        <div className="vg-card">
          <BrandWordmark size={20} />
          <h1 className="vg-title">This invitation has expired</h1>
          <p className="vg-blurb">
            Invitations work once and last seven days. Ask whoever sent it to invite you again.
          </p>
        </div>
      </main>
    );

  if (!invite) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (missing.length > 0) return;
    setBusy(true);
    void api
      .acceptInvite(token, { name: name.trim(), password })
      .then((r) => {
        // Signed in on the spot: making somebody set a password and then log
        // in with it immediately afterwards is a step that exists for nobody.
        setAdminToken(r.token);
        router.push("/admin");
      })
      .catch((err: unknown) => {
        setError(String((err as Error)?.message ?? err));
        setBusy(false);
      });
  };

  return (
    <main className="viewer-gate">
      <div className="vg-card">
        <BrandWordmark size={20} />
        <h1 className="vg-title">{invite.company ? `Join ${invite.company}` : "Join"}</h1>
        <p className="vg-blurb">
          You have been given access to <strong>{invite.access}</strong>. Set a name and a password and it is yours.
        </p>
        <form onSubmit={submit} className="vg-form">
          <label className="field-label">Your name</label>
          <input
            className={"input " + (tried && !name.trim() ? "field-missing" : "")}
            autoFocus
            value={name}
            maxLength={80}
            placeholder="Sam Rivers"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="field-label">Email</label>
          {/* Fixed: the invitation was sent TO this address, and letting it be
              changed here would let a forwarded link become someone else's. */}
          <input className="input" value={invite.email} readOnly disabled />
          <label className="field-label">Choose a password</label>
          <input
            className={"input " + (tried && password.length < 8 ? "field-missing" : "")}
            type="password"
            value={password}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            onChange={(e) => setPassword(e.target.value)}
          />
          {tried && <MissingFields missing={missing} />}
          {error && <div className="missing-fields">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Setting up…" : "Join"}
          </button>
        </form>
      </div>
    </main>
  );
}
