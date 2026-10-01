"use client";

import { useLayoutEffect, useMemo, useRef } from "react";

/**
 * Progress-bar fill that only ever animates forwards.
 *
 * Chrome will start the CSS width transition from the previous fill's value
 * even across a remount, so on a row change the bar visibly receded instead of
 * snapping to zero — the transition is disabled inline whenever the fraction
 * shrinks (and on first paint), which prevents any width transition from
 * starting.
 *
 * `sweep` is the difference between a bar that STEPS and one that MOVES.
 *
 * The numbers behind these bars are published once a second, deliberately:
 * `useLiveTiming` samples four times a second but only re-renders when a
 * value ROUNDED TO WHOLE SECONDS changes, which is what keeps a 3,000-row
 * sheet from rebuilding itself four times a second. That is right for the
 * readouts, which show whole seconds anyway, and wrong for a bar, which is
 * the one thing on screen whose whole job is to be continuous. Interpolating
 * between the steps with a transition was the old answer and it never really
 * worked: too short and the bar lurches then waits, too long and it is always
 * chasing a position it never reaches.
 *
 * So a bar that knows how long the row is does not step at all. It is handed
 * the row's length and how far into it we are, and runs one linear animation
 * for the whole row with a NEGATIVE delay that starts it exactly where it
 * should be. The compositor draws every frame; nothing has to tick. A nudge or
 * a hold changes the numbers, the delay is recomputed, and it re-aims without
 * a visible jump.
 */
export function BarFill({
  frac,
  className,
  sweep,
}: {
  frac: number;
  className?: string;
  /**
   * Row length and progress in ms, for the continuous form. `key` identifies
   * the row: while it is unchanged the animation is left strictly alone.
   */
  sweep?: { key: string; durationMs: number; elapsedMs: number } | null;
}) {
  const prevRef = useRef<number | null>(null);
  const snap = prevRef.current == null || frac < prevRef.current;
  useLayoutEffect(() => {
    prevRef.current = frac;
  });
  /**
   * WORKED OUT ONCE PER ROW, and then left alone.
   *
   * Rewriting `animation-delay` restarts the animation from the new offset. So
   * recomputing this on every render — which happens once a second, when the
   * timing publishes a new whole second — restarted the sweep once a second,
   * and each restart re-anchored it a fraction away from where it had got to.
   * That is a bar that is moving but not smoothly.
   *
   * Measured: the alongside bars' animation string never changed and they were
   * smooth; the active row's shifted by exactly -1000ms every second and it
   * was not. Same animation, different treatment.
   *
   * Nothing here needs updating while a row runs: the animation already
   * describes the whole row. Only its LENGTH changing — a nudge, extra time —
   * is a reason to re-aim, and that is in the deps.
   */
  const anim = useMemo(
    () =>
      sweep && sweep.durationMs > 0 && sweep.elapsedMs < sweep.durationMs
        ? `bar-sweep ${sweep.durationMs}ms linear ${-sweep.elapsedMs}ms 1 normal both`
        : null,
    // `elapsedMs` is deliberately NOT a dependency: it is the starting offset,
    // read once, and reacting to it is exactly the restart described above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sweep?.key, sweep?.durationMs, sweep == null],
  );
  if (anim) {
    // The box stays full width and clips; the fill inside slides by transform
    // — see `.bar-sweep-fill` for why it no longer animates width.
    return (
      <div className={`${className ?? ""} bar-sweeping`} style={{ width: "100%", transition: "none" }}>
        <div className="bar-sweep-fill" style={{ animation: anim }} />
      </div>
    );
  }
  return <div className={className} style={{ width: `${frac * 100}%`, transition: snap ? "none" : undefined }} />;
}
