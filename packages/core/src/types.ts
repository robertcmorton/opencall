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
   * Skipped live (show running behind): the row stays visible but its duration
   * leaves the cascade, so downstream times catch back up to the original
   * anchors. Transport steps over it.
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
