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
  durationSec: number;
}

/**
 * How long the show holds before each half.
 *
 * The laws of the game give no break — five minutes, swap ends, five more. The
 * SHOW is not the game: cameras reset, the commentary comes back, the crowd is
 * told what is happening, and none of that takes zero. Two minutes is a choice
 * rather than a measurement, and it is the number to argue with if it is wrong.
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
 */
export function goldenPointBlock(label = "Golden point"): GoldenPointRow[] {
  return [
    { type: "cue", title: "HOLDING", durationSec: HOLDING_SEC },
    { type: "cue", title: `${label} — first half`, durationSec: GOLDEN_HALF_SEC },
    { type: "cue", title: "HOLDING", durationSec: HOLDING_SEC },
    { type: "cue", title: `${label} — second half`, durationSec: GOLDEN_HALF_SEC },
  ];
}

/** What the whole block costs the night. */
export const goldenPointDurationSec = (label?: string): number =>
  goldenPointBlock(label).reduce((total, r) => total + r.durationSec, 0);

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
