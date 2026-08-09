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
 * Win / Lose with a level score sent to an extra period, which can then end
 * drawn. Rugby league, and the shape most knockout formats take.
 */
const withExtraPeriod = (extraLabel: string): Pick<EventTypeDef, "fullTime" | "afterExtra" | "extraLabel"> => ({
  // No Draw at full time: a level score does not end the match, it sends it on.
  fullTime: ["win", "lose", "golden"],
  // Once the extra period has been played, a draw is a real result.
  afterExtra: ["win", "lose", "draw"],
  extraLabel,
});

/** Win / Lose / Draw settled at full time, with nothing after it. */
const drawAtFullTime: Pick<EventTypeDef, "fullTime" | "afterExtra"> = {
  fullTime: ["win", "lose", "draw"],
  afterExtra: [],
};

const SECOND_HALF = /\b(second|2nd)\s+half\b/i;

export const EVENT_TYPES: EventTypeDef[] = [
  {
    id: "nrl",
    label: "Rugby league (NRL)",
    group: "Sport",
    ...withExtraPeriod("Golden point"),
    resultDueAfter: SECOND_HALF,
    blurb: "Level at full time goes to golden point; a draw is only possible after it.",
  },
  {
    id: "afl",
    label: "Australian rules (AFL)",
    group: "Sport",
    ...drawAtFullTime,
    resultDueAfter: /\b(final|fourth|4th)\s+(quarter|term)\b/i,
    blurb: "A drawn match stands at the final siren in the home-and-away season.",
  },
  {
    id: "soccer",
    label: "Football (soccer)",
    group: "Sport",
    ...withExtraPeriod("Extra time"),
    resultDueAfter: SECOND_HALF,
    blurb: "A draw stands in league play; a knockout goes to extra time and then penalties.",
  },
  {
    id: "cricket",
    label: "Cricket",
    group: "Sport",
    ...drawAtFullTime,
    blurb: "Win, loss or draw. Long formats can end without a result at all.",
  },
  {
    id: "netball",
    label: "Netball",
    group: "Sport",
    ...withExtraPeriod("Extra time"),
    resultDueAfter: /\b(final|fourth|4th)\s+quarter\b/i,
    blurb: "Level at full time goes to extra time.",
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
