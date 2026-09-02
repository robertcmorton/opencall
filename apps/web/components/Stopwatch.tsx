"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A stopwatch beneath the cue timer.
 *
 * For measuring things the sheet does not: how long a band actually played,
 * how long the crowd took to clear, how long that interview really ran when
 * the sheet said ninety seconds. A showcaller does this on a phone or a wrist
 * today and then has to remember the number.
 *
 * Start, stop, reset — nothing else. Laps were here and are gone: splits are a
 * thing you read back afterwards, and a live sheet is not where anyone reads
 * anything back. Every control on this screen is one more thing to hit by
 * mistake during a show.
 *
 * LOCAL to this screen, deliberately. The cue timer above it is the shared
 * truth and every surface must agree about it; a second shared clock next to
 * it would be a second thing to be wrong about, and the question "whose
 * stopwatch is that?" has no good answer mid-show. This one belongs to whoever
 * started it.
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
}

const read = (): Saved => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      // Tolerant of the older shape, which also carried laps: a running
      // measurement must survive the release that removed them.
      const v = JSON.parse(raw) as Partial<Saved>;
      if (typeof v.accumMs === "number")
        return { startedAtMs: typeof v.startedAtMs === "number" ? v.startedAtMs : null, accumMs: v.accumMs };
    }
  } catch {
    // A corrupt value is not worth a broken toolbar.
  }
  return { startedAtMs: null, accumMs: 0 };
};

/**
 * mm:ss.hh — hundredths.
 *
 * Tenths updated ten times a second and read as a number being reported rather
 * than a clock running: the last digit stepped, and the eye sees stepping as
 * lag. Hundredths at screen rate look continuous, which is what "real time"
 * actually means to someone watching.
 */
function face(ms: number): string {
  const total = Math.max(0, ms);
  const hundredths = Math.floor(total / 10) % 100;
  const secs = Math.floor(total / 1000) % 60;
  const mins = Math.floor(total / 60000) % 60;
  const hrs = Math.floor(total / 3600000);
  const body = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${hrs > 0 ? `${hrs}:` : ""}${body}.${String(hundredths).padStart(2, "0")}`;
}

export function Stopwatch() {
  const [state, setState] = useState<Saved>({ startedAtMs: null, accumMs: 0 });
  const loaded = useRef(false);
  /** The face is written to directly; see the frame loop below. */
  const faceRef = useRef<HTMLSpanElement>(null);

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

  /**
   * Redraw on every frame while running, and not at all while stopped.
   *
   * A 100ms interval made both the number and the buttons feel slow: the face
   * only moved ten times a second, and a press landed up to a tenth before the
   * next redraw, so starting and stopping looked like they lagged the finger.
   * An animation frame redraws at screen rate and the press shows immediately.
   *
   * It costs nothing while stopped — the effect does not run — and the browser
   * suspends frames on a hidden tab, so a timer left running overnight is not
   * a battery cost on a device somebody is holding all night. The number is
   * still derived from `Date.now()`, so it cannot drift no matter how the
   * frames fall.
   */
  const running = state.startedAtMs != null;
  const elapsedNow = (s: Saved, at: number) => s.accumMs + (s.startedAtMs != null ? at - s.startedAtMs : 0);

  /**
   * The face is written straight to the DOM, not through React.
   *
   * It used to set state on every animation frame — sixty React renders a
   * second for two digits that nobody else on the page depends on. Cheap in
   * isolation, and not in company: those renders queue behind the sheet's own,
   * and on a long sheet a render is a couple of hundred milliseconds. The
   * number stuttered and, worse, so did the press, because the press was
   * waiting in the same queue.
   *
   * Writing textContent skips reconciliation entirely, so the face keeps time
   * with the screen no matter what the sheet is doing. React still owns the
   * things that actually change — running or stopped, Reset enabled or not —
   * which happen a few times a night, not sixty times a second.
   */
  useEffect(() => {
    const paint = (at: number) => {
      if (faceRef.current) faceRef.current.textContent = face(elapsedNow(state, at));
    };
    paint(Date.now());
    if (!running) return;
    let frame = 0;
    const tick = () => {
      paint(Date.now());
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, state]);

  const elapsed = elapsedNow(state, Date.now());

  const startStop = () => {
    const at = Date.now();
    const next: Saved =
      state.startedAtMs != null
        ? { startedAtMs: null, accumMs: state.accumMs + (at - state.startedAtMs) }
        : { ...state, startedAtMs: at };
    // Paint before React hears about it. The finger has already moved; waiting
    // a frame to show that the press landed is the whole of "feels slow".
    if (faceRef.current) faceRef.current.textContent = face(elapsedNow(next, at));
    setState(next);
  };
  const reset = () => {
    if (faceRef.current) faceRef.current.textContent = face(0);
    setState({ startedAtMs: null, accumMs: 0 });
  };

  return (
    <span className="stopwatch">
      <button
        type="button"
        className={`btn btn-sm sw-face ${running ? "is-on" : ""}`}
        // The face is written straight into the span for speed, so its text is
        // no use as a name — and "00:00.00" would be a poor one anyway. Say
        // what pressing it does.
        aria-label={running ? "Stop the stopwatch" : elapsed > 0 ? "Start the stopwatch again from here" : "Start the stopwatch"}
        onClick={startStop}
        data-tip={running ? "Stop the stopwatch" : elapsed > 0 ? "Start it again from here" : "Start the stopwatch"}
      >
        <span className="mono" ref={faceRef}>{face(elapsed)}</span>
      </button>
      <button
        type="button"
        className="btn btn-sm btn-ghost"
        onClick={reset}
        disabled={elapsed === 0}
        data-tip="Back to zero"
      >
        Reset
      </button>
    </span>
  );
}
