/**
 * Which of my items is next.
 *
 * With a cue on the sheet it is the first of mine after the cue, whatever
 * the clock says — the show is where the showcaller put it. Without one
 * (before the doors, after a Stop) there is no cue to count from, only the
 * clock, so it is the first of mine whose planned time is still ahead: a
 * sheet opened mid-afternoon must not point at a morning item that has gone.
 * An item with no time at all is offered when nothing timed is ahead of it,
 * because it is at least still on the page.
 */
export interface NextCandidate {
  index: number;
  /** Planned start in seconds of the day, or null when the sheet gives none. */
  startSec: number | null;
  /** The role of mine this row calls for, or null when it is not my row. */
  role: string | null;
  /** Group headings and struck rows are never next. */
  eligible: boolean;
}

export function nextForRole(
  rows: readonly NextCandidate[],
  opts: { running: boolean; activeIndex: number; nowSec: number },
): NextCandidate | null {
  const from = opts.running ? opts.activeIndex + 1 : 0;
  for (let i = Math.max(0, from); i < rows.length; i++) {
    const r = rows[i]!;
    if (!r.eligible || !r.role) continue;
    if (!opts.running && r.startSec != null && r.startSec < opts.nowSec) continue;
    return r;
  }
  return null;
}
