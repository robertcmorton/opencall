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
  group: "Sport" | "Production" | "Yours";
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
   * The period in which a result becomes possible at all.
   *
   * A phrase the sheet's own rows are searched for. It does NOT decide when
   * the chooser appears — that is the last half-minute of the item running
   * into the endings — it decides whether the question can be asked yet. A
   * sheet with an ad break between the second half and the endings would
   * otherwise be asked for the result at the end of the ad break.
   *
   * A sheet that words its periods differently falls back to the buffer
   * alone, which asks late rather than never.
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
// Cricket sheets name the innings rather than a half or a quarter.
const SECOND_INNINGS = /\b(second|2nd)\s+innings\b/i;

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
    // Kept as `cricket` rather than renamed: the id is stored on events that
    // already exist, and its behaviour — win, loss or draw — is the long
    // format's, so those events keep the flow they were set up with.
    id: "cricket",
    label: "Cricket — Test match",
    group: "Sport",
    ...drawAtFullTime,
    blurb: "Five days, and time can run out: a draw is an ordinary result, not a level score.",
  },
  {
    id: "cricket-t20",
    label: "Cricket — T20",
    group: "Sport",
    ...extraMustSettle("Super over"),
    resultDueAfter: SECOND_INNINGS,
    blurb: "A short-format match cannot be drawn: a tie goes to a super over, and it is played until somebody wins.",
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

/**
 * A type as it survives storage and the wire.
 *
 * `EventTypeDef` carries a compiled RegExp, which does not survive JSON. This
 * is the same thing said in data: phrases as they appear on a sheet. A company
 * adding its own sport types those phrases in ("4th quarter"), and nobody is
 * ever asked for a regular expression.
 */
export interface EventTypeSpec {
  id: string;
  label: string;
  group?: string;
  fullTime: string[];
  afterExtra: string[];
  extraLabel?: string | null;
  resultDuePhrases?: string[];
  blurb?: string | null;
}

const OUTCOME_KEYS: OutcomeKey[] = ["win", "lose", "draw", "golden"];
const asOutcomes = (v: unknown): OutcomeKey[] =>
  Array.isArray(v) ? (v.filter((k): k is OutcomeKey => OUTCOME_KEYS.includes(k as OutcomeKey))) : [];

/** Escapes everything a regex treats as syntax, so a phrase stays a phrase. */
const escapeRe = (v: string): string => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Compiles typed-in phrases into the pattern the live screen matches rows on.
 *
 * Whitespace inside a phrase matches any run of whitespace, because a sheet
 * that wraps "4th  quarter" across a cell boundary means the same thing. Every
 * other character is escaped: the phrases come from a form, and a stray
 * bracket in one must not become syntax, or fail to compile, or worse.
 *
 * The word boundaries are applied PER PHRASE and only where they can match.
 * `\b` between two non-word characters never matches, so wrapping a phrase
 * like "Q4 (final)" in boundaries produces a pattern that silently matches
 * nothing — and a kind of show whose result chooser simply never appears,
 * with nothing on screen to say why.
 */
export function phrasesToPattern(phrases: string[]): RegExp | undefined {
  const parts = phrases
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const body = escapeRe(p).replace(/\s+/g, "\\s+");
      const lead = /^\w/.test(p) ? "\\b" : "";
      const trail = /\w$/.test(p) ? "\\b" : "";
      return `${lead}${body}${trail}`;
    });
  if (parts.length === 0) return undefined;
  return new RegExp(`(?:${parts.join("|")})`, "i");
}

/** Turns a stored or transmitted type into one the app can use. */
export function specToEventType(spec: EventTypeSpec): EventTypeDef {
  const group = spec.group === "Sport" || spec.group === "Production" ? spec.group : "Yours";
  return {
    id: spec.id,
    label: spec.label,
    group,
    fullTime: asOutcomes(spec.fullTime),
    afterExtra: asOutcomes(spec.afterExtra),
    ...(spec.extraLabel ? { extraLabel: spec.extraLabel } : {}),
    ...(() => {
      const re = phrasesToPattern(spec.resultDuePhrases ?? []);
      return re ? { resultDueAfter: re } : {};
    })(),
    blurb: spec.blurb ?? "",
  };
}

/**
 * Look a type up among the built-ins AND whatever a company has added.
 *
 * Everything that decides live behaviour goes through here, so a custom type
 * behaves exactly like a built-in one rather than being a second-class case
 * handled in a few places and forgotten in the rest.
 */
export function resolveEventType(
  id: string | null | undefined,
  custom: EventTypeSpec[] = [],
): EventTypeDef | null {
  const built = eventType(id);
  if (built) return built;
  const own = custom.find((t) => t.id === id);
  return own ? specToEventType(own) : null;
}

/** Does this kind of show have alternate endings to choose between? */
export const hasOutcomes = (id: string | null | undefined, custom: EventTypeSpec[] = []): boolean =>
  (resolveEventType(id, custom)?.fullTime.length ?? 0) > 0;

/**
 * What to offer right now.
 *
 * `extraPlaying` is the app's own state — the extra period is in the running
 * order — not something the type knows. A type with no `afterExtra` settles at
 * full time and never reaches the second list.
 */
export function outcomesFor(
  id: string | null | undefined,
  extraPlaying: boolean,
  custom: EventTypeSpec[] = [],
): OutcomeKey[] {
  const type = resolveEventType(id, custom);
  if (!type) return [];
  return extraPlaying && type.afterExtra.length > 0 ? type.afterExtra : type.fullTime;
}

/**
 * A code that can be stored beside the built-in ids without colliding.
 *
 * Prefixed rather than merely checked for collisions: a company naming its type
 * "Netball" should not silently take over the built-in one, nor be refused
 * because a name it cannot see is taken.
 */
export function customEventTypeCode(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  return `own:${slug || "type"}`;
}

export const isCustomEventType = (id: string | null | undefined): boolean => Boolean(id?.startsWith("own:"));

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
