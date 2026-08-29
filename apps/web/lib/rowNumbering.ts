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
}

/**
 * Returns the label for a row by its index in `rows` — the sheet's own number
 * when the sheet is numbered at all, otherwise a count from one. Empty string
 * where a numbered sheet left this row without one, because inventing a number
 * for it is exactly how the screens came to disagree.
 */
export function rowNumbering<T extends NumberedRow>(rows: T[]): (index: number) => string {
  const mirrored = rows.some((r) => r.sourceNumber != null);
  return (index: number) => {
    if (!mirrored) return String(index + 1);
    return (rows[index]?.sourceNumber ?? "").trim();
  };
}
