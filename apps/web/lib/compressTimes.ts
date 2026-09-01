/**
 * Scaling a run sheet's durations down without losing the sheet's arithmetic.
 *
 * A speed simulation divides every length by the same number, and the obvious
 * way to do that — round each row on its own — drifts: a hundred rows each half
 * a second out is a minute the sheet no longer accounts for. The previous fix
 * put the whole remainder on the LAST row of each stretch and floored it at one
 * second, which fails in two ways that were both visible in the sheet it
 * produced:
 *
 *   · a remainder more negative than that row could give back was silently
 *     dropped, leaving the stretch longer than the gap it had to fit;
 *   · a stretch with nothing to spend got no correction at all.
 *
 * On a 24-hour simulation that showed up as 108 timing complaints in four
 * families of exactly 27 — one per cycle, the same every cycle. Faults a real
 * sheet would never repeat that precisely.
 *
 * Cumulative rounding instead: each row's compressed length is the difference
 * between two rounded positions, so the lengths sum to the rounded span by
 * construction and no row is more than a second from its own scaled length.
 */
export function compressSegment(lengths: readonly number[], divisor: number, target: number | null): number[] {
  const clean = lengths.map((n) => Math.max(0, n));
  const total = clean.reduce((a, b) => a + b, 0);
  /**
   * Scale by the TARGET when there is one, not by the divisor.
   *
   * Cumulative rounding at `total * scale` makes the lengths add up to the
   * rounded span by construction — no remainder to hand anywhere, so nothing
   * can be dropped for want of a row big enough to carry it. Without a target
   * (the last stretch, which has no anchor after it) the divisor is the scale.
   */
  const scale = target != null && total > 0 ? target / total : 1 / divisor;
  const out: number[] = [];
  let cum = 0;
  let prev = 0;
  for (const len of clean) {
    cum += len;
    const pos = Math.round(cum * scale);
    out.push(pos - prev);
    prev = pos;
  }
  // A row that takes no time is a row deleted, so nothing goes below a second —
  // and anything that floor adds is taken back off the longest rows, which can
  // spare it without becoming a different kind of row.
  for (let i = 0; i < out.length; i++) if (out[i]! < 1) out[i] = 1;
  if (target != null) {
    let over = out.reduce((a, b) => a + b, 0) - target;
    while (over > 0) {
      const biggest = out.reduce((best, v, i) => (v > out[best]! ? i : best), 0);
      if (out[biggest]! <= 1) break; // every row is at the floor: this is the honest limit
      out[biggest]! -= 1;
      over -= 1;
    }
  }
  return out;
}
