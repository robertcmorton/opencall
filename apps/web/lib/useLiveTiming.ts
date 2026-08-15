"use client";

import { useEffect, useRef, useState } from "react";
import { computeLiveTiming, zoneSecondsOfDay, type LiveShowTiming, type PlanTiming } from "@opencall/core";
import type { ShowChannel } from "./showChannel";

/**
 * Recomputes live countdowns locally every 250 ms from timestamps + clock offset.
 * Inputs are read through refs: `channel` and `timing` are fresh objects on every
 * render, so depending on them directly would loop setState forever.
 */

/**
 * The values anything on screen actually shows, at the resolution it shows them.
 *
 * Every readout fed by this hook is whole seconds — the item countdown, the
 * show's drift, the projected end. The clock is sampled four times a second so
 * that a second never appears to be missed, which means three samples in four
 * compute a different object carrying identical text.
 *
 * That mattered more than it sounds. `live` is read by the sheet's render, so
 * each new object re-rendered every row: on a 3,321-row sheet the console spent
 * 6.9 of every 7 seconds rebuilding a table to produce twelve DOM changes, and
 * every press had to queue behind a render already in flight. Comparing what
 * will be SHOWN, rather than what was computed, drops that to one render a
 * second at no cost to accuracy.
 *
 * The progress bar keeps its smoothness for free: it is a CSS width with a
 * linear transition, so it interpolates between the per-second steps rather
 * than stepping with them.
 */
function shownValues(t: LiveShowTiming | null): string {
  if (!t) return "none";
  const s = (n: number | null | undefined) => (n == null ? "-" : Math.round(n));
  return [s(t.remainingInRowSec), s(t.rowOverSec), s(t.showDriftSec), s(t.projectedEndSec), s(t.elapsedInRowSec)].join("|");
}

export function useLiveTiming(channel: ShowChannel, timing: PlanTiming): LiveShowTiming | null {
  const [live, setLive] = useState<LiveShowTiming | null>(null);
  const channelRef = useRef(channel);
  const timingRef = useRef(timing);
  const shownRef = useRef<string>("none");
  channelRef.current = channel;
  timingRef.current = timing;

  useEffect(() => {
    const publish = (next: LiveShowTiming | null) => {
      const shown = shownValues(next);
      if (shown === shownRef.current) return;
      shownRef.current = shown;
      setLive(next);
    };
    const compute = () => {
      const show = channelRef.current.show;
      if (!show || show.state === "idle" || show.state === "ended" || !show.activeRowId || show.activeRowStartedAtMs == null) {
        publish(null);
        return;
      }
      publish(
        computeLiveTiming({
          timing: timingRef.current,
          activeRowId: show.activeRowId,
          activeRowStartedAtMs: show.activeRowStartedAtMs,
          pausedAccumMs: show.pausedAccumMs,
          pausedAtMs: show.pausedAtMs,
          nowMs: channelRef.current.serverNow(),
          toSecondsOfDay: (ms) => zoneSecondsOfDay(ms, channelRef.current.timezone),
        }),
      );
    };
    compute();
    const timer = setInterval(compute, 250);
    return () => clearInterval(timer);
  }, []);

  return live;
}
