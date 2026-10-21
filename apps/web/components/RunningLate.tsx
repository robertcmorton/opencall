"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration, formatTimeOfDayWithDay, type Arrival, type LateLevel } from "@opencall/core";

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

export function RunningLate({
  arrival,
  level,
  use24h,
  trims,
  canEdit,
  onStrike,
  onTrim,
}: {
  arrival: Arrival;
  level: LateLevel;
  use24h: boolean;
  trims: TrimRow[];
  canEdit: boolean;
  onStrike: (rowId: string) => void;
  onTrim: (rowId: string, bySec: number) => void;
}) {
  const [open, setOpen] = useState(false);
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

  const { target, overSec, arrivesSec } = arrival;
  const at = formatTimeOfDayWithDay(target.atSec, use24h);
  const verdict = overSec > 0 ? `${lateAmount(overSec)} over` : overSec < 0 ? `${lateAmount(overSec)} to spare` : "on time";
  const tip =
    overSec > 0
      ? `If every item from here runs to plan, the show reaches ${target.name} at ${formatTimeOfDayWithDay(Math.round(arrivesSec), use24h)} — ${lateAmount(overSec)} after it must start. Press to see what could be trimmed.`
      : `If every item from here runs to plan, the show reaches ${target.name} ${overSec < 0 ? `${lateAmount(overSec)} early` : "exactly on time"}.`;
  return (
    <div className={`running-late is-${level}`} ref={box}>
      <button ref={button} type="button" className="rl-pill" aria-expanded={open} data-tip={tip} onClick={() => setOpen((v) => !v)}>
        <span className="rl-name">{target.name}</span>
        <span className="rl-at">{at}</span>
        <strong className="rl-verdict">{verdict}</strong>
      </button>
      {open && (
        <div className="popover rl-list" role="dialog" aria-label={`Making ${target.name} on time`} data-popover>
          <div className="rl-head">
            <strong>
              {target.name} must start at {at}
            </strong>
            <span className={overSec > 0 ? "rl-need" : "rl-ok"}>
              {overSec > 0 ? `Find ${lateAmount(overSec)} before then` : `${overSec < 0 ? `${lateAmount(overSec)} to spare` : "On time"} — nothing to trim`}
            </span>
          </div>
          {/* With time in hand there is nothing to find, so no list of things
              to cut (21 Oct: a dozen Strike buttons under "nothing to find"). */}
          {overSec <= 0 ? null : trims.length === 0 ? (
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
                      <button type="button" className="btn btn-sm" onClick={() => onStrike(t.id)} data-tip="Strike it out: skipped, and its time given back">
                        Strike
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={t.locked || t.durationSec <= 0}
                        onClick={() => onTrim(t.id, Math.min(30, t.durationSec))}
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
          {overSec > 0 && (
            <p className="rl-foot">
              Strikes and trims move the times up to {target.name}, never {target.name} itself. One undo takes each back.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
