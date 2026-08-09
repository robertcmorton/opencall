/**
 * What KIND of show this is, and what that changes.
 *
 * Started as a `sport` string with one value in it, "nrl", tested for in half
 * a dozen places. Every new kind of show would have added another test to each
 * of them. This is the one place that knows the differences, so adding a type
 * is data rather than a hunt through the app.
 *
 * What a type actually governs:
 *
 *  · whether the sheet has alternate endings at all — a corporate day has one
 *    ending and it is the one written down
 *  · what those endings are called, and in what order they are offered
 *  · whether a level score goes somewhere before it can be a draw (golden
 *    point in the NRL, extra time then penalties in a knockout)
 *  · when the result becomes worth asking about
 *
 * Everything else about a sheet — its columns, its roles, its timing — comes
 * from the sheet itself, and deliberately not from here.
 */

/** An ending a sheet can carry, and the app can pick between. */
export type OutcomeKey = "win" | "lose" | "draw" | "golden";

export interface EventTypeDef {
  id: string;
  label: string;
  /** Grouped in the picker: a cricket match and a product launch are not neighbours. */
  group: "Sport" | "Production";
  /** Endings offered at full time, in the order shown. Empty = no endings. */
  fullTime: OutcomeKey[];
  /**
   * Endings offered after the extra period, when there is one. Empty means
   * full time settles it.
   */
  afterExtra: OutcomeKey[];
  /** What the extra period is called on this sheet ("Golden point", "Extra time"). */
  extraLabel?: string;
  /**
   * How far into the match the result is worth asking about. A phrase the
   * sheet's own rows are searched for; the chooser appears once the live cue
   * reaches it. Falls back to proximity when a sheet words it differently.
   */
  resultDueAfter?: RegExp;
  /** Shown under the picker so the choice is not a guess. */
  blurb: string;
}

/**
 * A level score is sent to an extra period, and CAN still be level after it.
 * Rugby league: golden point runs a fixed ten minutes and a match that nobody
 * wins in that time is a draw.
 */
const extraCanDraw = (extraLabel: string): Pick<EventTypeDef, "fullTime" | "afterExtra" | "extraLabel"> => ({
  // No Draw at full time: a level score does not end the match, it sends it on.
  fullTime: ["win", "lose", "golden"],
  afterExtra: ["win", "lose", "draw"],
  extraLabel,
});

/**
 * A level score is sent to an extra period that is played until somebody wins
 * — extra time then penalties, or play continuing to a two-goal lead. Offering
 * Draw after it is offering a result the competition cannot produce, which at
 * full time is a button that should not be there.
 */
const extraMustSettle = (extraLabel: string): Pick<EventTypeDef, "fullTime" | "afterExtra" | "extraLabel"> => ({
  fullTime: ["win", "lose", "golden"],
  afterExtra: ["win", "lose"],
  extraLabel,
});

/** Win / Lose / Draw settled at full time, with nothing after it. */
const drawAtFullTime: Pick<EventTypeDef, "fullTime" | "afterExtra"> = {
  fullTime: ["win", "lose", "draw"],
  afterExtra: [],
};

const SECOND_HALF = /\b(second|2nd)\s+half\b/i;
// Real netball cue sheets word it "4th Quarter Commences (15mins)"; AFL sheets
// use both "quarter" and "term".
const FINAL_QUARTER = /\b(final|fourth|4th)\s+(quarter|term)\b/i;

export const EVENT_TYPES: EventTypeDef[] = [
  {
    id: "nrl",
    label: "Rugby league (NRL)",
    group: "Sport",
    ...extraCanDraw("Golden point"),
    resultDueAfter: SECOND_HALF,
    blurb: "Level at full time goes to golden point; a draw is only possible after it.",
  },
  {
    id: "afl",
    label: "Australian rules (AFL)",
    group: "Sport",
    ...drawAtFullTime,
    resultDueAfter: FINAL_QUARTER,
    blurb: "Home-and-away: a drawn match stands at the final siren.",
  },
  {
    id: "afl-finals",
    label: "Australian rules (AFL) — final",
    group: "Sport",
    ...extraMustSettle("Extra time"),
    resultDueAfter: FINAL_QUARTER,
    blurb: "A final cannot be drawn: level at the siren goes to extra time, and it is played out.",
  },
  {
    // Kept as `soccer` rather than renamed: the id is stored on events that
    // already exist, and league is the format most of them will be.
    id: "soccer",
    label: "Football (soccer) — league",
    group: "Sport",
    ...drawAtFullTime,
    resultDueAfter: SECOND_HALF,
    blurb: "A draw is a result and the match ends there. No extra time.",
  },
  {
    id: "soccer-knockout",
    label: "Football (soccer) — knockout",
    group: "Sport",
    ...extraMustSettle("Extra time"),
    resultDueAfter: SECOND_HALF,
    blurb: "Level at full time goes to extra time, then penalties. Somebody goes through.",
  },
  {
    id: "cricket",
    label: "Cricket",
    group: "Sport",
    ...drawAtFullTime,
    blurb: "Win, loss or draw. Long formats can end without a result at all.",
  },
  {
    // Checked against real Super Netball cue sheets: they call the period
    // "Extra Time" and mark the fourth period "4th Quarter Commences".
    id: "netball",
    label: "Netball",
    group: "Sport",
    ...extraMustSettle("Extra time"),
    resultDueAfter: FINAL_QUARTER,
    blurb: "Level at full time goes to extra time, which is played until somebody leads.",
  },
  {
    id: "corporate",
    label: "Corporate event",
    group: "Production",
    fullTime: [],
    afterExtra: [],
    blurb: "One running order, one ending. Conferences, launches, awards nights.",
  },
  {
    id: "concert",
    label: "Music concert",
    group: "Production",
    fullTime: [],
    afterExtra: [],
    blurb: "One running order. Encores are rows on the sheet, not alternate endings.",
  },
  {
    id: "tv-recording",
    label: "Performance recording (TV)",
    group: "Production",
    fullTime: [],
    afterExtra: [],
    blurb: "A recorded performance: takes and resets, one running order.",
  },
];

export const eventType = (id: string | null | undefined): EventTypeDef | null =>
  EVENT_TYPES.find((t) => t.id === id) ?? null;

/** Does this kind of show have alternate endings to choose between? */
export const hasOutcomes = (id: string | null | undefined): boolean => (eventType(id)?.fullTime.length ?? 0) > 0;

/**
 * What to offer right now.
 *
 * `extraPlaying` is the app's own state — the extra period is in the running
 * order — not something the type knows. A type with no `afterExtra` settles at
 * full time and never reaches the second list.
 */
export function outcomesFor(id: string | null | undefined, extraPlaying: boolean): OutcomeKey[] {
  const type = eventType(id);
  if (!type) return [];
  return extraPlaying && type.afterExtra.length > 0 ? type.afterExtra : type.fullTime;
}

/**
 * What a view-only link shows before anyone changes it.
 *
 * Tuned for a phone, because that is what a link gets opened on: someone is
 * holding it one-handed at the side of a pitch. Three things earn their place
 * at that width — when it happens, what happens, and whose job it is. Anything
 * else is folded under the item anyway, so shipping it by default only makes
 * the rows taller.
 *
 * `roleColumnKeys` is the sheet's own answer to "whose job" — the WHO column
 * it was imported with. The first is taken; a sheet that records work in three
 * columns does not need all three on a phone.
 *
 * Returns the keys to SHOW. Whoever shares the link can add to it.
 */
export function defaultViewColumns(
  columns: { key: string; kind: string }[],
  roleColumnKeys: string[] = [],
): string[] {
  const keep = new Set<string>();
  for (const c of columns) {
    if (c.kind === "title" || c.kind === "startTime" || c.kind === "duration") keep.add(c.key);
  }
  const firstRole = roleColumnKeys.find((k) => columns.some((c) => c.key === k));
  if (firstRole) keep.add(firstRole);
  return columns.filter((c) => keep.has(c.key)).map((c) => c.key);
}
