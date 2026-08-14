"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A stopwatch beside the cue timer.
 *
 * For measuring things the sheet does not: how long a band actually played,
 * how long the crowd took to clear, how long that interview really ran when
 * the sheet said ninety seconds. A showcaller does this on a phone or a wrist
 * today and then has to remember the number.
 *
 * LOCAL to this screen, deliberately. The cue timer is the shared truth and
 * every surface must agree about it; a second shared clock next to it would be
 * a second thing to be wrong about, and the question "whose stopwatch is
 * that?" has no good answer mid-show. This one belongs to whoever started it.
 *
 * It survives a reload — a show can run for eight hours and a refresh must not
 * throw away a measurement — by storing the moment it started rather than the
 * elapsed count, so the number is derived from the clock and cannot drift.
 */
const KEY = "oc:stopwatch";

interface Saved {
  /** When it was started, or null while stopped. */
  startedAtMs: number | null;
  /** Milliseconds banked from previous runs. */
  accumMs: number;
  /** Laps, newest last, as elapsed milliseconds at the moment each was taken. */
  laps: number[];
}

const read = (): Saved => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Saved;
      if (typeof v.accumMs === "number" && Array.isArray(v.laps)) return v;
    }
  } catch {
    // A corrupt value is not worth a broken toolbar.
  }
  return { startedAtMs: null, accumMs: 0, laps: [] };
};

/** mm:ss.t — tenths, because the things being measured are seconds long. */
function face(ms: number): string {
  const total = Math.max(0, ms);
  const tenths = Math.floor(total / 100) % 10;
  const secs = Math.floor(total / 1000) % 60;
  const mins = Math.floor(total / 60000) % 60;
  const hrs = Math.floor(total / 3600000);
  const body = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${hrs > 0 ? `${hrs}:` : ""}${body}.${tenths}`;
}

export function Stopwatch() {
  const [state, setState] = useState<Saved>({ startedAtMs: null, accumMs: 0, laps: [] });
  const [now, setNow] = useState(() => Date.now());
  const [open, setOpen] = useState(false);
  const loaded = useRef(false);

  // Read the stored value on mount rather than at first render: the server has
  // no localStorage, and reading it during render would differ from the HTML
  // it sent.
  useEffect(() => {
    setState(read());
    loaded.current = true;
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Private browsing, a full quota — the stopwatch still works, it just
      // will not survive a reload. Not worth interrupting anyone over.
    }
  }, [state]);

  // Only tick while it is actually running. A timer that keeps waking the page
  // to redraw a number that has not changed is a battery cost on a device
  // somebody is holding all night.
  const running = state.startedAtMs != null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  const elapsed = state.accumMs + (state.startedAtMs != null ? now - state.startedAtMs : 0);

  const startStop = () => {
    setNow(Date.now());
    setState((s) =>
      s.startedAtMs != null
        ? { ...s, startedAtMs: null, accumMs: s.accumMs + (Date.now() - s.startedAtMs) }
        : { ...s, startedAtMs: Date.now() },
    );
  };
  const reset = () => setState({ startedAtMs: null, accumMs: 0, laps: [] });
  const lap = () => setState((s) => ({ ...s, laps: [...s.laps, elapsed].slice(-20) }));

  return (
    <span className="stopwatch" data-open={open ? "1" : undefined}>
      <button
        type="button"
        className={`btn btn-sm sw-face ${running ? "is-on" : ""}`}
        onClick={startStop}
        data-tip={running ? "Stop the stopwatch" : elapsed > 0 ? "Start it again from here" : "Start the stopwatch"}
      >
        <span className="mono">{face(elapsed)}</span>
      </button>
      <button
        type="button"
        className="btn btn-sm"
        onClick={lap}
        disabled={!running}
        data-tip="Mark the time without stopping"
      >
        Lap
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={reset}
        disabled={elapsed === 0 && state.laps.length === 0}
        data-tip="Back to zero, and clear the laps"
      >
        Reset
      </button>
      {state.laps.length > 0 && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setOpen((v) => !v)}
          data-tip={open ? "Hide the laps" : "Show the laps"}
        >
          {state.laps.length} lap{state.laps.length === 1 ? "" : "s"}
        </button>
      )}
      {open && state.laps.length > 0 && (
        <span className="sw-laps mono">
          {state.laps
            .map((at, i) => ({ at, n: i + 1, split: at - (state.laps[i - 1] ?? 0) }))
            .reverse()
            .map((l) => (
              <span key={l.n} className="sw-lap">
                <b>{l.n}</b> {face(l.at)} <i>+{face(l.split)}</i>
              </span>
            ))}
        </span>
      )}
    </span>
  );
}
