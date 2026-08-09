import type { PlanRow, PlanTiming, TimedRow } from "./types";

const effDur = (row: PlanRow): number =>
  row.skipped || row.durationMuted || row.durationSec == null ? 0 : Math.max(0, row.durationSec);

/** The game whose endings this row belongs to, or null for the main line. */
const gameOf = (row: PlanRow): number | null => (row.outcome ? row.outcomeGame ?? 1 : null);
/** Identifies one branch — game 2's "win" is a different branch from game 1's. */
const branchOf = (row: PlanRow): string | null => (row.outcome ? `${row.outcomeGame ?? 1}:${row.outcome}` : null);

/**
 * Cascade timing:
 *  - a row's start = previous row's end
 *  - anchored rows (hardStartSec) restart the cascade; last anchor wins
 *  - a back-timed anchor computes the rows between the previous anchor and itself
 *    upward from its own start instead
 *  - `plannedStartSec` acts as a virtual anchor above row 0 when row 0 is unanchored
 */
/**
 * A backwards jump this big is the day rolling over, not the show going back in
 * time. Anything smaller stays what it looks like — a mistake in the sheet.
 */
const ROLLOVER_GAP = 12 * 3600;

/**
 * Absolute start for every anchored row, counting on past midnight.
 *
 * A sheet writes times of DAY. A show that runs into the small hours writes
 * 23:55 and then 00:05, and read as seconds-since-midnight that second one is
 * twenty-four hours EARLIER than the first — so a New Year's Eve sheet had a
 * −24:00:00 hole in it at the fireworks, and everything after midnight sorted
 * before everything before it.
 *
 * Run sheets are chronological, so the rollover can simply be counted: each
 * anchor that lands far enough behind the one above it starts another day.
 * `formatTimeOfDay` already wraps back to a wall clock, so 24:05 displays as
 * 00:05 with no other change.
 */
function absoluteAnchors(rows: PlanRow[]): (number | null)[] {
  let day = 0;
  let prev: number | null = null;
  return rows.map((row) => {
    if (row.hardStartSec == null) return null;
    let abs = row.hardStartSec + day * 86400;
    if (prev != null && abs < prev - ROLLOVER_GAP) {
      day += 1;
      abs += 86400;
    }
    prev = abs;
    return abs;
  });
}

export function computeTiming(
  rows: PlanRow[],
  plannedStartSec: number | null = null,
): PlanTiming {
  const anchors = absoluteAnchors(rows);
  const timed: TimedRow[] = rows.map((row) => ({
    id: row.id,
    startSec: null,
    endSec: null,
    effectiveDurationSec: effDur(row),
    anchored: row.hardStartSec != null,
    backtimed: false,
  }));

  // Forward pass. `total` is accumulated here rather than summed at the end,
  // because a set of alternate endings contributes only its longest branch.
  let cursor: number | null = plannedStartSec;
  let total = 0;
  const step = (i: number): void => {
    const t = timed[i]!;
    const anchor = anchors[i];
    if (anchor != null) cursor = anchor;
    if (cursor != null) {
      t.startSec = cursor;
      t.endSec = cursor + t.effectiveDurationSec;
      cursor = t.endSec;
    }
  };

  let i = 0;
  while (i < rows.length) {
    const game = gameOf(rows[i]!);
    if (game == null) {
      step(i);
      total += timed[i]!.effectiveDurationSec;
      i += 1;
      continue;
    }
    // A run of alternate endings for one game. Only one of them is ever
    // played, so they are stacked — each begins where the block begins, and
    // the show resumes after the longest. Laid end to end (which is how they
    // read on paper) a three-way ending made the sheet claim three times the
    // time it will really take, and every projected end after it was wrong.
    let end = i;
    while (end < rows.length && gameOf(rows[end]!) === game) end += 1;
    const blockStart = cursor;

    /**
     * Extra time is a PHASE, not an alternative — but only once a result has
     * been called.
     *
     * Golden point sits among the endings because at full time it is one of the
     * things that might happen next, and while the result is still open it
     * stacks level with the rest. Once extra time has been played AND a result
     * called, both are in the running order: the winner's lap FOLLOWS the extra
     * time rather than sharing its start.
     *
     * "A result has been called" is visible in the rows themselves — one
     * ending playing while another is skipped. Before any pick nothing is
     * skipped, so nothing is a prelude and everything stacks.
     */
    const spans = new Map<string, number>();
    for (let k = i; k < end; k++) {
      const key = branchOf(rows[k]!)!;
      spans.set(key, (spans.get(key) ?? 0) + timed[k]!.effectiveDurationSec);
    }
    const goldenKey = `${game}:golden`;
    const goldenSpan = spans.get(goldenKey) ?? 0;
    const results = [...spans].filter(([k]) => k !== goldenKey).map(([, v]) => v);
    const resultCalled = results.some((v) => v > 0) && results.some((v) => v === 0);
    const prelude = goldenSpan > 0 && resultCalled;
    const afterGolden = blockStart != null && prelude ? blockStart + goldenSpan : blockStart;

    let branch: string | null = null;
    let branchTotal = 0;
    /** Longest ending that is not extra time — only one of them is ever played. */
    let longestResult = 0;
    let latestEnd: number | null = null;
    const closeBranch = () => {
      if (branch != null && !branch.endsWith(":golden")) longestResult = Math.max(longestResult, branchTotal);
      branchTotal = 0;
    };

    for (let k = i; k < end; k++) {
      const key = branchOf(rows[k]!);
      if (key !== branch) {
        // A different ending starts: back to the top of the block — or, for a
        // result, to the end of any extra time that has already been played. An
        // anchor inside a branch still wins, exactly as anywhere else in the
        // sheet: an imported time is what the sheet says and is not ours to move.
        closeBranch();
        branch = key;
        cursor = rows[k]!.outcome === "golden" ? blockStart : afterGolden;
      }
      step(k);
      branchTotal += timed[k]!.effectiveDurationSec;
      const e = timed[k]!.endSec;
      if (e != null) latestEnd = latestEnd == null ? e : Math.max(latestEnd, e);
    }
    closeBranch();

    // Extra time and the ending that followed it both happened; otherwise only
    // one branch of the block is ever played.
    total += prelude ? goldenSpan + longestResult : Math.max(goldenSpan, longestResult);
    cursor = latestEnd ?? blockStart;
    i = end;
  }

  // Back-timing pass: fill the open segment above each back-timed anchor upward.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (anchors[i] == null || !row.backtime) continue;
    let cursorUp = anchors[i]!;
    for (let j = i - 1; j >= 0; j--) {
      if (anchors[j] != null) break; // never override another anchor
      const t = timed[j]!;
      t.endSec = cursorUp;
      t.startSec = cursorUp - t.effectiveDurationSec;
      t.backtimed = true;
      cursorUp = t.startSec;
    }
  }

  const first = timed[0];
  const last = timed[timed.length - 1];
  return {
    rows: timed,
    startSec: first?.startSec ?? null,
    // The cursor, not the last row: a sheet that ends on alternate endings
    // finishes when the longest of them finishes, and that is rarely the row
    // printed last.
    endSec: cursor ?? last?.endSec ?? null,
    totalDurationSec: total,
  };
}

/**
 * "Now", on the same counting-past-midnight scale the sheet uses.
 *
 * A wall clock resets at midnight; a sheet that runs into the small hours does
 * not. Without this every row after the rollover sits twenty-four hours in the
 * future, the clock never reaches them, and a show that should be calling the
 * fireworks stops dead at 23:59.
 */
export function absoluteNow(nowSec: number, timing: PlanTiming): number {
  const first = timing.startSec;
  if (first == null) return nowSec;
  return nowSec < first - ROLLOVER_GAP ? nowSec + 86400 : nowSec;
}

// ── Timing reconciliation ─────────────────────────────────────────────────────

export interface TimingGap {
  /** Index of the anchored row that opens the segment. */
  fromIndex: number;
  /** Index of the anchored row whose start disagrees with the cascade. */
  toIndex: number;
  /** anchoredStart − expectedStart: positive = unexplained gap, negative = overlap. */
  gapSec: number;
}

/** The shape findTimingGaps needs from a row — its anchor, and its ending. */
export interface AnchoredRow {
  hardStartSec: number | null;
  /** Which alternate ending this row belongs to, if any. See `computeTiming`. */
  outcome?: string | null;
  /** Which game on the day that ending belongs to. */
  outcomeGame?: number;
}

/** How many rows in a row may sit alongside the running order before we stop looking. */
const MAX_PARALLEL_RUN = 4;

/**
 * Finds every place where an anchored start genuinely disagrees with the
 * durations above it.
 *
 * A run sheet is not one unbroken chain. Alongside the running order it
 * carries rows that happen AT a time rather than taking time in it: two things
 * booked for the same moment, a deadline ("team sheets due"), a standing cue
 * ("2 min bell"), a note that an activity elsewhere has finished. Read as links
 * in the chain they look like errors — each one appears to open a gap and then
 * close it again — and they bury the disagreements that are real.
 *
 * So a disagreeing row is only reported once we have checked the obvious
 * alternative: that it sits ALONGSIDE the running order. If skipping it (and
 * its duration) lets the next anchored row land exactly where the cascade
 * expected, it was never in the chain, and there is nothing to reconcile.
 */
export function findTimingGaps(rows: AnchoredRow[], timing: PlanTiming): TimingGap[] {
  const gaps: TimingGap[] = [];
  let lastAnchor = -1;
  let expected: number | null = null;
  // Counted past midnight, exactly as the cascade does — otherwise the row
  // after the fireworks reads as twenty-four hours before the one before it.
  const anchors = absoluteAnchors(rows as PlanRow[]);

  /**
   * How far each row moves the running order on. An ordinary row moves it on by
   * its own duration; a block of alternate endings moves it on by its LONGEST
   * branch, because only one of them will be played. The whole block's advance
   * is charged to the row that opens it, so the walk below stays a simple sum.
   *
   * Adding every branch up instead reported a phantom hole at the end of every
   * game — the size of the endings that were never going to happen.
   */
  const advance = new Array<number>(rows.length).fill(0);
  {
    const dur = (i: number): number => timing.rows[i]?.effectiveDurationSec ?? 0;
    const gameAt = (i: number): number | null => (rows[i]?.outcome ? rows[i]!.outcomeGame ?? 1 : null);
    let i = 0;
    while (i < rows.length) {
      const game = gameAt(i);
      if (game == null) {
        advance[i] = dur(i);
        i += 1;
        continue;
      }
      let end = i;
      while (end < rows.length && gameAt(end) === game) end += 1;
      let longest = 0;
      let run = 0;
      let branch = "";
      for (let k = i; k < end; k++) {
        const key = `${rows[k]!.outcomeGame ?? 1}:${rows[k]!.outcome}`;
        if (key !== branch) {
          branch = key;
          longest = Math.max(longest, run);
          run = 0;
        }
        run += dur(k);
      }
      advance[i] = Math.max(longest, run);
      i = end;
    }
  }

  /** Does the chain pick up again within a few rows if we skip from `i`? */
  const runsAlongside = (i: number, expectedAt: number): boolean => {
    let extra = 0;
    let anchorsSkipped = 0;
    for (let j = i + 1; j < rows.length; j++) {
      const start = anchors[j];
      if (start == null) {
        // An unanchored row between the two IS in the chain; its time counts.
        extra += timing.rows[j]?.effectiveDurationSec ?? 0;
        continue;
      }
      if (Math.abs(start - (expectedAt + extra)) < 1) return true;
      if (++anchorsSkipped >= MAX_PARALLEL_RUN) return false;
    }
    return false;
  };

  /** Where the last anchor put us, so we can tell how much the rows since claimed. */
  let anchorStart: number | null = null;

  rows.forEach((row, i) => {
    const t = timing.rows[i]!;
    const anchor = anchors[i];
    if (anchor != null) {
      if (lastAnchor >= 0 && expected != null && anchorStart != null) {
        const gap = anchor - expected;
        // How much time the rows since the last anchor actually claimed. A run
        // of MILESTONES claims none: "Renee arrives 13:30", "content check
        // 13:40" are two moments, not a chain with ten missing minutes in it.
        // Nothing was supposed to fill that gap, so there is nothing to
        // reconcile — and a pre-show call sheet is mostly made of these, which
        // is why one reported thirty-three problems and had none.
        //
        // A start that goes BACKWARDS is still wrong however little was
        // claimed, so that is reported either way.
        const claimed = expected - anchorStart;
        if (Math.abs(gap) >= 1 && (claimed > 0 || gap < 0)) {
          // Alongside the running order → not a disagreement, and it must not
          // become the anchor the following rows are measured from.
          if (runsAlongside(i, expected)) return;
          gaps.push({ fromIndex: lastAnchor, toIndex: i, gapSec: Math.round(gap) });
        }
      }
      lastAnchor = i;
      anchorStart = anchor;
      expected = anchor + t.effectiveDurationSec;
    } else if (expected != null) {
      expected += advance[i]!;
    }
  });
  return gaps;
}
