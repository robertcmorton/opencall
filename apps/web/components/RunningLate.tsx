"use client";

import { useEffect, useRef, useState } from "react";
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
  title: string;
  durationSec: number;
  canDrop: boolean;
  locked: boolean;
  struck: boolean;
}

/** "1:20", "12 s", "1:02:05". */
export const lateAmount = (sec: number): string => {
  const abs = Math.abs(Math.round(sec));
  return abs < 60 ? `${abs} s` : formatDuration(abs).replace(/^0(\d:)/, "$1").replace(/^0:/, "");
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
 * it, and how the show will arrive. Pressed, it lists EVERY fixed time still
 * ahead — each half of each game — with the same three facts ("game 1 – 1st
 * half … game 1 – 2nd half … game 2…"); pick one to see what could be trimmed
 * before it. Once a half starts, the line moves on to the next by itself.
 */
export function RunningLate({
  arrivals,
  level,
  use24h,
  manyGames,
  trimsFor,
  canEdit,
  onStrike,
  onTrim,
}: {
  /** Every fixed time ahead, in order; the first is the next one. */
  arrivals: Arrival[];
  level: LateLevel;
  use24h: boolean;
  manyGames: boolean;
  trimsFor: (targetIndex: number) => TrimRow[];
  canEdit: boolean;
  onStrike: (rowId: string, targetIndex: number) => void;
  onTrim: (rowId: string, bySec: number, targetIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
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
  // The one being looked at in the list: the one picked, while it is still ahead.
  const shown = arrivals.find((a) => a.target.index === picked) ?? next;
  const at = (a: Arrival) => formatTimeOfDayWithDay(a.target.atSec, use24h);
  const until = (a: Arrival) => (a.untilSec > 0 ? `in ${lateAmount(a.untilSec)}` : "now");
  const tip =
    lateBy(next.overSec) > 0
      ? `If every item from here runs to plan, the show reaches ${next.target.name} at ${formatTimeOfDayWithDay(Math.round(next.arrivesSec), use24h)} — ${lateAmount(lateBy(next.overSec))} after it must start. Press for every fixed time ahead and what could be trimmed.`
      : `If every item from here runs to plan, the show reaches ${next.target.name} ${lateBy(next.overSec) < 0 ? `${lateAmount(lateBy(next.overSec))} early` : "on time"}. Press for every fixed time ahead.`;
  const trims = lateBy(shown.overSec) > 0 ? trimsFor(shown.target.index) : [];
  return (
    <div className={`running-late is-${level}`} ref={box}>
      <button ref={button} type="button" className="rl-pill" aria-expanded={open} data-tip={tip} onClick={() => setOpen((v) => !v)}>
        <span className="rl-name">{nameOf(next, manyGames)}</span>
        <span className="rl-at">{at(next)}</span>
        <span className="rl-until">{until(next)}</span>
        <strong className="rl-verdict">{verdictOf(next.overSec)}</strong>
        <span className="rl-caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="popover rl-list" role="dialog" aria-label="Fixed times ahead" data-popover>
          <ul className="rl-targets" aria-label="Every fixed time ahead">
            {/* The next eight: a double-header has four; a test sheet with a
                match every fifteen minutes would otherwise list two hundred. */}
            {arrivals.slice(0, LIST_MAX).map((a) => (
              <li key={a.target.index}>
                <button
                  type="button"
                  className={`rl-target ${a === shown ? "is-on" : ""} ${lateBy(a.overSec) > 0 ? "is-over" : "is-ok"}`}
                  aria-pressed={a === shown}
                  onClick={() => setPicked(a.target.index)}
                >
                  <span className="rl-t-name">{nameOf(a, manyGames)}</span>
                  <span className="rl-t-at">{at(a)}</span>
                  <span className="rl-t-until">{until(a)}</span>
                  <strong className="rl-t-verdict">{verdictOf(a.overSec)}</strong>
                </button>
              </li>
            ))}
            {arrivals.length > LIST_MAX && <li className="rl-more">and {arrivals.length - LIST_MAX} more later</li>}
          </ul>
          <div className="rl-head">
            <strong>
              {nameOf(shown, manyGames)} must start at {at(shown)}
            </strong>
            <span className={lateBy(shown.overSec) > 0 ? "rl-need" : "rl-ok"}>
              {lateBy(shown.overSec) > 0 ? `Find ${lateAmount(lateBy(shown.overSec))} before then` : `${lateBy(shown.overSec) < 0 ? `${lateAmount(lateBy(shown.overSec))} to spare` : "On time"} — nothing to trim`}
            </span>
          </div>
          {/* With time in hand there is nothing to find, so no list of things
              to cut (21 Oct: a dozen Strike buttons under "nothing to find"). */}
          {lateBy(shown.overSec) <= 0 ? null : trims.length === 0 ? (
            <p className="rl-empty">Nothing left to play before it that could be trimmed.</p>
          ) : (
            <ul>
              {trims.map((t) => (
                <li key={t.id} className={t.struck ? "is-struck" : undefined}>
                  <span className="rl-title">
                    <span className="rl-text">{t.title || "Untitled item"}</span>
                    {t.canDrop && <span className="rl-tag">can drop</span>}
                  </span>
                  <span className="rl-dur">{formatDuration(t.durationSec)}</span>
                  {canEdit && (
                    <span className="rl-actions">
                      <button type="button" className="btn btn-sm" onClick={() => onStrike(t.id, shown.target.index)} data-tip="Strike it out: skipped, and its time given back">
                        Strike
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={t.locked || t.durationSec <= 0}
                        onClick={() => onTrim(t.id, Math.min(30, t.durationSec), shown.target.index)}
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
          {lateBy(shown.overSec) > 0 && (
            <p className="rl-foot">
              Strikes and trims move the times up to {shown.target.name}, never {shown.target.name} itself. One undo takes each back.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
