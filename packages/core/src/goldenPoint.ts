/**
 * Extra time the sheet never mentioned.
 *
 * Every proper rugby league game can go to golden point, and showcallers do not
 * always write a golden-point block into the run sheet — plenty of real sheets
 * carry no ending rows at all. When the siren goes on a level score and there
 * is nothing on the page to play, the show still has to happen: roughly ten
 * more minutes, and everything after it moves.
 *
 * So the block is BUILT rather than found. What follows is the shape of it and
 * what it does to the rows below, both as plain functions so the rules can be
 * tested without a document, a server or a browser.
 */

/** One row to insert, in the shape the document seeds rows with. */
export interface GoldenPointRow {
  type: "cue";
  title: string;
  /** Null where the period has no knowable length — see `goldenPointBlock`. */
  durationSec: number | null;
}

/**
 * How long the show holds before each half.
 *
 * The laws of the game give no break — five minutes, swap ends, five more. The
 * SHOW is not the game: cameras reset, the commentary comes back, the crowd is
 * told what is happening, and none of that takes zero.
 *
 * Two minutes is a PLACEHOLDER, agreed as one rather than measured, and it is
 * the number to change when somebody times a real one. Confirmed as a
 * placeholder on 29 August rather than left as an open question.
 *
 * "HOLDING" is deliberately the word real sheets already use for it.
 */
export const HOLDING_SEC = 120;

/** Each half of golden point. Fixed by the competition: five minutes a side. */
export const GOLDEN_HALF_SEC = 300;

/**
 * The block, in running order.
 *
 * Four rows, not two. A sheet that said only "Golden point 1 / Golden point 2"
 * would be describing the game rather than the broadcast, and the showcaller
 * would be holding two periods together with nothing between them.
 *
 * `mustSettle` adds a fifth and sixth row, and that is a competition rule
 * rather than a preference. In a REGULAR SEASON match the ten minutes are
 * sudden death — the first score ends it, and nobody scoring means a draw is
 * declared and the night moves on. In a FINAL the same ten minutes are played
 * out whatever the score, and if the teams are still level after them the game
 * goes to a continuous, unlimited golden point that ends only on a score.
 *
 * A run sheet cannot put a length on that last period, and should not pretend
 * to: the row carries no duration, which is how the rest of the sheet already
 * writes a thing whose end nobody knows. Leaving it off would be worse — the
 * sheet would run out of rows while a final was still being played.
 */
export function goldenPointBlock(label = "Golden point", mustSettle = false): GoldenPointRow[] {
  const block: GoldenPointRow[] = [
    { type: "cue", title: "HOLDING", durationSec: HOLDING_SEC },
    { type: "cue", title: `${label} — first half`, durationSec: GOLDEN_HALF_SEC },
    { type: "cue", title: "HOLDING", durationSec: HOLDING_SEC },
    { type: "cue", title: `${label} — second half`, durationSec: GOLDEN_HALF_SEC },
  ];
  if (mustSettle) {
    block.push(
      { type: "cue", title: "HOLDING", durationSec: HOLDING_SEC },
      { type: "cue", title: `${label} — sudden death`, durationSec: null },
    );
  }
  return block;
}

/**
 * What the whole block costs the night.
 *
 * The unlimited period counts as nothing, because nobody can say what it costs
 * until it is over. Everything printed after the block moves by this much and
 * then moves again if that period is ever played.
 */
export const goldenPointDurationSec = (label?: string, mustSettle?: boolean): number =>
  goldenPointBlock(label, mustSettle).reduce((total, r) => total + (r.durationSec ?? 0), 0);

/** The shape this needs from a row: only its printed start, if it has one. */
export interface Anchoredish {
  id: string;
  hardStartSec?: number | null;
}

/**
 * The printed times that have to move, and what they become.
 *
 * Everything after the insertion point happens later by however long the block
 * runs, so the times printed against those rows are no longer true. They are
 * rewritten rather than left to be wrong — the sheet is what the room reads,
 * and a sheet showing a time nobody can reach is worse than one that has been
 * honestly moved.
 *
 * Only rows carrying a printed time appear here. Everything else follows from
 * the durations above it and needs no help.
 *
 * Rows BEFORE the insertion point are never touched, whatever else happens: the
 * game has already been played to that point, and its times are the record of
 * when things actually went to air.
 */
export function shiftAnchorsAfter(
  rows: readonly Anchoredish[],
  insertAfterIndex: number,
  deltaSec: number,
): { id: string; from: number; to: number }[] {
  if (deltaSec === 0) return [];
  const moved: { id: string; from: number; to: number }[] = [];
  for (let i = insertAfterIndex + 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.hardStartSec == null) continue;
    moved.push({ id: r.id, from: r.hardStartSec, to: r.hardStartSec + deltaSec });
  }
  return moved;
}

/**
 * The moment a match ends, on a sheet that never tagged its endings.
 *
 * The golden-point chooser hangs off rows tagged with an outcome — "Fulltime -
 * TIGERS WIN" and its siblings — and 24 of the 27 sample sheets carry no such
 * row. On those sheets the chooser has never appeared at all, whatever the
 * competition allows, because there was nothing to hang it on. That is the real
 * reason a sheet without a golden-point block could not offer golden point; the
 * filter on what is OFFERED never got the chance to run.
 *
 * But the sheets do say where full time is — 22 of 27 name it in a row title,
 * usually once per match on a double-header. That row is the decision point:
 * the siren has gone, the score is what it is, and the showcaller either calls
 * a result or sends the day to extra time.
 *
 * Deliberately narrow, because being wrong here puts a chooser on screen in the
 * middle of a show:
 *   · the title must READ as full time, not merely mention it. "Full Time Wrap"
 *     and "READ 20 - Full Time Wrap" are the segment that follows the siren,
 *     not the siren;
 *   · the row must carry a PRINTED time, OR be the banner that closes a match.
 *     An inferred time is usually the app's guess at where a row falls, and a
 *     chooser is not a thing to raise on a guess — but a banner is not a guess.
 *     Several production houses end a match with a full-width heading and no
 *     time at all ("NRL | BULLDOGS v STORM - FULLTIME"), whose position is the
 *     second half's own printed start plus its own printed length. That is the
 *     same arithmetic the rest of the sheet is read by. Seven sample sheets
 *     mark full time this way and no other;
 *   · a row already tagged with an outcome is left alone. Those sheets have a
 *     block written into them and `detectOutcomes` already reads it.
 */
const FULL_TIME_TITLE = /^(?:[^\n]*?\b)?full[-\s]?time\b/i;
const NOT_THE_SIREN = /\bwrap\b|\bread\b|\bhighlights?\b|\bpost[-\s]?match\b/i;

/** The shape this needs from a row. */
export interface DecidableRow {
  title: string;
  hardStartSec?: number | null;
  outcome?: string | null;
  /** "group" is a banner — a heading across the sheet rather than a cue. */
  type?: string;
}

/**
 * Indexes of the rows where a result has to be called, earliest first.
 *
 * Empty when the sheet tags its own endings — that is `detectOutcomes`' job and
 * two mechanisms answering one question is how a sheet ends up with two
 * choosers.
 */
export function findDecisionPoints(rows: readonly DecidableRow[]): number[] {
  if (rows.some((r) => r.outcome)) return [];
  const out: number[] = [];
  rows.forEach((row, i) => {
    if (row.hardStartSec == null && row.type !== "group") return;
    const first = (row.title ?? "").split("\n")[0]?.trim() ?? "";
    if (!FULL_TIME_TITLE.test(first) || NOT_THE_SIREN.test(first)) return;
    out.push(i);
  });
  return out;
}
