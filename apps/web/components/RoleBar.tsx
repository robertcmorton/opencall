"use client";

import { nextForRole } from "../lib/nextForRole";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDuration, zoneSecondsOfDay, type LiveShowTiming, type PlanTiming } from "@opencall/core";
import type { ProjectedRow, RoleDef } from "@opencall/db/doc";
import type { ShowChannel } from "../lib/showChannel";
import { useDismiss } from "./ui";

const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A role name has to appear as a WHOLE word.
 *
 * Positions are short — GA, SC, MC, VT — and matched anywhere inside a string
 * they turn the sheet's own words into crew: "GAME ONE" was drawn as "GA" +
 * "ME ONE", "SCORES LEVEL" as "SC" + "ORES LEVEL", and rows lit up as
 * somebody's work because their initials happened to be spelt inside an
 * unrelated word. Letters and digits either side disqualify a match;
 * punctuation and spaces do not, so "GFX/LED" still finds both.
 */
const WHOLE_WORD = (body: string): RegExp => new RegExp(`(?<![A-Za-z0-9])(${body})(?![A-Za-z0-9])`, "gi");

/** Does this text name the role, as a whole word? */
export const mentionsRole = (text: string, role: string): boolean => {
  const needle = role.trim();
  if (!needle || !text) return false;
  return new RegExp(`(?<![A-Za-z0-9])${escapeRe(needle)}(?![A-Za-z0-9])`, "i").test(text);
};

/**
 * The pattern is built once per set of roles, not once per cell.
 *
 * This runs for every rich cell on the sheet — thousands of times on a long
 * one, on every render — and all of it (sorting the roles, escaping them,
 * compiling the alternation, building the colour lookup) depends only on the
 * roles, which change when somebody edits the role list and at no other time.
 *
 * One entry is enough: the caller passes the same array throughout a render,
 * so the first cell pays and the rest hit. Keyed on the array's identity, and
 * that identity is now stable between document changes, so the cache survives
 * whole renders rather than being rebuilt by each one.
 */
let rolePatternFor: RoleDef[] | null = null;
let rolePattern: { regex: RegExp; byName: Map<string, string> } | null = null;
const patternOf = (roles: RoleDef[]): { regex: RegExp; byName: Map<string, string> } => {
  if (rolePatternFor === roles && rolePattern) return rolePattern;
  const escaped = [...roles]
    .sort((a, b) => b.name.length - a.name.length)
    .map((r) => escapeRe(r.name));
  rolePattern = {
    regex: WHOLE_WORD(escaped.join("|")),
    byName: new Map(roles.map((r) => [r.name.toLowerCase(), r.color])),
  };
  rolePatternFor = roles;
  return rolePattern;
};

/** Colour-codes every mention of a known role inside plain cell text. */
export function highlightRoles(text: string, roles: RoleDef[]): React.ReactNode {
  if (!text || roles.length === 0) return text;
  const { regex, byName } = patternOf(roles);
  // A shared /g regex carries lastIndex between calls; split() does not use it,
  // but resetting costs nothing and stops a later edit here from surprising
  // somebody.
  regex.lastIndex = 0;
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    const color = byName.get(part.toLowerCase());
    if (!color) return part;
    return (
      <span
        key={i}
        // Never broken across lines: a position is read at a glance, and in a
        // narrow WHO column "CREW" was being split into "CRE" and "W".
        style={{
          background: `${color}22`,
          color,
          borderRadius: 3,
          padding: "0 3px",
          fontWeight: 600,
          display: "inline-block",
          whiteSpace: "nowrap",
          // Clip, never spill. Not breaking is right — "CREW" split as "CRE"
          // and "W" reads as two things — but a chip wider than its column
          // pushed the whole table past its container, and six pixels of
          // overflow is what a horizontal scrollbar is made of.
          maxWidth: "100%",
          overflow: "hidden",
          textOverflow: "ellipsis",
          verticalAlign: "bottom",
        }}
      >
        {part}
      </span>
    );
  });
}

/**
 * Does this row involve the given role? When the rundown knows which columns
 * record an assignment — the WHO column naming people, the cue column naming
 * the positions that operate the show — those are the record, and matching
 * against them (plus the title) avoids false positives from prose like "DJ
 * tracks" in a notes column. Without any, every cell may name the role.
 */
export function rowMatchesRole(row: ProjectedRow, role: string, roleColumnKeys?: string[] | null): boolean {
  const needle = role.trim();
  if (!needle) return false;
  if (mentionsRole(row.title, needle)) return true;
  const keys = (roleColumnKeys ?? []).filter(Boolean);
  if (keys.length > 0) return keys.some((k) => mentionsRole(row.cells[k] ?? "", needle));
  return Object.values(row.cells).some((v) => mentionsRole(v, needle));
}

/**
 * Publishes the crew bar's height so the sheet above can end clear of it.
 *
 * The bar is fixed to the bottom of the screen, and its height changes with
 * what it is saying — one line for a standing role, three when a cue is on
 * air. Measuring it from the page above meant reading a height before the bar
 * had rendered; the bar itself always knows.
 */
export function usePublishedBarHeight(): (el: HTMLDivElement | null) => void {
  return useCallback((el: HTMLDivElement | null) => {
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty("--rolebar-h");
      return;
    }
    const measure = () => root.style.setProperty("--rolebar-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    new ResizeObserver(measure).observe(el);
  }, []);
}

/** A user can hold several roles — the first of theirs this row involves (for its colour), or null. */
export function matchingRole(row: ProjectedRow, roles: string[], roleColumnKeys?: string[] | null): string | null {
  for (const role of roles) if (rowMatchesRole(row, role, roleColumnKeys)) return role;
  return null;
}

/**
 * Role picker: every user — admin, editor, or view-only — can mark which
 * assigned roles are theirs (BGM, Camera 1… — several at once is normal).
 * Suggestions come from the sheet itself. Stored per browser. Opens as an
 * overlay; never reflows the layout.
 */
export function RolePicker({
  rows,
  roles = [],
  myRoles,
  onChange,
}: {
  rows: ProjectedRow[];
  roles?: RoleDef[];
  myRoles: string[];
  onChange: (roles: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const ref = useDismiss(open, () => setOpen(false));

  const toggle = (role: string) => {
    const has = myRoles.some((r) => r.toLowerCase() === role.toLowerCase());
    onChange(has ? myRoles.filter((r) => r.toLowerCase() !== role.toLowerCase()) : [...myRoles, role]);
  };
  const firstColor = roles.find((r) => r.name.toLowerCase() === myRoles[0]?.toLowerCase())?.color ?? "#2dd4bf";

  /**
   * Candidate roles: short cell lines seen at least twice.
   *
   * This reads every line of every cell of every row — the whole sheet, split
   * on newlines — and it used to do so on every render of this component, open
   * or shut. The list is only ever shown inside the picker, so on a long sheet
   * that was a full pass over the document to produce something nobody was
   * looking at, repeatedly, while a show was running.
   *
   * Now it waits until the picker is actually open, and is remembered between
   * renders. `rows` only changes when the document does, so opening and
   * closing the picker does not re-count anything.
   */
  const suggestions = useMemo(() => {
    if (!open) return [];
    const counts = new Map<string, number>();
    for (const row of rows)
      for (const value of Object.values(row.cells))
        for (const line of value.split("\n")) {
          const v = line.trim();
          if (!v || v.length > 24) continue;
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
    return [...counts.entries()]
      .filter(([v, n]) => n >= 2 && !/^\d/.test(v))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 18)
      .map(([v]) => v);
  }, [open, rows]);

  const isMine = (name: string) => myRoles.some((r) => r.toLowerCase() === name.toLowerCase());

  /**
   * Keep the menu on the screen.
   *
   * It hangs off the RIGHT edge of its button, which is correct on a desktop
   * where that button sits at the end of a wide toolbar. On a phone the button
   * is nowhere near the edge: measured at 390px wide, its right edge is at 211
   * and the menu is 250, so the menu started at −39 — thirty-nine pixels of it
   * off the side, with no sideways scroll to go and get them.
   *
   * Nudged by exactly the overflow, so a menu with room to spare stays where it
   * was anchored rather than drifting for no reason. Same reasoning as
   * `keepTipsOnScreen`, which cannot be reused here: that one positions CSS
   * pseudo-elements through custom properties, and this is a real element.
   *
   * The nudge moves the RIGHT offset, which is the only thing that can move it.
   * This first tried `margin-left`, which did nothing at all and measured as
   * doing nothing: the menu is absolutely positioned with `right: 0` and no
   * `left`, so the browser lays it out from its right edge and a left margin
   * has nothing to push against. Pulling `right` negative slides it back into
   * view.
   */
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = menuRef.current;
      if (!el) return;
      el.style.right = "0px";
      const r = el.getBoundingClientRect();
      // Nothing to clamp against before the page has a width. Measured during a
      // viewport change the window reports 0, and the arithmetic below then
      // "corrects" a menu that is perfectly placed by shoving it most of its own
      // width sideways. Caught exactly that way: a resize mid-test moved it
      // 181px for no reason.
      if (window.innerWidth === 0 || r.width === 0) return;
      const MARGIN = 8;
      const pastLeft = MARGIN - r.left;
      const pastRight = r.right - (window.innerWidth - MARGIN);
      const nudge = pastLeft > 0 ? pastLeft : pastRight > 0 ? -pastRight : 0;
      if (nudge !== 0) el.style.right = `${Math.round(-nudge)}px`;
    };
    place();
    /**
     * And AGAIN once it has settled, which the first version did not do.
     *
     * Measuring once on open is right only if the menu never changes size after
     * that, and this one does: the role chips wrap, and how many lines they take
     * depends on the names and on the reader's font size. A phone with larger
     * text gets a taller, sometimes wider menu a frame after it opened, and a
     * clamp calculated before that is stale — which is why this read as fixed
     * on a desktop at 390px and stayed broken on a real handset.
     *
     * Same three triggers the shared Dropdown uses, for the same reasons: the
     * next frame, any change to the menu's own box, and a window resize with
     * the menu already open.
     */
    const raf = requestAnimationFrame(place);
    const ro = new ResizeObserver(place);
    if (menuRef.current) ro.observe(menuRef.current);
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        className={`btn btn-sm ${myRoles.length > 0 ? "is-on" : ""}`}
        style={
          myRoles.length > 0
            ? {
                maxWidth: 170,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                display: "inline-block",
                lineHeight: "24px",
                borderColor: firstColor,
                color: firstColor,
                background: `${firstColor}1a`,
              }
            : undefined
        }
        data-tip="Pick your assigned roles — your items highlight and the bar below tracks your next one"
        onClick={() => setOpen((o) => !o)}
      >
        {myRoles.length === 0
          ? "My role"
          : myRoles.length === 1
            ? `Role: ${myRoles[0]}`
            : `Roles: ${myRoles[0]} +${myRoles.length - 1}`}
      </button>
      {open && (
        <div ref={menuRef} className="menu" style={{ top: "calc(100% + 5px)", right: 0, minWidth: 250, padding: 10 }}>
          <div className="menu-heading" style={{ padding: "0 0 6px" }}>
            Your assigned roles — pick any number
          </div>
          <input
            className="input"
            autoFocus
            placeholder="e.g. Camera 1, BGM, PA"
            style={{ width: "100%" }}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                toggle(text.trim());
                setText("");
              }
            }}
          />
          {roles.length > 0 && (
            <div className="chip-row" style={{ marginTop: 8, maxWidth: 320 }}>
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={isMine(r.name) ? "is-on" : ""}
                  style={{
                    borderColor: r.color,
                    color: r.color,
                    background: isMine(r.name) ? `${r.color}40` : `${r.color}1a`,
                    fontWeight: isMine(r.name) ? 700 : 400,
                  }}
                  onClick={() => toggle(r.name)}
                >
                  {isMine(r.name) ? "✓ " : ""}
                  {r.name}
                </button>
              ))}
            </div>
          )}
          {suggestions.length > 0 && roles.length === 0 && (
            <div className="chip-row" style={{ marginTop: 8, maxWidth: 320 }}>
              {suggestions
                .filter((sugg) => !text || sugg.toLowerCase().includes(text.toLowerCase()))
                .slice(0, 12)
                .map((sugg) => (
                  <button key={sugg} type="button" className={isMine(sugg) ? "is-on" : ""} onClick={() => toggle(sugg)}>
                    {isMine(sugg) ? "✓ " : ""}
                    {sugg}
                  </button>
                ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {myRoles.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([])}>
                Clear all
              </button>
            )}
            <button type="button" className="btn btn-sm" style={{ marginLeft: "auto" }} onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The bottom bar for crew: while the show runs it counts down to your next
 * item (planned start shifted by the live drift), grows into a full-width
 * ON-AIR banner while your item is live, then moves on to the one after.
 */
export function RoleBar({
  myRoles,
  roleColorFor,
  roleColumnKeys,
  rows,
  timing,
  live,
  channel,
  activeRowId,
}: {
  myRoles: string[];
  roleColorFor: (role: string) => string;
  roleColumnKeys?: string[] | null;
  rows: ProjectedRow[];
  timing: PlanTiming;
  live: LiveShowTiming | null;
  channel: ShowChannel;
  activeRowId: string | null;
}) {
  // Declared before the early return: hooks cannot be conditional.
  const publishHeight = usePublishedBarHeight();
  if (myRoles.length === 0) return null;

  /**
   * Before the show there is no cue, but there is a clock and a sheet with
   * times on it, and a crew member who has picked a role wants the same
   * answer they get once it starts: what is my next item and how long until
   * it. So the bar runs off the planned times until a cue exists, then hands
   * over to the cue. This used to return nothing until the first cue, which
   * read as "you have nothing" during the hour when people most want to know.
   */
  const running = live != null && activeRowId != null;
  const nowSec = zoneSecondsOfDay(channel.serverNow(), channel.timezone);
  const activeIndex = running ? rows.findIndex((r) => r.id === activeRowId) : -1;
  const activeRow = activeIndex >= 0 ? rows[activeIndex]! : null;
  const onAirRole = activeRow != null ? matchingRole(activeRow, myRoles, roleColumnKeys) : null;

  if (onAirRole != null && live) {
    const over = live.remainingInRowSec != null && live.remainingInRowSec < 0;
    const display =
      live.remainingInRowSec == null
        ? formatDuration(Math.round(live.elapsedInRowSec))
        : over
          ? `+${formatDuration(live.rowOverSec)}`
          : formatDuration(live.remainingInRowSec);
    return (
      <div className="role-bar on-air no-print" ref={publishHeight}>
        <span className="rb-onair">● YOU’RE ON</span>
        <span className="rb-role" style={{ color: roleColorFor(onAirRole) }}>{onAirRole}</span>
        <span className="rb-title">{activeRow!.title || "—"}</span>
        <span className="rb-count">{display}</span>
      </div>
    );
  }

  // Next item of mine — across ANY of my roles — after the active row.
  let next: { row: ProjectedRow; startSec: number | null; role: string } | null = null;
  // The rule lives in `nextForRole`, where it is tested: after the cue when
  // there is one, ahead on the clock when there is not.
  const pick = nextForRole(
    rows.map((row, index) => ({
      index,
      startSec: timing.rows[index]!.startSec,
      role: row.type === "group" || row.skipped ? null : matchingRole(row, myRoles, roleColumnKeys),
      eligible: row.type !== "group" && !row.skipped,
    })),
    { running, activeIndex, nowSec },
  );
  if (pick) next = { row: rows[pick.index]!, startSec: pick.startSec, role: pick.role! };

  const rolesLabel = myRoles.length === 1 ? myRoles[0]! : `${myRoles[0]} +${myRoles.length - 1}`;

  if (!next) {
    return (
      <div className="role-bar no-print" ref={publishHeight}>
        <span className="rb-role" style={{ color: roleColorFor(myRoles[0]!) }}>{rolesLabel}</span>
        <span className="rb-done">No more items for you in this show.</span>
      </div>
    );
  }

  let countdown: number | null = null;
  if (next.startSec != null) {
    countdown = Math.round(next.startSec + (live?.showDriftSec ?? 0) - nowSec);
  }
  const imminent = countdown != null && countdown <= 60;

  return (
    <div className={`role-bar no-print ${imminent ? "imminent" : ""}`} ref={publishHeight}>
      <span className="rb-role" style={{ color: roleColorFor(next.role) }}>{next.role} · next</span>
      <span className="rb-title">{next.row.title || "—"}</span>
      <span className="rb-count">
        {countdown == null ? "—" : countdown <= 0 ? "any moment" : `in ${formatDuration(countdown)}`}
      </span>
    </div>
  );
}
