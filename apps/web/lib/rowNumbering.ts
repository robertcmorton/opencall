/**
 * What a row is CALLED — the same answer on every screen.
 *
 * An imported sheet keeps ITS numbering and a manual rundown counts from one.
 * That is one decision about the whole sheet, and it has to be made once and
 * used everywhere, or the same row answers to different numbers depending on
 * which screen happens to be open. It did, in three different ways:
 *
 *   · the sheet showed the source's own number, blank where the sheet had none;
 *   · the prompter and the guest view fell back PER ROW to a position, so a row
 *     the sheet never numbered was blank on one screen and "42" on another —
 *     and that 42 collides with whatever row the sheet really does call 42;
 *   · the walkthrough counted its position among the rows it can step to, which
 *     is a filtered list. On an imported sheet whose first row is item 11 it
 *     read 1 while the sheet read 11, and the gap is not even constant: banners
 *     and skipped rows keep their number in the sheet and are stepped over here.
 *
 * A showcaller walking a crew through a sheet is reading the numbers off paper.
 * The screen has to say what the paper says.
 */
export interface NumberedRow {
  sourceNumber?: string | null;
  /**
   * An ENDING rather than an item: win, lose, draw, golden.
   *
   * These are alternatives — one of them happens and the others do not — so on
   * a sheet COUNTING FROM ONE they must not take numbers from the running
   * order. They used to, which pushed every row below them out of step with
   * the paper by however many endings the sheet carried.
   *
   * That reasoning does not reach an imported sheet, and for a while this
   * applied it there anyway. Nothing is being counted on a mirrored sheet —
   * the numbers come off the paper — so discarding a printed number protects
   * no one, and it destroys the one thing this module exists to preserve.
   * This once claimed printed sheets "usually leave endings blank". They do
   * not: across the sample sheets, ALL 1591 ending rows carry a printed
   * number, none is blank. Every one of them was being thrown away and
   * replaced with a name it shared with the rest of its branch.
   */
  outcome?: string | null;
}

/**
 * What an ending is called: the row it hangs off, plus what it IS.
 *
 * `50W`, `50L`, `50D`, `50GP` — rather than `50a`, `50b`, `50c`. The letters
 * mean something, which matters because these get said out loud: "go to
 * fifty-W" lands, "go to fifty-B" needs everybody to remember which
 * alternative B was, in a dark room, off paper. They are also
 * order-independent — a sheet listing lose before win does not change what
 * `50W` means — and they come straight off the row's own outcome, so there is
 * no ordering logic to drift.
 */
const SUFFIX: Record<string, string> = { win: "W", lose: "L", draw: "D" };
function outcomeSuffix(outcome: string | null | undefined, extraShort: string): string {
  if (!outcome) return "";
  // Not every competition calls it golden point; some call it extra time. The
  // period rail takes the short form from the kind of show for the same
  // reason, and this uses the same one rather than inventing a second.
  if (outcome === "golden") return extraShort;
  return SUFFIX[outcome] ?? outcome.slice(0, 1).toUpperCase();
}

/**
 * Where one branch of endings starts and stops.
 *
 * A branch is a RUN of rows, not a single row: "full time, they win" is
 * followed by the winning song and the presentation, and all of them belong to
 * the same alternative. They were all being called the same thing — three rows
 * answering to `50W` — which is no name at all in a dark room. So a branch of
 * several rows numbers its parts, and a branch of one is left alone.
 */
function branchRuns(rows: NumberedRow[]): number[] {
  const run: number[] = new Array(rows.length).fill(0);
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]!.outcome) continue;
    let j = i;
    while (j < rows.length && rows[j]!.outcome === rows[i]!.outcome) j++;
    // Only the rows falling back to a made-up name need telling apart; a row
    // the paper numbered is already distinct.
    const fallbacks: number[] = [];
    for (let k = i; k < j; k++) if (!(rows[k]!.sourceNumber ?? "").trim()) fallbacks.push(k);
    if (fallbacks.length > 1) fallbacks.forEach((k, n) => (run[k] = n + 1));
    i = j - 1;
  }
  return run;
}

/**
 * Returns the label for a row by its index in `rows` — the sheet's own number
 * when the sheet is numbered at all, otherwise a count from one. Empty string
 * where a numbered sheet left this row without one, because inventing a number
 * for it is exactly how the screens came to disagree.
 *
 * An ending is the same: if the paper numbered it, that is its number. Only
 * when the paper says nothing does it get named after the row it hangs off.
 */
export function rowNumbering<T extends NumberedRow>(rows: T[], extraShort = "GP"): (index: number) => string {
  const mirrored = rows.some((r) => r.sourceNumber != null);
  const runs = branchRuns(rows);
  const labels: string[] = [];
  let counted = 0;
  // The number an ending hangs off: the last row above that had one of its
  // own. On a real sheet that lands on full time, which is the row the
  // decision is made at. Endings do not update it — they all hang off the same
  // row, not off each other.
  let lastPlain = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const suffix = outcomeSuffix(row.outcome, extraShort);
    if (suffix) {
      const printed = mirrored ? (row.sourceNumber ?? "").trim() : "";
      // The paper wins. It always has for every other row; an ending is not
      // the exception it was being treated as.
      if (printed) {
        labels[i] = printed;
        continue;
      }
      const name = `${lastPlain}${suffix}`;
      labels[i] = runs[i] ? `${name}.${runs[i]}` : name;
      continue;
    }
    const number = mirrored ? (row.sourceNumber ?? "").trim() : String(++counted);
    labels[i] = number;
    if (number) lastPlain = number;
  }
  return (index: number) => labels[index] ?? "";
}
