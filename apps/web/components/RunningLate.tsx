"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { formatDuration, formatTimeOfDayWithDay, lateBy, type Arrival, type LateLevel } from "@opencall/core";

/**
 * Running late into a fixed time (20 Oct, Robert): one line under the big
 * timer naming the next thing that must start on time, and whether the show
 * will get there — "2nd half · 7:45:00 PM · 1:20 OVER". Grey while it is far
 * off, amber when over inside fifteen minutes, red and pulsing in the last
 * five once it is more than thirty seconds. Pressing it lists what could be
 * trimmed before then.
 */

export interface TrimRow {
  id: string;
  /** The row's own number on the sheet ("23", "9W.1"). */
  number?: string;
  title: string;
  durationSec: number;
  canDrop: boolean;
  locked: boolean;
  struck: boolean;
}

/** "1:20", "12 s", "1:02:05". */
export const lateAmount = (sec: number): string => {
  const abs = Math.abs(Math.round(sec));
  return abs < 60
    ? `${abs} s`
    : formatDuration(abs)
        .replace(/^0(\d:)/, "$1")
        .replace(/^0:/, "");
};

const LIST_MAX = 8;

/** "Game 2 · 1st half" on a day with more than one game, else "1st half". */
const nameOf = (a: Arrival, manyGames: boolean): string => (manyGames && a.target.game != null ? `Game ${a.target.game} · ${a.target.name}` : a.target.name);
/** Within fifteen seconds either way is "on time" — see ON_TIME_SEC: it stops the line flickering. */
const verdictOf = (raw: number): string => {
  const overSec = lateBy(raw);
  return overSec > 0 ? `${lateAmount(overSec)} over` : overSec < 0 ? `${lateAmount(overSec)} to spare` : "on time";
};

/**
 * The line under the show controls, the full width of them (21 Oct, Robert:
 * "place 1st half below the next button set — make it full width", "also add
 * time to 1st half"). It names the NEXT fixed time, when it is, how long until
 * it, and how the show will arrive.
 *
 * Pressed, it drops down what could be trimmed (22 Oct, option A of three
 * Robert was shown — he tried a side panel, B, and preferred this). Measured
 * on a test double-header the old dropdown cut names to 300px of a 520px box
 * (136px on a phone, so even "Half time — Sponsor A break" lost its end), took
 * five tall rows to list the fixed times before reaching anything to trim,
 * opened on a half due NOW with nothing to trim, and led nowhere in the sheet.
 * Now: up to 720px wide; every fixed time ahead as a chip along the top; for
 * the one picked, how much there is to find and how much could go; the items
 * with their whole names; pressing an item takes the sheet to its row; and the
 * rows it lists light up in the sheet while it is open.
 */
export function RunningLate({
  arrivals,
  level,
  planned = false,
  use24h,
  manyGames,
  trimsFor,
  canEdit,
  onStrike,
  onUnstrike,
  onTrim,
  onShowRow,
  onListing,
}: {
  /** Every fixed time ahead, in order; the first is the next one. */
  arrivals: Arrival[];
  level: LateLevel;
  /**
   * Before the show (23 Oct): the PLAN checked against its fixed times, from
   * the top of the sheet, rather than the show measured from the item on air.
   * Only the words change.
   */
  planned?: boolean;
  use24h: boolean;
  manyGames: boolean;
  trimsFor: (targetIndex: number) => TrimRow[];
  canEdit: boolean;
  onStrike: (rowId: string, targetIndex: number) => void;
  /** Put a struck item back. Optional: without it a struck item just shows as struck. */
  onUnstrike?: (rowId: string, targetIndex: number) => void;
  onTrim: (rowId: string, bySec: number, targetIndex: number) => void;
  /** Scroll the sheet to a row (the item's number is the link). */
  onShowRow?: (rowId: string) => void;
  /** The rows the open panel is listing, for the sheet to light up; null once it closes. */
  onListing?: (rowIds: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  /** Fixed times you have struck or trimmed for, while this page is open. */
  const [worked, setWorked] = useState<ReadonlySet<number>>(() => new Set());
  /** Time found for each fixed time by what you struck or trimmed here. */
  const [found, setFound] = useState<ReadonlyMap<number, number>>(() => new Map());
  const workedOn = (targetIndex: number, sec: number) => {
    setWorked((prev) => (prev.has(targetIndex) ? prev : new Set(prev).add(targetIndex)));
    setFound((prev) => new Map(prev).set(targetIndex, Math.max(0, (prev.get(targetIndex) ?? 0) + sec)));
    // Working one keeps it in view, even once it no longer needs anything.
    setPicked(targetIndex);
  };
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listEl = useRef<HTMLDivElement>(null);
  /**
   * How tall the list may be: down to the bars along the bottom of the screen
   * (the caller's dock, the role bar, "behind the clock"), which publish their
   * heights — not under them. On a phone it ran on behind "behind the clock",
   * its last items out of reach (22 Oct). A little more of a phone than of a
   * laptop, where it would otherwise cover most of the sheet.
   */
  const [room, setRoom] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = listEl.current;
      if (!el) return;
      const css = getComputedStyle(document.documentElement);
      const bar = (name: string) => parseFloat(css.getPropertyValue(name)) || 0;
      const floor = bar("--tabbar-h") + bar("--callerdock-h") + bar("--rolebar-h") + bar("--cuedrift-h");
      const phone = window.matchMedia("(max-width: 760px)").matches;
      const free = window.innerHeight - el.getBoundingClientRect().top - floor - 12;
      setRoom(Math.max(160, Math.min(free, window.innerHeight * (phone ? 0.75 : 0.6))));
    };
    measure();
    window.addEventListener("resize", measure);
    const bars = new MutationObserver(measure);
    bars.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.removeEventListener("resize", measure);
      bars.disconnect();
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const next = arrivals[0]!;
  /**
   * Somewhere a strike or a trim would still help: late, not already due,
   * and with something before it left to take out.
   */
  const canHelp = (a: Arrival) => lateBy(a.overSec) > 0 && a.untilSec > 0 && trimsFor(a.target.index).some((t) => !t.struck);
  /**
   * Opens on the first fixed time something can still be done about (22 Oct).
   * A half due NOW cannot be helped, and opening on it showed "nothing left to
   * trim" while the next one was six minutes over and needed another tap.
   * Chosen once, as it opens, so the panel does not jump about underneath you
   * as items finish.
   */
  const openPanel = () => {
    setPicked((arrivals.find(canHelp) ?? next).target.index);
    setOpen(true);
  };
  const shown = arrivals.find((a) => a.target.index === picked) ?? arrivals.find(canHelp) ?? next;
  const at = (a: Arrival) => formatTimeOfDayWithDay(a.target.atSec, use24h);
  const until = (a: Arrival) => (a.untilSec > 0 ? `in ${lateAmount(a.untilSec)}` : "now");
  const reaches = next.target.end ? "the show ends" : `the show reaches ${next.target.name}`;
  const from = planned ? "As the sheet is planned now" : "If every item from here runs to plan";
  const tip =
    lateBy(next.overSec) > 0
      ? `${from}, ${reaches} at ${formatTimeOfDayWithDay(Math.round(next.arrivesSec), use24h)} — ${lateAmount(lateBy(next.overSec))} after ${next.target.end ? "it is due to" : "it must start"}. Press for every fixed time ahead and what could be trimmed.`
      : `${from}, ${reaches} ${lateBy(next.overSec) < 0 ? `${lateAmount(lateBy(next.overSec))} early` : "on time"}. Press for every fixed time ahead.`;
  /**
   * Over: everything that could go. On time with nothing done: nothing at
   * all (21 Oct: a dozen Strike buttons under "nothing to find").
   *
   * On time BECAUSE of what you did: still everything (22 Oct, Robert: "if I
   * select something that brings it on time, it removes all the options that
   * are available to me"). The strike that closed the gap is rarely the last
   * word — you may want a different item gone instead, or a second one for
   * time in hand — so once you have struck or trimmed for a fixed time, its
   * whole list stays.
   */
  const over = lateBy(shown.overSec) > 0;
  const all = trimsFor(shown.target.index);
  const working = over || worked.has(shown.target.index) || all.some((t) => t.struck);
  const trims = working ? all : [];

  // The sheet lights up what the panel lists. Keyed on the ids, because the
  // list is a new array every render and the parent re-renders every second.
  const listedKey = open ? trims.map((t) => t.id).join(",") : "";
  useEffect(() => {
    onListing?.(listedKey ? listedKey.split(",") : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the dependency
  }, [listedKey]);
  useEffect(
    () => () => onListing?.(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on unmount only
    [],
  );

  /**
   * How it stands, in one line (22 Oct): what is still to find, what has been
   * found here, and how much could go at most — so it is plain at a glance
   * whether the gap can be closed at all.
   */
  const stillSec = Math.max(0, lateBy(shown.overSec));
  const foundSec = found.get(shown.target.index) ?? 0;
  const couldSec = all.filter((t) => !t.struck).reduce((sum, t) => sum + t.durationSec, 0);
  const progress = over
    ? `${foundSec > 0 ? `Found ${lateAmount(foundSec)} of ${lateAmount(foundSec + stillSec)}` : `Find ${lateAmount(stillSec)} before then`} · up to ${lateAmount(couldSec)} could go${couldSec < stillSec ? ` — even all of it leaves ${lateAmount(stillSec - couldSec)} over` : ""}`
    : working
      ? `${lateBy(shown.overSec) < 0 ? `${lateAmount(lateBy(shown.overSec))} to spare` : "On time"} now${foundSec > 0 ? ` · found ${lateAmount(foundSec)}` : ""}`
      : `${lateBy(shown.overSec) < 0 ? `${lateAmount(lateBy(shown.overSec))} to spare` : "On time"} — nothing to trim`;
  const filled = foundSec + stillSec > 0 ? Math.round((foundSec / (foundSec + stillSec)) * 100) : 100;

  /** Close, and take the sheet to the item's row. */
  const showRow = (rowId: string) => {
    setOpen(false);
    onShowRow?.(rowId);
  };

  const list = (
    <div ref={listEl} className="popover rl-list" role="dialog" aria-label="Running late" data-popover style={room != null ? { maxHeight: room } : undefined}>
      {/* Every fixed time ahead, each a chip to pick (the next eight: a test
            sheet with a match every fifteen minutes would list two hundred). */}
      <div className="rl-chips" role="group" aria-label="Every fixed time ahead">
        {arrivals.slice(0, LIST_MAX).map((a) => (
          <button
            key={a.target.index}
            type="button"
            className={`rl-chip ${a === shown ? "is-on" : ""} ${lateBy(a.overSec) > 0 ? "is-over" : "is-ok"}`}
            aria-pressed={a === shown}
            data-tip={`${nameOf(a, manyGames)} · ${at(a)} · ${until(a)}`}
            onClick={() => setPicked(a.target.index)}
          >
            <span className="rl-c-name">{nameOf(a, manyGames)}</span>
            <span className="rl-c-verdict">{verdictOf(a.overSec)}</span>
          </button>
        ))}
        {arrivals.length > LIST_MAX && <span className="rl-more">and {arrivals.length - LIST_MAX} more later</span>}
      </div>
      <div className="rl-head">
        <strong>{shown.target.end ? `The show is due to end at ${at(shown)}` : `${nameOf(shown, manyGames)} must start at ${at(shown)}`}</strong>
        <span className="rl-when">{until(shown)}</span>
        {(over || foundSec > 0) && (
          <span className={`rl-progress ${over ? "" : "is-done"}`} aria-hidden="true">
            <span style={{ width: `${filled}%` }} />
          </span>
        )}
        <span className={over ? "rl-need" : "rl-ok"}>{progress}</span>
      </div>
      {!working ? null : trims.length === 0 ? (
        <p className="rl-empty">Nothing left to play before it that could be trimmed.</p>
      ) : (
        <ul className="rl-items">
          {trims.map((t) => (
            <li key={t.id} className={t.struck ? "is-struck" : undefined}>
              {t.number && onShowRow ? (
                <button type="button" className="rl-num rl-num-link" aria-label={`Show row ${t.number} in the sheet`} onClick={() => showRow(t.id)}>
                  {t.number}
                </button>
              ) : (
                <span className="rl-num">{t.number}</span>
              )}
              <span className="rl-title">
                {onShowRow ? (
                  <button type="button" className="rl-text rl-text-link" data-tip="Show this row in the sheet" onClick={() => showRow(t.id)}>
                    {t.title || "Untitled item"}
                  </button>
                ) : (
                  <span className="rl-text">{t.title || "Untitled item"}</span>
                )}
                <span className="rl-sub">
                  <span className="rl-dur">{formatDuration(t.durationSec)}</span>
                  {t.canDrop && <span className="rl-tag">can drop</span>}
                </span>
              </span>
              {canEdit && (
                <span className="rl-actions">
                  {t.struck ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      disabled={!onUnstrike}
                      onClick={() => {
                        workedOn(shown.target.index, -t.durationSec);
                        onUnstrike?.(t.id, shown.target.index);
                      }}
                      data-tip="Put it back: it plays again, and its time is taken back"
                    >
                      Undo strike
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={() => {
                        workedOn(shown.target.index, t.durationSec);
                        onStrike(t.id, shown.target.index);
                      }}
                      data-tip="Strike it out: skipped, and its time given back"
                    >
                      Strike
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={t.struck || t.locked || t.durationSec <= 0}
                    onClick={() => {
                      const by = Math.min(30, t.durationSec);
                      workedOn(shown.target.index, by);
                      onTrim(t.id, by, shown.target.index);
                    }}
                    data-tip={t.locked ? "Locked — its length can't change" : "Take 30 seconds off it"}
                  >
                    −30 s
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {working && (
        <p className="rl-foot">
          {shown.target.end
            ? "Strikes and trims move the times up to the end of the show. One undo takes each back."
            : `Strikes and trims move the times up to ${shown.target.name}, never ${shown.target.name} itself. One undo takes each back.`}
          {onShowRow ? " Press an item to see its row in the sheet." : ""}
        </p>
      )}
    </div>
  );

  return (
    <div className={`running-late is-${level}`} ref={box}>
      <button ref={button} type="button" className="rl-pill" aria-expanded={open} data-tip={tip} onClick={() => (open ? setOpen(false) : openPanel())}>
        <span className="rl-name">{nameOf(next, manyGames)}</span>
        <span className="rl-at">{at(next)}</span>
        <span className="rl-until">{until(next)}</span>
        <strong className="rl-verdict">{verdictOf(next.overSec)}</strong>
        <span className="rl-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && list}
    </div>
  );
}
