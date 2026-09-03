"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { BrandWordmark, Icon } from "./ui";
import { applyTheme, isTheme, readTheme, saveTheme, THEME_KEY, THEMES, type Theme } from "../lib/theme";

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
          {/* No "Login" item here.
              It pointed at "/", which is where the wordmark directly above it
              already goes, and it offered to sign in to somebody who was
              plainly already signed in — the panel says who they are a few
              inches below, next to Sign out. Two ways to the same page, one of
              them named for a thing that had already happened. */}
          <Link className="menu-item" href="/admin" prefetch={false}>
            <span className="check" />
            Dashboard
          </Link>
        </nav>
        {settings}
        <ThemeSection />
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

/**
 * Dark, light, or match the machine — on every screen, because it is a
 * property of the person looking rather than of any page. Read in an effect,
 * never in the render body: the server renders "dark" and a browser set to
 * light would render otherwise, which is the hydration mismatch of 17 August.
 */
function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => setThemeState(readTheme()), []);
  // "Match system" means keep matching it: a laptop that goes dark at sunset
  // takes the sheet with it.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => applyTheme("system");
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, [theme]);
  // Chosen in another tab: this one follows, so two tabs of the same sheet do
  // not sit side by side in different appearances.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== THEME_KEY) return;
      const next = isTheme(e.newValue) ? e.newValue : "dark";
      setThemeState(next);
      applyTheme(next);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const set = useCallback((t: Theme) => {
    saveTheme(t);
    setThemeState(t);
  }, []);
  return [theme, set];
}

export function ThemeSection() {
  const [theme, setTheme] = useTheme();
  return (
    <SideNavSection heading="Appearance">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          className="menu-item"
          data-tip={t.tip}
          aria-pressed={theme === t.value}
          onClick={() => setTheme(t.value)}
        >
          <span className="check">{theme === t.value && "✓"}</span>
          {t.label}
        </button>
      ))}
    </SideNavSection>
  );
}
