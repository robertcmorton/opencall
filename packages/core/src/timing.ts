import type { PlanRow, PlanTiming, TimedRow } from "./types";

const effDur = (row: PlanRow): number =>
  row.skipped || row.durationMuted || row.durationSec == null ? 0 : Math.max(0, row.durationSec);

/**
 * What a row moves the RUNNING ORDER on by.
 *
 * A pre-record's ninety seconds are ninety real seconds — the crew shooting it
 * need to see that, and a countdown on it has to be right — but they are spent
 * beside the show rather than in it. So its length stays intact everywhere it
 * is read or displayed, and is zero only here, where the question is "what
 * happens next".
 */
const advanceBy = (row: PlanRow, eff: number): number => (row.parallel || row.spans ? 0 : eff);

/** The game whose endings this row belongs to, or null for the main line. */
const gameOf = (row: PlanRow): number | null => (row.outcome ? row.outcomeGame ?? 1 : null);
/** Identifies one branch — game 2's "win" is a different branch from game 1's. */
const branchOf = (row: PlanRow): string | null => (row.outcome ? `${row.outcomeGame ?? 1}:${row.outcome}` : null);

/** Duration as the SHEET plans it, ignoring what has been skipped live. */
const plannedDur = (row: PlanRow): number =>
  row.durationMuted || row.parallel || row.durationSec == null ? 0 : Math.max(0, row.durationSec);


/**
 * Endings that can only be reached through the extra period.
 *
 * A match is not drawn at full time in any competition that has a golden point
 * — a level score is what SENDS it to the extra period, so a drawn result is
 * on the far side of it. Only applied when the sheet actually carries an extra
 * period; in a competition where a draw is the full-time result there is no
 * golden branch, and this is a no-op.
 */
const AFTER_EXTRA_ONLY = new Set(["draw"]);

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
    // A pre-record sits at its own time and leaves the cursor where it was.
    // Letting its anchor move the cascade was worse than letting its duration
    // do so: a coin toss shot at 7:00 pushed every remaining row of the show
    // to 7:00, because the anchor is what the rows below are measured from.
    if (rows[i]!.parallel) {
      const at = anchor ?? cursor;
      if (at != null) {
        t.startSec = at;
        t.endSec = at + t.effectiveDurationSec;
      }
      return;
    }
    if (anchor != null) cursor = anchor;
    if (cursor != null) {
      t.startSec = cursor;
      // A block still HAS its length — half time is fifteen minutes and the
      // sheet must keep saying so — it simply does not move the show on by
      // it, because the rows inside it already do. So the row's own end is
      // its real end, and the cursor advances by nothing.
      t.endSec = cursor + t.effectiveDurationSec;
      cursor += advanceBy(rows[i]!, t.effectiveDurationSec);
    }
  };

  let i = 0;
  while (i < rows.length) {
    const game = gameOf(rows[i]!);
    if (game == null) {
      step(i);
      total += advanceBy(rows[i]!, timed[i]!.effectiveDurationSec);
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
    /**
     * The same spans ignoring what has been skipped.
     *
     * Where a branch SITS is a property of the sheet, not of what has been
     * called: a drawn match follows the extra period whether or not anybody
     * has pressed anything yet. Measuring that offset with the live spans made
     * it collapse to zero before the show started, which put the draw level
     * with full time — the one place it can never be.
     */
    const plannedSpans = new Map<string, number>();
    for (let k = i; k < end; k++) {
      const key = branchOf(rows[k]!)!;
      spans.set(key, (spans.get(key) ?? 0) + advanceBy(rows[k]!, timed[k]!.effectiveDurationSec));
      plannedSpans.set(key, (plannedSpans.get(key) ?? 0) + plannedDur(rows[k]!));
    }
    const goldenKey = `${game}:golden`;
    const goldenSpan = spans.get(goldenKey) ?? 0;
    const plannedGolden = plannedSpans.get(goldenKey) ?? 0;
    /** Does this game have an extra period at all? Most kinds of show do not. */
    const hasExtra = plannedSpans.has(goldenKey);
    const results = [...spans].filter(([k]) => k !== goldenKey).map(([, v]) => v);
    const resultCalled = results.some((v) => v > 0) && results.some((v) => v === 0);
    const prelude = goldenSpan > 0 && resultCalled;
    const afterGolden = blockStart != null && prelude ? blockStart + goldenSpan : blockStart;
    /**
     * Where the second layer of endings begins.
     *
     * Endings are not a list, they are a diamond. Win and lose hang off full
     * time AND off the extra period — the same rows, the same winning song,
     * reached two ways. A draw hangs off the extra period only. So this is the
     * start of everything on the far side of the extra period, and it exists
     * on the planned sheet rather than only once a result is called.
     */
    const afterExtraStart = blockStart != null && hasExtra ? blockStart + plannedGolden : blockStart;

    let branch: string | null = null;
    let branchTotal = 0;
    /** How far into its own branch this row sits — the offset its other start needs. */
    let branchOffset = 0;
    /** Longest ending that is not extra time — only one of them is ever played. */
    let longestResult = 0;
    let latestEnd: number | null = null;
    const closeBranch = () => {
      if (branch != null && !branch.endsWith(":golden")) longestResult = Math.max(longestResult, branchTotal);
      branchTotal = 0;
      branchOffset = 0;
    };

    for (let k = i; k < end; k++) {
      const key = branchOf(rows[k]!);
      const outcome = rows[k]!.outcome ?? "";
      const afterExtraOnly = hasExtra && AFTER_EXTRA_ONLY.has(outcome);
      if (key !== branch) {
        // A different ending starts: back to the top of the block — or, for an
        // ending that can only follow the extra period, to the far side of it.
        // An anchor inside a branch still wins, exactly as anywhere else in the
        // sheet: an imported time is what the sheet says and is not ours to move.
        closeBranch();
        branch = key;
        cursor =
          outcome === "golden" ? blockStart : afterExtraOnly ? afterExtraStart : prelude ? afterGolden : blockStart;
      }
      step(k);
      // The other way in, for the endings that have one. Not set once a result
      // has been called: the path is known by then, and offering two times for
      // something that has already happened is worse than useless.
      const t = timed[k]!;
      t.altStartSec =
        hasExtra && !prelude && !afterExtraOnly && outcome !== "golden" && afterExtraStart != null
          ? afterExtraStart + branchOffset
          : null;
      branchOffset += t.effectiveDurationSec;
      branchTotal += t.effectiveDurationSec;
      const e = t.endSec;
      if (e != null) latestEnd = latestEnd == null ? e : Math.max(latestEnd, e);
    }
    closeBranch();

    if (resultCalled) {
      // The path is known: extra time and the ending that followed it both
      // happened, or the match was decided at full time and only one did.
      total += prelude ? goldenSpan + longestResult : Math.max(goldenSpan, longestResult);
    } else if (hasExtra) {
      /**
       * Nothing called yet, so plan for the longest way through — the extra
       * period AND the longest ending that can follow it. The old reading took
       * the longest single branch, which is the time the day needs only if the
       * match is settled at full time. A golden point that is then won needs
       * both, and a sheet that never says so gets off air late on the one night
       * it matters.
       */
      const afterExtraLongest = Math.max(0, ...[...plannedSpans].filter(([k]) => k !== goldenKey).map(([, v]) => v));
      const atFullTimeLongest = Math.max(
        0,
        ...[...plannedSpans].filter(([k]) => k !== goldenKey && !AFTER_EXTRA_ONLY.has(k.split(":")[1] ?? "")).map(([, v]) => v),
      );
      total += Math.max(atFullTimeLongest, plannedGolden + afterExtraLongest);
    } else {
      total += Math.max(goldenSpan, longestResult);
    }
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
  // Only a sheet that actually runs past midnight has a next day to be in.
  // Without this an afternoon sheet would read an early-morning clock as
  // tomorrow — which is a guess, and one nothing needs it to make.
  if (first == null || timing.endSec == null || timing.endSec <= 86400) return nowSec;
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
  /** Covers the rows beneath it — see `PlanRow.spans`. */
  spans?: boolean;
  /** Which alternate ending this row belongs to, if any. See `computeTiming`. */
  outcome?: string | null;
  /** Which game on the day that ending belongs to. */
  outcomeGame?: number;
  /** Alongside the running order rather than in it — see `PlanRow.parallel`. */
  parallel?: boolean;
  /** A gap of this size before the row has been called deliberate — see the
   *  filter at the end of `findTimingGaps`. */
  acceptedGapSec?: number | null;
}

/** How many rows in a row may sit alongside the running order before we stop looking. */
const MAX_PARALLEL_RUN = 4;

/**
 * How far out of order a row may sit and still be read as running ALONGSIDE
 * the order rather than being a mistake.
 *
 * Run sheets list a parallel row near where it happens: a two-minute bell
 * written after the item it rings during, a team entry noted a few rows late.
 * Measured across the sample sheets, every legitimate one was 1 to 22 minutes
 * out of place. The mistakes were nowhere near: 11h59m, twice, both an "am"
 * typed for a "pm". An hour sits in the empty space between them.
 */
export const OUT_OF_ORDER_SEC = 3600;

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
    // A block's length is its children's, counted once — not twice.
    const dur = (i: number): number =>
      rows[i]?.spans ? 0 : timing.rows[i]?.effectiveDurationSec ?? 0;
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

  /**
   * Does the chain pick up again within a few rows if we skip from `i`?
   *
   * `anchorAt` is the row's own start. A row can only run ALONGSIDE the
   * running order if it sits inside it: a two-minute bell rung during the
   * team lists, a deadline that falls while something else is on. A start
   * that lands BEFORE the anchor above it is not parallel to anything — it is
   * out of order, and the chain closing neatly over the top of it is exactly
   * why it went unreported.
   *
   * A real sheet had "5:26:00 am" typed for a bell between rows at 5:25 PM
   * and 5:26 PM. Skipping it let the chain continue to the second, so nothing
   * was flagged — and then the live screen anchored to it and reported the
   * show 8 hours 59 minutes behind, with the projected end on the following
   * day. A twelve-hour mistake in a TIME cell is the single most damaging
   * thing a sheet can carry, and it was the one thing the check stayed quiet
   * about.
   */
  const runsAlongside = (i: number, expectedAt: number, anchorAt: number, since: number): boolean => {
    if (since - anchorAt > OUT_OF_ORDER_SEC) return false;
    let extra = 0;
    let anchorsSkipped = 0;
    for (let j = i + 1; j < rows.length; j++) {
      const start = anchors[j];
      if (rows[j]!.parallel) continue; // not in the chain at all
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
    // A pre-record is not a link in the chain, and its start time is not a
    // claim about where the show has got to. It is shot alongside the running
    // order — the coin toss recorded in the tunnel at 7:02 while the crowd is
    // being warmed up — so its anchor neither answers to the rows above it nor
    // becomes the point the rows below are measured from. Read as an ordinary
    // anchor it opens a hole and then an overlap, twice per pre-record, and on
    // a sheet with three of them that is most of the reported faults.
    if (row.parallel) {
      // Off the chain, but not above the law. A second track still happens at
      // a time, and a time that lands hours before the row above it is wrong
      // whatever track it is on — the "5:26:00 am" bell that parked a show
      // twelve hours out of place is a two-minute bell, and marking it as the
      // warning it is must not be what stops anyone hearing about it.
      const at = anchors[i];
      if (at != null && anchorStart != null && anchorStart - at > OUT_OF_ORDER_SEC) {
        gaps.push({ fromIndex: lastAnchor, toIndex: i, gapSec: Math.round(at - anchorStart) });
      }
      return;
    }
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
        // Two rows on the SAME anchor start together, and that is not a
        // disagreement about where either of them sits — it is the sheet
        // saying so. It happens wherever a row spans the rows beneath it:
        // "HALF TIME (15 mins)" at 8:45 for fifteen minutes, then the wrap,
        // the highlights and the ad reel that fill those same fifteen
        // minutes, the first of them also at 8:45. Charging the parent's
        // duration and then the children's reported a quarter-hour overlap on
        // every game sheet, at the one moment of the night with the most rows
        // in it.
        //
        // …and a spanning row does not always carry a printed time of its own.
        // "NSW CUP | HALF TIME" is often left blank in the TIME column and the
        // wrap that fills it carries the printed time the block begins at. So
        // the test is against the row immediately ABOVE as well as against the
        // last anchor: if this row starts where that one starts, the two begin
        // together and neither is out of place. Without it a half-time block
        // reported an overlap the size of itself, and an announcer's read over
        // a music bed reported one the size of the read.
        const above = i > 0 ? timing.rows[i - 1]?.startSec ?? null : null;
        const together =
          Math.abs(anchor - anchorStart) < 1 || (above != null && Math.abs(anchor - above) < 1);
        if (!together && Math.abs(gap) >= 1 && (claimed > 0 || gap < 0)) {
          // Alongside the running order → not a disagreement, and it must not
          // become the anchor the following rows are measured from.
          if (runsAlongside(i, expected, anchor, anchorStart)) return;
          gaps.push({ fromIndex: lastAnchor, toIndex: i, gapSec: Math.round(gap) });
        }
      }
      lastAnchor = i;
      anchorStart = anchor;
      // A block does not move the running order on — the rows inside it do.
      // Charging its length here as well as theirs is the double-count that
      // put a quarter-hour overlap on every game sheet at half time.
      expected = anchor + (row.spans ? 0 : t.effectiveDurationSec);
    } else if (expected != null) {
      expected += advance[i]!;
    }
  });
  /**
   * Gaps somebody has already ruled deliberate drop out of the report.
   *
   * Not every disagreement is a fault. A day often opens with a hold — doors,
   * a walk-in, a changeover — where the printed times and the printed
   * durations are BOTH right and simply do not meet. Before this, saying so
   * lasted as long as the panel stayed open: the acceptance lived in the
   * screen rather than in the sheet, so it was gone on the next visit, and
   * gone entirely for everybody else.
   *
   * Matched on the SIZE of the gap, within a second. Accepting a two-minute
   * hold says that two-minute hold is fine; it does not sign a blank cheque
   * for whatever appears at that row later. Change a duration above it and
   * the number moves, the stored one no longer matches, and the check asks
   * again — which is what you want from a check.
   */
  return gaps.filter((g) => {
    const accepted = rows[g.toIndex]?.acceptedGapSec;
    return accepted == null || Math.abs(accepted - g.gapSec) >= 1;
  });
}
