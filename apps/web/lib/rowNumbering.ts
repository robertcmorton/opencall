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
   * These are alternatives — one of them happens and the others do not — so
   * they are not places in the running order and must not take numbers from
   * it. On a sheet counting from one they used to, which pushed every row
   * below them out of step with the paper by however many endings the sheet
   * carried. On an imported sheet they are usually left blank instead, which
   * is honest and says nothing.
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
 * Returns the label for a row by its index in `rows` — the sheet's own number
 * when the sheet is numbered at all, otherwise a count from one. Empty string
 * where a numbered sheet left this row without one, because inventing a number
 * for it is exactly how the screens came to disagree.
 */
export function rowNumbering<T extends NumberedRow>(rows: T[], extraShort = "GP"): (index: number) => string {
  const mirrored = rows.some((r) => r.sourceNumber != null);
  const labels: string[] = [];
  let counted = 0;
  // The number an ending hangs off: the last row above that had one of its
  // own. On a real sheet that lands on full time, which is the row the
  // decision is made at.
  let lastPlain = "";
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const suffix = outcomeSuffix(row.outcome, extraShort);
    if (suffix) {
      labels[i] = `${lastPlain}${suffix}`;
      continue;
    }
    const number = mirrored ? (row.sourceNumber ?? "").trim() : String(++counted);
    labels[i] = number;
    if (number) lastPlain = number;
  }
  return (index: number) => labels[index] ?? "";
}
