/**
 * Which part of the match each row belongs to.
 *
 * A run sheet is a single unbroken list, and the halves of football inside it
 * look exactly like the ad break before them. A showcaller scanning for "where
 * are we, second half or half time" has only the words to go on, in a column
 * of two hundred other words. So the periods are named down the edge of the
 * sheet instead — 1ST HALF, HALF TIME, 2ND HALF — where they can be read
 * without reading anything.
 *
 * FOUND FROM THE SHEET'S OWN WORDS, and the words are remarkably consistent:
 * of the sample sheets that cover a game, every one prints the halves as the
 * TAIL of a row's name —
 *     "NRL | BULLDOGS v STORM - FIRST HALF"
 *     "NRLW RD4 | Canterbury-Bankstown Bulldogs v Dragons- SECOND HALF"
 *     "Second Half: NRL"
 * — and those rows carry the period's whole length (2700s for an NRL half,
 * 2100s for an NRLW one), because they are the containers the rest of the
 * half's cues sit inside.
 *
 * HALF TIME IS THE HARD ONE, and the reason the rule is not just a word match.
 * The break itself is printed the same way as a dozen things that merely
 * happen during it:
 *     "NRL | BULLDOGS v COWBOYS - HALF TIME (15 mins)"   ← the break, 900s
 *     "STANDBY FOR HALF TIME"                            ← no length at all
 *     "Be the DJ - Bulldogs Beats HALF TIME"             ← 110s
 *     "G Class Half time recap"                          ← 45s
 *     "Half Time Show - Back Announce"                   ← a cue in the break
 *     "Geely Half Time Car Giveaway"
 *     "Read 10 - Half Time Heroes"
 * Two things separate them, and both are needed. The break's name ENDS at the
 * phrase (or carries only a bracketed length after it), which rejects the
 * shows and the giveaways; and the break is LONG, which rejects the standby
 * and the recaps. Neither test alone is enough: "Half Time Show" can run
 * longer than five minutes, and "STANDBY FOR HALF TIME" ends at the phrase.
 *
 * Positional besides — half time is only looked for BETWEEN the two halves, so
 * "Rehearsals - Half time movements" in the morning block cannot be mistaken
 * for it however long the rehearsal is.
 */

export interface PhaseRow {
  title: string;
  durationSec?: number | null;
}

export type PhaseKind = "first-half" | "half-time" | "second-half";

export interface Phase {
  /** First row index, inclusive. */
  from: number;
  /** Last row index, inclusive. */
  to: number;
  /** What to write down the edge. */
  label: string;
  kind: PhaseKind;
  /** Which game on the day, counting from 1 — a double-header has two of each. */
  game: number;
}

/**
 * Only a bracketed aside or a short tag may follow the phrase, and it must be
 * introduced by punctuation: "HALF TIME (15 mins)" and "Second Half: NRL" are
 * the period, "Half Time Show" and "Half Time Heroes" are things inside it.
 * Twenty-eight characters is the longest real tag measured ("(15 mins)" and
 * "- 13 Minutes" are nowhere near it) and the shortest impostor it must still
 * reject is "- Back Announce", which never gets that far because the words
 * before it break the match first.
 */
const TAIL = String.raw`(?:\s*[:\-–—|(].{0,28})?\s*$`;
const period = (word: string) => new RegExp(String.raw`(?:^|[-–—|:]|\s)\s*${word}${TAIL}`, "i");

const FIRST_HALF = period(String.raw`(?:1st|first)\s+half`);
const SECOND_HALF = period(String.raw`(?:2nd|second)\s+half`);
const HALF_TIME = period(String.raw`half\s?-?\s?time`);

/**
 * Kick-off, matched anywhere in the name rather than at the end of it.
 *
 * It has to be loose, because every sheet wraps it differently — "Kick Off",
 * "Build to Kick Off", "NRL - RABBITOHS v WARRIORS - Kick off", "KICK OFF —
 * GAME TWO", "Kick Off: NRLW - Bulldogs v Dragons". A tail rule like the one
 * above would throw away most of those.
 *
 * Being loose, it also catches the run-up: "TEAMS WARM UP AND PREP FOR KICK
 * OFF" sits seven rows above the real one on a sample sheet. That is not
 * solved by a longer word list — it is solved by WHICH match is taken. The
 * kick-off is the LAST row mentioning it before half time, because everything
 * earlier that mentions kick-off is getting ready for the one that follows.
 * The second half's is the FIRST after half time, for the mirror reason.
 */
const KICK_OFF = /\bkick[-\s]?off\b/i;

export function findPhases(rows: readonly PhaseRow[], gameEnds: readonly number[]): Phase[] {
  const out: Phase[] = [];
  const titleAt = (i: number) => (rows[i]?.title ?? "").split("\n")[0]?.trim() ?? "";
  const matches = (re: RegExp, from: number, to: number): number[] => {
    const hits: number[] = [];
    for (let i = Math.max(0, from); i <= Math.min(to, rows.length - 1); i++) if (re.test(titleAt(i))) hits.push(i);
    return hits;
  };

  // Full time closes a game. With none named, the whole sheet is one game;
  // with several, each stretch between them is its own, and each gets its own
  // set of halves — a double-header has two second halves and they must not
  // be run together into one long one.
  const ends = gameEnds.length > 0 ? [...gameEnds] : [rows.length - 1];
  let start = 0;
  for (let game = 0; game < ends.length; game++) {
    const end = ends[game]!;
    if (end < start) continue;
    const n = game + 1;

    /**
     * The break, chosen by length among the candidates rather than by
     * position, because position cannot tell them apart. Between the halves
     * of one sample game sit "STANDBY FOR HALF TIME" (no length at all),
     * "HALF TIME (15 mins)" (900s) and "Be the DJ - Bulldogs Beats HALF TIME"
     * (110s) — first would take the standby, last would take the music.
     *
     * A length of zero is not a tie-breaker against nothing: on another sheet
     * every half-time row is a 30-second stinger named "Half Time - 13
     * Minutes", and it is still the break. So a missing length sorts below a
     * present one, and equal lengths go to whichever comes first.
     */
    const breakAt = (from: number, to: number): number | null => {
      const hits = matches(HALF_TIME, from, to);
      if (hits.length === 0) return null;
      return hits.reduce((best, i) => ((rows[i]?.durationSec ?? -1) > (rows[best]?.durationSec ?? -1) ? i : best));
    };

    // Named halves first; kick-off only where the sheet does not name them.
    // The sheets that spell out FIRST HALF are the ones that also give the
    // period its full length, so preferring them keeps the band on the
    // container rather than on the countdown cue in front of it.
    const named = matches(FIRST_HALF, start, end)[0] ?? null;
    const half = breakAt((named ?? start) + 1, end);
    const kickoffs = matches(KICK_OFF, start, half ?? end);
    const first = named ?? (kickoffs.length > 0 ? kickoffs[kickoffs.length - 1]! : null);

    const namedSecond = first == null ? null : matches(SECOND_HALF, first + 1, end)[0] ?? null;
    const second =
      namedSecond ?? (half == null ? null : matches(KICK_OFF, half + 1, end)[0] ?? null);

    /**
     * Nothing is painted over rows whose period is not known.
     *
     * Where a sheet marks half time but never marks the restart, the rows
     * after the break are SOME MIXTURE of the break and the second half and
     * there is no way to say where one becomes the other. A band that ran to
     * full time would be reading "Half time" over forty minutes of football.
     * Better to say less: the first half is labelled, and the rest is left
     * as plain as the sheet left it.
     */
    if (first != null) out.push({ from: first, to: (half ?? second ?? end + 1) - 1, label: "1st half", kind: "first-half", game: n });
    if (half != null && second != null) out.push({ from: half, to: second - 1, label: "Half time", kind: "half-time", game: n });
    if (second != null) out.push({ from: second, to: end, label: "2nd half", kind: "second-half", game: n });

    start = end + 1;
  }
  // A phase that ran backwards would paint a rail of negative height.
  return out.filter((p) => p.to >= p.from);
}
