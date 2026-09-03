"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, getAdminToken, setAdminToken } from "../lib/api";
import { SideNavSection } from "./SideNav";

/**
 * Admin-only sidebar section: each tool lives on its own page rather than
 * stacking onto the events dashboard.
 */
export function AdminNavSection({
  active,
  role,
}: {
  active?: "users" | "errors" | "event-types";
  /** Who is looking. A company administers its own people but not the server. */
  role?: string | null;
}) {
  const isAdmin = role == null || role === "admin";
  return (
    <SideNavSection heading={isAdmin ? "Admin" : "Company"}>
      <Link className="menu-item" href="/admin/users">
        <span className="check">{active === "users" && "✓"}</span>
        Users &amp; access
      </Link>
      <Link className="menu-item" href="/admin/event-types">
        <span className="check">{active === "event-types" && "✓"}</span>
        Kinds of show
      </Link>
      {/* The error log is the SERVER's, not any one company's — it carries
          faults from every event on the install. */}
      {isAdmin && (
        <Link className="menu-item" href="/admin/errors">
          <span className="check">{active === "errors" && "✓"}</span>
          Error log
        </Link>
      )}
    </SideNavSection>
  );
}

/**
 * Who you are, and the way out — on every admin screen, not just one.
 *
 * The dashboard supplied this block itself, so Users & access, Kinds of show
 * and the Error log had a sidebar with no sign-out in it. One page had a way
 * out and the rest did not, which is the sort of thing nobody notices until
 * they are on the wrong one.
 *
 * The identity reads as one block above the actions rather than a line of
 * prose among them: it describes the session, not something to do.
 */
export function CredentialsNavSection({
  me,
  onSignedOut,
}: {
  me?: { role?: string | null; teamName?: string; name?: string; canManage?: boolean } | null;
  /** Re-read the session after signing out — the caller owns what that means. */
  onSignedOut: () => void;
}) {
  const router = useRouter();
  const [hasToken, setHasToken] = useState(false);
  // localStorage is read in an effect, never in the render body: the server
  // renders "not signed in" and a signed-in browser would render otherwise,
  // which is a hydration mismatch and cost a real chase on 17 August.
  useEffect(() => setHasToken(getAdminToken() != null), [me]);

  return (
    <SideNavSection heading="Credentials">
      <div className="sidenav-identity">
        <strong>
          {me?.role === "admin"
            ? "Administrator"
            : me?.role === "company"
              ? me.teamName
              : me?.role === "user"
                ? me.name
                : "Not signed in"}
        </strong>
        <span>
          {me?.role === "admin"
            ? "Full access"
            : me?.role === "company"
              ? "Company access"
              : me?.role === "user"
                ? me.canManage
                  ? "Manager"
                  : "View access"
                : hasToken
                  ? "Session not recognised"
                  : "Dev-open server — no sign-in needed"}
        </span>
      </div>
      <Link className="menu-item" href="/account">
        <span className="check" />
        My account
      </Link>
      {hasToken && (
        <button
          type="button"
          className="menu-item"
          onClick={() => {
            // Sessions are revoked server-side; plain tokens are just forgotten.
            const bearer = getAdminToken();
            const done = () => {
              setAdminToken(null);
              onSignedOut();
              // Chosen, not suffered: no way back is remembered, because
              // "sign out" was the request.
              router.replace("/");
            };
            if (bearer?.startsWith("ses_")) void api.logout().catch(() => undefined).then(done);
            else done();
          }}
        >
          <span className="check" />
          Sign out
        </button>
      )}
    </SideNavSection>
  );
}
