/** "milestone" = a timed marker with no duration (gates open, kick-off). */
export type RowType = "cue" | "group" | "milestone";

/** Plain-JS projection of one rundown row — the timing engine never reads Yjs directly. */
export interface PlanRow {
  id: string;
  type: RowType;
  /** Planned length in seconds. null behaves as 0. */
  durationSec: number | null;
  /**
   * Manual anchor ("flag in the ground"): this row's start is fixed and becomes the
   * timing foundation for the rows below it. Last anchor wins.
   */
  hardStartSec: number | null;
  /**
   * Only meaningful on an anchored row: timing for the rows between the previous
   * anchor and this one is calculated upward from this row instead of downward.
   */
  backtime?: boolean;
  /** Excluded from cascade math (contributes 0) while keeping its display value. */
  durationMuted?: boolean;
  /**
   * This row IS the extra period — golden point, extra time — rather than
   * something that happens after it.
   *
   * Set at import, where the titles are, because the timing engine works in
   * flags and never reads words. It exists to tell two shapes of ending block
   * apart, which the sheet does not otherwise say:
   *
   *   the branch is ONLY the extra period, and a result plays after it;
   *   the branch is the WHOLE path, extra period and closing ceremony and all.
   *
   * Both are written in the wild and they cost the day different amounts —
   * see `computeTiming`.
   */
  extraTime?: boolean;
  /**
   * Work that happens ALONGSIDE the running order rather than in it.
   *
   * A pre-record is shot while the show goes on around it — the coin toss is
   * recorded in the tunnel at 7:00 while the crowd is being warmed up, and it
   * plays out later as a VTR. It occupies people and cameras, so it belongs on
   * the sheet, but it takes none of the running order's time and it cannot be
   * late relative to it.
   *
   * Kept separate from `durationMuted`, which happens to have the same effect
   * on the sum. That is a switch the operator flips on a row whose length is
   * written down but not spent; this is a statement about what the row IS.
   * Conflating them would mean un-muting a pre-record to see its length put it
   * back in the chain.
   */
  parallel?: boolean;
  /**
   * A row whose duration COVERS the rows beneath it rather than running
   * before them.
   *
   * "HALF TIME (15 mins)" is fifteen minutes, and the wrap, the review and
   * the ad reel underneath it are also fifteen minutes. Both are true — they
   * are the same fifteen minutes seen twice, once as a block and once as its
   * contents. Charged in sequence the sheet claims half an hour it has not
   * got, which is what put a quarter-hour overlap on every game sheet.
   *
   * So a block keeps its length everywhere it is read — the sheet still says
   * half time is fifteen minutes, and a countdown on it still counts fifteen
   * minutes — and contributes nothing to the running order, because its
   * children already do. Unlike `parallel` it is still part of the show and
   * still takes a cue: somebody calls half time.
   */
  spans?: boolean;
  /**
   * Struck: the row stays visible, with a line through it, but its duration
   * leaves the cascade and the transport steps over it. The fixed times below
   * it move up by its length when it is struck (see `strikeShift`) — a printed
   * time is an anchor, and left alone it would put the struck minutes straight
   * back.
   */
  skipped?: boolean;
  /** Display-only flag; does not affect math. */
  durationHidden?: boolean;
  /**
   * Which alternate ending this row belongs to ("win", "lose", "draw",
   * "golden"). Rows tagged with different endings are ALTERNATIVES: only one of
   * them is ever played, so they share a start rather than following one
   * another, and only the longest counts toward the running time.
   */
  outcome?: string | null;
  /** Which game on the day this ending belongs to, counting from 1. */
  outcomeGame?: number;
}

export interface TimedRow {
  id: string;
  /** null when no anchor or planned start exists at-or-above this row. */
  startSec: number | null;
  endSec: number | null;
  /**
   * The OTHER time this row could start, when it sits on an ending that is
   * reachable two ways.
   *
   * A win is reachable straight off full time, or off the extra period that
   * was played because the scores were level — the same rows either way, at
   * two different times. Until the result is called both are true, and a sheet
   * that prints only the earlier one is quietly wrong for half the paths
   * through the day. Null on every row with one way in, which is nearly all of
   * them.
   */
  altStartSec?: number | null;
  /** Duration used by the cascade (0 when muted or null). */
  effectiveDurationSec: number;
  /** True when this row carries a manual anchor. */
  anchored: boolean;
  /** True when this row's start was derived by back-timing. */
  backtimed: boolean;
}

export interface PlanTiming {
  rows: TimedRow[];
  /** First row's start. */
  startSec: number | null;
  /** Last row's end. */
  endSec: number | null;
  /** Sum of all effective (unmuted) durations. */
  totalDurationSec: number;
}
