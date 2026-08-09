"use client";

import Link from "next/link";
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
