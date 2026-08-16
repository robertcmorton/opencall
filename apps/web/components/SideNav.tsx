"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BrandWordmark, Icon } from "./ui";

/**
 * App shell with the persistent left settings panel: navigation (main page,
 * dashboard) plus every settings feature the current screen offers, then the
 * page content offset beside it. Collapsible; the state persists per browser.
 * What appears inside is already scoped by the server — a company credential
 * only ever sees its own data, admin sees all.
 */
export function WithSideNav({
  title,
  settings,
  children,
}: {
  title?: string;
  settings?: ReactNode;
  children: ReactNode;
}) {
  // Closed by default — opens only when this browser explicitly opened it
  // before, and never auto-opens on small screens (it overlays the content).
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(window.innerWidth > 760 && localStorage.getItem("oc:sidenav") === "1");
  }, []);
  const setOpenPersisted = (next: boolean) => {
    setOpen(next);
    localStorage.setItem("oc:sidenav", next ? "1" : "0");
  };
  const toggle = () => setOpenPersisted(!open);

  /**
   * Choosing something closes the panel.
   *
   * It floats over the page rather than pushing it aside, and most of what it
   * offers opens IN the page underneath — History, Join codes, Guest pass all
   * appear at the top of the sheet. Left open, the panel covered the first
   * 176px of the very thing it had just opened. Pushing the page made that
   * impossible and hid the question; floating asks it, and the answer a drawer
   * always gives is to get out of the way once it has been used.
   *
   * Delegated, because the settings section is supplied by each page and its
   * items are not ours to add handlers to one by one.
   */
  const closeAfterChoosing = (e: React.MouseEvent<HTMLElement>) => {
    const chosen = (e.target as HTMLElement).closest("a, button");
    if (chosen && e.currentTarget.contains(chosen)) setOpenPersisted(false);
  };

  /**
   * Anywhere else on the page closes it too.
   *
   * The panel floats OVER the sheet, so while it is open it is covering rows
   * somebody may be trying to read — and reaching for the sheet is the
   * clearest possible statement that they are done with the menu. Making them
   * find the toggle again to get back to their own run sheet is a toll on the
   * one screen that should never charge one.
   *
   * `pointerdown`, not click: it fires before the sheet acts on the press, so
   * the panel is already going as the finger lands rather than a frame later.
   * The toggle is excluded or its own click would close and reopen in one go.
   */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(".sidenav, .sidenav-toggle")) return;
      setOpenPersisted(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  });

  return (
    <>
      {/* A hamburger, not a triangle. The triangle read as "there is something
          to the left", which is true but not the point — three bars is the one
          shape everybody already knows means a menu. */}
      <button
        className="btn sidenav-toggle no-print"
        onClick={toggle}
        aria-label={open ? "Close the menu" : "Open the menu"}
        aria-expanded={open}
        title={open ? "Close the menu" : "Menu"}
        style={{ left: open ? 208 : 10 }}
      >
        {open ? Icon.close : Icon.menu}
      </button>
      <aside className={`sidenav no-print ${open ? "" : "closed"}`} onClick={closeAfterChoosing}>
        {/* prefetch={false} on all three. The menu is rendered on every page
            INCLUDING a live run sheet, and Next prefetches a Link as soon as
            it is in the tree — so opening a sheet pulled down the dashboard
            and admin bundles too: ~133 KB of JavaScript, 90%+ of it never
            executed, arriving at the exact moment the document is syncing over
            the socket. On a venue's wifi that is bandwidth taken from the one
            thing that matters. The cost is that Dashboard fetches its chunks
            on click instead — a few hundred ms, on a navigation nobody makes
            mid-show. */}
        <Link href="/" className="sidenav-brand" prefetch={false}>
          <BrandWordmark size={17} />
        </Link>
        {title && <div className="sidenav-title">{title}</div>}
        <nav className="sidenav-section">
          <div className="menu-heading">Navigate</div>
          <Link className="menu-item" href="/" prefetch={false}>
            <span className="check" />
            Login
          </Link>
          <Link className="menu-item" href="/admin" prefetch={false}>
            <span className="check" />
            Dashboard
          </Link>
        </nav>
        {settings}
        {/* The credit sits at the foot of the panel, after everything that
            does a job — visible on every screen without competing with any of
            them. "Built by" rather than anything more elaborate: it is the
            plain description, and a tool people rely on mid-show is not the
            place for a flourish. */}
        <div className="sidenav-credit">
          <span>Built by</span>
          <strong>Robert C Morton</strong>
          <a href="https://www.robertcmorton.com" target="_blank" rel="noreferrer noopener">
            robertcmorton.com
          </a>
        </div>
      </aside>
      <div className={`with-sidenav ${open ? "" : "sidenav-closed"}`}>{children}</div>
    </>
  );
}

/** A titled group of settings entries inside the panel. */
export function SideNavSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="sidenav-section">
      <div className="menu-heading">{heading}</div>
      {children}
    </div>
  );
}
