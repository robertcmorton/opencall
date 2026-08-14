"use client";

import { useEffect, useState, useRef } from "react";
import { formatDuration, formatTimeOfDay,
  formatTimeOfDayWithDay, type LiveShowTiming } from "@opencall/core";
import type { ShowChannel } from "../lib/showChannel";
import { Icon } from "./ui";

function signed(sec: number): string {
  const sign = sec < 0 ? "−" : "+";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}

export function LiveReadouts({ live, use24h }: { live: LiveShowTiming | null; use24h: boolean }) {
  if (!live) return null;
  const over = live.remainingInRowSec != null && live.remainingInRowSec < 0;
  return (
    <>
      <div>
        <div className="header-label">Item</div>
        <div className="header-clock mono" style={{ color: over ? "var(--over)" : "var(--under)" }}>
          {live.remainingInRowSec != null
            ? over
              ? `+${formatDuration(live.rowOverSec)}`
              : formatDuration(live.remainingInRowSec)
            : "—"}
        </div>
      </div>
      <div>
        <div className="header-label">Show</div>
        <div className="header-clock mono" style={{ color: (live.showDriftSec ?? 0) > 0 ? "var(--over)" : "var(--under)" }}>
          {live.showDriftSec != null ? signed(live.showDriftSec) : "—"}
        </div>
      </div>
      <div>
        <div className="header-label">Proj. end</div>
        <div className="header-clock mono">
          {live.projectedEndSec != null ? formatTimeOfDayWithDay(Math.round(live.projectedEndSec), use24h) : "—"}
        </div>
      </div>
    </>
  );
}

/**
 * The show's STATE: start it, hold it, end it, and say which it is.
 *
 * These sit centred directly under the cue timer, because that is where the
 * eye already is. Stepping the cue (Prev/Next) is a different job and lives in
 * the toolbar with the rest of the working controls.
 */
export function ShowStateControls({
  channel,
  orderedRowIds,
  preflight = [],
}: {
  channel: ShowChannel;
  orderedRowIds: string[];
  /**
   * Things worth a look before going live, in the words the caller needs.
   *
   * A bad time is cheap to fix at four o'clock and expensive at 8:47. The
   * evening this was written, one cell reading "5:26:00 am" sent a live show
   * twelve hours out of place — and every reading on the page was there to be
   * seen hours earlier, if anything had said so.
   */
  preflight?: string[];
}) {
  const show = channel.show;
  const liveState = show?.state ?? "idle";
  const isLive = liveState === "running" || liveState === "paused";
  const [armStop, setArmStop] = useState(false);
  const armTimer = useRef<number | undefined>(undefined);
  /**
   * Warned about, never blocked.
   *
   * If it is 8:01 and kick-off is at 8:02, the show starts — whatever the
   * sheet says about itself. So a dirty sheet costs one more press and a
   * clean one costs nothing, which is the same bargain Stop already makes.
   */
  const [armStart, setArmStart] = useState(false);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  useEffect(() => {
    if (!armStart) return;
    const t = window.setTimeout(() => setArmStart(false), 15000);
    return () => window.clearTimeout(t);
  }, [armStart]);

  if (channel.role !== "caller" && channel.role !== "admin") return null;

  const start = () => channel.sendCmd("start", orderedRowIds[0]);

  return (
    <div className="show-state">
      {!isLive ? (
        <>
          <button
            className={`btn ${armStart ? "btn-warn" : "btn-positive"}`}
            onClick={() => {
              if (preflight.length > 0 && !armStart) {
                setArmStart(true);
                return;
              }
              setArmStart(false);
              start();
            }}
            disabled={!channel.connected || orderedRowIds.length === 0}
            data-tip={preflight.length > 0 ? "This sheet has something worth checking first" : undefined}
          >
            {Icon.play} {armStart ? "Start anyway" : "Start show"}
          </button>
          {armStart && (
            <span className="preflight">
              <b>
                {preflight.length} thing{preflight.length === 1 ? "" : "s"} to look at
              </b>
              {preflight.slice(0, 4).map((line, i) => (
                <span key={i}>{line}</span>
              ))}
              {preflight.length > 4 && <span>…and {preflight.length - 4} more</span>}
            </span>
          )}
        </>
      ) : (
        <>
          <span className={`live-badge ${liveState === "paused" ? "paused" : ""}`}>
            {liveState === "paused" ? "PAUSED" : "LIVE"}
          </span>
          {liveState === "running" ? (
            <button className="btn btn-sm" data-tip="Hold the show here — the clock keeps running" onClick={() => channel.sendCmd("pause")}>
              {Icon.pause} Pause
            </button>
          ) : (
            <button className="btn btn-sm btn-positive" data-tip="Resume" onClick={() => channel.sendCmd("resume")}>
              {Icon.play} Resume
            </button>
          )}
          <button
            // Stopping needs a second press — ending a live show by a stray
            // tap is worse than a wasted one. But the first press has to LOOK
            // like it did something, and three seconds was short enough that a
            // glance away read as a dead button. Ten seconds, and the button
            // says what it is waiting for.
            className={`btn btn-sm btn-danger ${armStop ? "is-on armed" : ""}`}
            data-tip={armStop ? "Press again to end the show" : "Stop the show — asks once to confirm"}
            onClick={() => {
              if (armStop) {
                channel.sendCmd("stop");
                setArmStop(false);
                window.clearTimeout(armTimer.current);
              } else {
                setArmStop(true);
                window.clearTimeout(armTimer.current);
                armTimer.current = window.setTimeout(() => setArmStop(false), 10000);
              }
            }}
          >
            {Icon.stop} {armStop ? "Press again to stop" : "Stop"}
          </button>
        </>
      )}
    </div>
  );
}

/** Stepping the live cue. The show's own state lives in `ShowStateControls`. */
export function TransportBar({
  channel,
  orderedRowIds,
}: {
  channel: ShowChannel;
  orderedRowIds: string[];
}) {
  const show = channel.show;
  const liveState = show?.state ?? "idle";
  const isLive = liveState === "running" || liveState === "paused";

  const step = (dir: 1 | -1) => {
    if (!show?.activeRowId) return;
    const idx = orderedRowIds.indexOf(show.activeRowId);
    const target = orderedRowIds[idx + dir];
    if (target) channel.sendCmd(dir === 1 ? "next" : "prev", target);
  };

  // Space / Shift+Space transport shortcuts — ignored while typing in a cell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !isLive) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (channel.role !== "caller" && channel.role !== "admin") return null;
  if (!isLive) return null;

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <button className="btn" data-tip="Previous cue (Shift+Space)" onClick={() => step(-1)}>
        {Icon.prev} Prev
      </button>
      <button className="btn btn-primary" data-tip="Next cue (Space)" onClick={() => step(1)}>
        Next {Icon.next}
      </button>
    </div>
  );
}
