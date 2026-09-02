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
 *     "NRL | HARBOUR v RIVERS - FIRST HALF"
 *     "NRLW RD4 | Harbour City Kings v Rivers- SECOND HALF"
 *     "Second Half: NRL"
 * — and those rows carry the period's whole length (2700s for an NRL half,
 * 2100s for an NRLW one), because they are the containers the rest of the
 * half's cues sit inside.
 *
 * HALF TIME IS THE HARD ONE, and the reason the rule is not just a word match.
 * The break itself is printed the same way as a dozen things that merely
 * happen during it:
 *     "NRL | HARBOUR v RANGERS - HALF TIME (15 mins)"   ← the break, 900s
 *     "STANDBY FOR HALF TIME"                            ← no length at all
 *     "Crowd DJ - Stadium Beats HALF TIME"             ← 110s
 *     "Partner Half time recap"                          ← 45s
 *     "Half Time Show - Back Announce"                   ← a cue in the break
 *     "Sponsor Half Time Car Giveaway"
 *     "Read 10 - Half Time Champions"
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

export type PhaseKind = "first-half" | "half-time" | "second-half" | "quarter" | "break" | "extra-time";

export interface Phase {
  /** First row index, inclusive. */
  from: number;
  /** Last row index, inclusive. */
  to: number;
  /** What to write down the edge. */
  label: string;
  /**
   * The same thing in two or three characters — 1H, 2H, 1Q…4Q, GP.
   *
   * This is what the rail actually shows, in every band, at every size. The
   * full names were tried first and are wrong for the job: the rail is 26px
   * of vertical text down the edge of a sheet, read out of the corner of the
   * eye while somebody is looking at the rows. "1st half" spelled sideways
   * needs 55px of height and reads as a word to be parsed; "1H" is a glance.
   *
   * Vertical text needs about 55px of height to spell "1st half", and a first
   * half is very often a SINGLE ROW — the whole forty minutes arrives as one
   * container. On one sample sheet that row is 30px tall, so the band was
   * there and its name was not, while the second half below it (eight rows,
   * 240px) read perfectly. "I can see 2nd half but I can't see 1st half" is
   * what that looks like from the outside, and it is not the same bug as the
   * one where the name hid behind the column headings — it just looks it.
   */
  short: string;
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
 * "Build to Kick Off", "NRL - COAST v RANGERS - Kick off", "KICK OFF —
 * GAME TWO", "Kick Off: NRLW - Harbour v Rivers". A tail rule like the one
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

/**
 * Quarters, for the sports played in four of them — netball, Australian rules,
 * basketball.
 *
 * The sample netball sheets are the most regular documents in the whole corpus.
 * All three print the same seven things in the same order:
 *     "1st Quarter (15 Mins)"            900s   ← the quarter
 *     "1st Quarter Break (5:00mins)"     300s   ← the break after it
 *     "2nd Quarter Commences (15mins)"   900s
 *     "Half Time (15mins)"               900s
 *     "3rd Quarter Commences (15mins)"   900s
 *     "3rd Quarter Break (5:00mins)"     300s
 *     "4th Quarter Commences (15mins)"   900s
 * and close on "Full Time".
 *
 * The trap is that the quarter and the break after it are named almost
 * identically — "1st Quarter" against "1st Quarter Break" — and the same tail
 * rule that separates the halves from the things inside them separates these
 * too, because "Break" is a bare word where the quarter has only a bracketed
 * length. "Commences" has to be allowed through explicitly; it is the one word
 * these sheets put between the name and the bracket.
 *
 * The decoys are the usual crowd — "READ 12 - 1st QTR Wrap", "Wrap Scores &
 * Quarter Update", "Cameras & MC on standby throughout quarter for…" — and
 * none of them survive having to end at the phrase.
 */
const ORDINALS = ["1st|first", "2nd|second", "3rd|third", "4th|fourth"] as const;
const QUARTER = ORDINALS.map((o) => period(String.raw`(?:${o})\s+(?:quarter|qtr)(?:\s+commences)?`));
/** The five minutes between two quarters. Half time is matched separately. */
/**
 * Extra time — golden point, and whatever a competition calls its equivalent.
 *
 * Three decoys, all of them found by reading the sheets rather than guessed:
 *
 *  · "Extra Time Buffer" (300-360s) is on five NRL sheets and is NOT extra
 *    time. It sits BEFORE full time and holds a slot in the schedule in case
 *    the game needs one — banding it would put an extra-time stripe on every
 *    game that finished on time.
 *  · "Holding" is not a marker of anything. One sheet has nine of them, spread
 *    across the whole afternoon, as ordinary standby cues — even though the
 *    block this app INSERTS uses HOLDING for its own gaps.
 *  · the block this app inserts names its periods "<label> — first half" and
 *    "<label> — second half", which the halves rule above matches exactly. On
 *    a double-header that put a spurious "1st half" band on the second game,
 *    because the block sits immediately after the first game's full time and
 *    therefore at the top of the second game's stretch. Extra time is found
 *    FIRST for that reason, and the period scans skip anything inside it.
 */
/**
 * A row that says full time — where PLAY stops.
 *
 * `findDecisionPoints` knows these rows too, and deliberately returns nothing
 * for a sheet that writes its own endings out: there is no result left to ask
 * for, so there is no decision point. But the row still says full time and the
 * football still stopped there, so the periods still need it.
 *
 * Without it the last period ran to the end of the game's whole STRETCH, which
 * on such a sheet includes every win, lose and draw branch and the build-up to
 * the next match. Measured on a four-game sheet: a second half band sitting
 * over gates-open, the walk-in and the anthem of the following game.
 *
 * Same two patterns as `findDecisionPoints`, including its exclusions — a full
 * time WRAP or a highlights read is about the game, not the end of it.
 */
const FULL_TIME_ROW = /^(?:[^\n]*?\b)?full[-\s]?time\b/i;
const NOT_THE_SIREN = /\bwrap\b|\bread\b|\bhighlights?\b|\bpost[-\s]?match\b/i;

const EXTRA_TIME = /\b(?:golden\s?(?:point|goal|try)|extra\s?time|sudden death|drop[-\s]?off)\b/i;

/**
 * Is this row the extra period ITSELF, rather than something after it?
 *
 * Shared with the timing engine, which has to tell one shape of ending block
 * from the other and cannot read titles itself — see `PlanRow.extraTime`.
 * Same test the period rail uses, so the two cannot drift apart.
 */
export const isExtraTimeRow = (title: string): boolean => EXTRA_TIME.test(title) && !NOT_EXTRA_TIME.test(title);
/**
 * A slot held in case it is needed is not the thing happening, and a sheet
 * saying there will be NONE is the opposite of one.
 *
 * All three found by sweeping the corpus, not by imagining them:
 * "Extra Time Buffer" (5 sheets), "Extra Time Estimate" (2), and
 * "30 MIN GAME CLOCK - NO EXTRA TIME", which is a rule for a shortened
 * exhibition game and would otherwise have been banded as extra time being
 * played.
 */
/**
 * Shared with `isSuddenDeathRow` rather than copied there. These words were
 * found by sweeping the sample sheets and they are the difference between a
 * period and a slot held in case one is needed; a second copy of them would
 * drift the first time somebody widened one.
 */
export const NOT_EXTRA_TIME = /\b(?:buffer|estimate|allowance)\b|\bno\s+(?:extra\s?time|golden)/i;

/**
 * How much longer a rival has to be before it takes the break.
 *
 * The break between two halves is chosen as the LONGEST row named for it,
 * because on a real sheet the candidates are "STANDBY FOR HALF TIME" with no
 * length, "HALF TIME (15 mins)" at 900s, and a crowd-DJ track at 110s: first
 * and last both pick the wrong one, longest picks the break.
 *
 * But `durationSec` is a LIVE number. Holding a row, nudging it, adding time —
 * all of them write to it during a show, and a bare `>` means two candidates a
 * few seconds apart can swap places while somebody is calling, and the band
 * down the side of the sheet jumps. Requiring a clear margin makes that
 * impossible without changing any real answer: the sheets this was measured on
 * separate 900s from 110s, which is thirteen times this figure.
 */
const BREAK_MARGIN_SEC = 60;
/** Longer, and by enough that a live edit cannot have caused it. */
const longerBy = (a: number | null | undefined, b: number | null | undefined): boolean =>
  (a ?? -1) >= (b ?? -1) + BREAK_MARGIN_SEC;

const QUARTER_BREAK = /(?:1st|first|2nd|second|3rd|third)\s+(?:quarter|qtr)\s+break\b/i;

export function findPhases(rows: readonly PhaseRow[], gameEnds: readonly number[]): Phase[] {
  const out: Phase[] = [];
  const titleAt = (i: number) => (rows[i]?.title ?? "").split("\n")[0]?.trim() ?? "";
  const matches = (re: RegExp, from: number, to: number): number[] => {
    const hits: number[] = [];
    for (let i = Math.max(0, from); i <= Math.min(to, rows.length - 1); i++) if (re.test(titleAt(i))) hits.push(i);
    return hits;
  };
  /** As above, but blind to extra time — see the note where `extras` is built. */
  const playMatches = (re: RegExp, from: number, to: number): number[] => matches(re, from, to).filter((i) => !insideExtra(i));
  /**
   * Where the football stops, for a period that would otherwise run to the end
   * of the game's whole stretch. The full-time row itself belongs to the
   * period it closes.
   */
  const stopsAt = (from: number, to: number): number => {
    for (let i = Math.max(0, from); i <= Math.min(to, rows.length - 1); i++) {
      const t = titleAt(i);
      if (FULL_TIME_ROW.test(t) && !NOT_THE_SIREN.test(t)) return i;
    }
    return to;
  };

  // Full time closes a game. With none named, the whole sheet is one game;
  // with several, each stretch between them is its own, and each gets its own
  // set of halves — a double-header has two second halves and they must not
  // be run together into one long one.
  /**
   * Extra time, worked out before anything else and then kept out of the way.
   *
   * Each stretch of extra time is one run of rows naming it. Runs are split
   * where a NEW PIECE OF PLAY begins between two of them — a kick-off, a
   * quarter, a full time — rather than by counting rows apart, because that
   * is what actually distinguishes "one long golden-point section" from "two
   * games that each went to golden point". On the four-game test sheet the
   * blocks are 28 rows apart and separated by "KICK OFF — GAME TWO"; on a
   * cue sheet with one golden-point section the rows in it are up to 21 apart
   * with nothing between them. A row count would have to sit between 21 and
   * 27 to tell those two cases apart, which is not a rule, it is a fit.
   *
   * A splitter that is ITSELF extra time does not split: "GOLDEN POINT Kick
   * off" is both a kick-off and part of the golden point it opens.
   */
  const extraHits: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const t = titleAt(i);
    if (EXTRA_TIME.test(t) && !NOT_EXTRA_TIME.test(t)) extraHits.push(i);
  }
  const extras: { from: number; to: number; label: string; game: number }[] = [];
  if (extraHits.length > 0) {
    const splitters = new Set<number>(gameEnds);
    for (const re of [KICK_OFF, ...QUARTER, FIRST_HALF, SECOND_HALF])
      for (const i of matches(re, 0, rows.length - 1)) splitters.add(i);
    for (const i of extraHits) splitters.delete(i);

    let run: number[] = [extraHits[0]!];
    const close = () => {
      const from = run[0]!;
      const to = run[run.length - 1]!;
      const golden = run.some((i) => /golden/i.test(titleAt(i)));
      extras.push({ from, to, label: golden ? "Golden point" : "Extra time", game: Math.max(1, gameEnds.filter((e) => e <= from).length) });
    };
    for (let k = 1; k < extraHits.length; k++) {
      const prev = run[run.length - 1]!;
      const here = extraHits[k]!;
      const broken = [...splitters].some((sp) => sp > prev && sp < here);
      if (broken) {
        close();
        run = [here];
      } else run.push(here);
    }
    close();
  }
  const insideExtra = (i: number) => extras.some((x) => i >= x.from && i <= x.to);

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
     * "HALF TIME (15 mins)" (900s) and "Crowd DJ - Stadium Beats HALF TIME"
     * (110s) — first would take the standby, last would take the music.
     *
     * A length of zero is not a tie-breaker against nothing: on another sheet
     * every half-time row is a 30-second stinger named "Half Time - 13
     * Minutes", and it is still the break. So a missing length sorts below a
     * present one, and equal lengths go to whichever comes first.
     */
    const breakAt = (from: number, to: number): number | null => {
      const hits = playMatches(HALF_TIME, from, to);
      if (hits.length === 0) return null;
      return hits.reduce((best, i) => (longerBy(rows[i]?.durationSec, rows[best]?.durationSec) ? i : best));
    };

    /**
     * Quarters first, where the sheet plays in them.
     *
     * Asked before the halves because the two vocabularies overlap: a netball
     * sheet names Half Time at the end of its second quarter, and reading that
     * as the middle of a game played in halves would band the first two
     * quarters as one long first half and the last two as one long second.
     * Two quarters are required, not one — a single match is not four
     * quarters' worth of evidence, and "Quarter Update" appears on sheets that
     * have nothing to do with them.
     */
    const quarters = QUARTER.map((re) => playMatches(re, start, end)[0] ?? null);
    if (quarters.filter((q) => q != null).length >= 2) {
      const known = quarters.map((q, i) => ({ q, i })).filter((x): x is { q: number; i: number } => x.q != null);
      for (let k = 0; k < known.length; k++) {
        const { q, i } = known[k]!;
        const nextStart = known[k + 1]?.q ?? stopsAt(q, end) + 1;
        // The break between two quarters: a named quarter break, or half time
        // at the halfway line. Longest wins, for the reason given below.
        const gap = playMatches(QUARTER_BREAK, q + 1, nextStart - 1).concat(playMatches(HALF_TIME, q + 1, nextStart - 1));
        const brk = gap.length === 0 ? null : gap.reduce((best, j) => (longerBy(rows[j]?.durationSec, rows[best]?.durationSec) ? j : best));
        out.push({ from: q, to: (brk ?? nextStart) - 1, label: `${i + 1}${["st", "nd", "rd", "th"][i]} qtr`, short: `${i + 1}Q`, kind: "quarter", game: n });
        if (brk != null && k + 1 < known.length)
          out.push({
            from: brk,
            to: nextStart - 1,
            label: HALF_TIME.test((rows[brk]?.title ?? "").split("\n")[0]?.trim() ?? "") ? "Half time" : "Break",
            short: "HT",
            kind: "break",
            game: n,
          });
      }
      start = end + 1;
      continue;
    }

    // Named halves first; kick-off only where the sheet does not name them.
    // The sheets that spell out FIRST HALF are the ones that also give the
    // period its full length, so preferring them keeps the band on the
    // container rather than on the countdown cue in front of it.
    const named = playMatches(FIRST_HALF, start, end)[0] ?? null;
    const half = breakAt((named ?? start) + 1, end);
    const kickoffs = playMatches(KICK_OFF, start, half ?? end);
    const first = named ?? (kickoffs.length > 0 ? kickoffs[kickoffs.length - 1]! : null);

    const namedSecond = first == null ? null : playMatches(SECOND_HALF, first + 1, end)[0] ?? null;
    const second =
      namedSecond ?? (half == null ? null : playMatches(KICK_OFF, half + 1, end)[0] ?? null);

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
    if (first != null) out.push({ from: first, to: (half ?? second ?? end + 1) - 1, label: "1st half", short: "1H", kind: "first-half", game: n });
    if (half != null && second != null) out.push({ from: half, to: second - 1, label: "Half time", short: "HT", kind: "half-time", game: n });
    if (second != null)
      out.push({ from: second, to: stopsAt(second, end), label: "2nd half", short: "2H", kind: "second-half", game: n });

    start = end + 1;
  }
  /**
   * Extra time last, and it wins where it overlaps.
   *
   * A period whose band would run INTO extra time is cut back to stop where it
   * starts. That happens on a sheet with no full-time row at all: the second
   * half is given the rest of the stretch for want of anywhere better to end,
   * and on one cue sheet that stretch includes forty rows of golden point.
   * Extra time is the more specific claim, so it takes the rows.
   */
  for (const x of extras) {
    for (const p of out) {
      if (p.from >= x.from && p.to <= x.to) p.to = p.from - 1; // wholly inside: drop
      else if (p.to >= x.from && p.from < x.from) p.to = x.from - 1;
    }
    out.push({ from: x.from, to: x.to, label: x.label, short: x.label === "Golden point" ? "GP" : "ET", kind: "extra-time", game: x.game });
  }
  out.sort((a, b) => a.from - b.from);

  // A phase that ran backwards would paint a rail of negative height.
  return out.filter((p) => p.to >= p.from);
}
