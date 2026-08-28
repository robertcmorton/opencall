import { parseDurationShorthand, parseTimeOfDay } from "./format";

/**
 * Run-sheet import: turn an extracted text grid (from XLSX/XLS/CSV/PDF) into
 * classified, tolerantly-parsed rows ready for a mapping preview. Everything
 * here is pure — file extraction lives in the web app; this module owns the
 * messy real-world semantics and is unit-tested against synthetic grids
 * modeled on real production house styles.
 */

// ── Tolerant value parsers ────────────────────────────────────────────────────

/**
 * Real-world duration cells: "3 mins", "1min 27 secs", "30 secs", "0:90:00"
 * (spreadsheet oddity meaning 90 minutes), "08:00" (minutes:seconds), "2h",
 * "15 seconds", "0mins", plus everything parseDurationShorthand takes.
 * Returns whole seconds, or null when the cell just isn't a duration.
 */
export function parseDurationLoose(raw: string): number | null {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/^[~≈]/, "")
    .replace(/\s+/g, " ");
  if (s === "") return null;

  // Worded units, e.g. "1min 27 secs", "3 mins", "15 seconds", "2 hrs".
  const worded = s.match(
    /^(?:(\d+)\s*(?:hours?|hrs?|h)\b)?\s*(?:(\d+)\s*(?:minutes?|mins?|m)\b)?\s*(?:(\d+)\s*(?:seconds?|secs?|s)\b)?$/,
  );
  if (worded && (worded[1] || worded[2] || worded[3])) {
    return (
      (worded[1] ? parseInt(worded[1], 10) * 3600 : 0) +
      (worded[2] ? parseInt(worded[2], 10) * 60 : 0) +
      (worded[3] ? parseInt(worded[3], 10) : 0)
    );
  }
  // "0mins" and friends: a unit with zero.
  if (/^0\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)$/.test(s)) return 0;

  // Spreadsheet time-formatted durations that leaked AM/PM: "0:90:00 am".
  const leaked = s.match(/^(\d+):(\d{1,2}):(\d{2})\s*(?:am|pm)$/);
  if (leaked) return parseInt(leaked[1]!, 10) * 3600 + parseInt(leaked[2]!, 10) * 60 + parseInt(leaked[3]!, 10);

  // Summed parts: "40mins + 3mins", "1hr + 15 mins".
  if (s.includes("+")) {
    const parts = s.split("+").map((p) => parseDurationLoose(p));
    if (parts.length > 1 && parts.every((p) => p != null)) return parts.reduce((a, b) => a! + b!, 0);
  }

  // H:MM:SS where MM may overflow ("0:90:00" = 90 minutes).
  const colon = s.match(/^(\d+):(\d{1,3}):(\d{2})$/);
  if (colon) return parseInt(colon[1]!, 10) * 3600 + parseInt(colon[2]!, 10) * 60 + parseInt(colon[3]!, 10);

  // "MM:SS" (also covers "08:00" → 8 minutes).
  const two = s.match(/^(\d{1,3}):(\d{2})$/);
  if (two) return parseInt(two[1]!, 10) * 60 + parseInt(two[2]!, 10);

  return parseDurationShorthand(s);
}

/**
 * Real-world time-of-day cells: "5:00:00PM" (no space), "6:00:00 pm",
 * "16:00:00", "4:30pm", "0900" (military), "16:14:30", "9am". Returns
 * seconds since midnight, or null.
 */
export function parseTimeLoose(raw: string): number | null {
  let s = raw.trim().toLowerCase().replace(/\./g, ":");
  if (s === "") return null;
  // Glue a space before a trailing am/pm ("5:00:00pm" → "5:00:00 pm").
  s = s.replace(/(\d)(am|pm)$/, "$1 $2");
  // Military "0900" / "1615".
  const military = s.match(/^([01]\d|2[0-3])([0-5]\d)$/);
  if (military) return parseInt(military[1]!, 10) * 3600 + parseInt(military[2]!, 10) * 60;
  return parseTimeOfDay(s);
}

// ── Header detection & column mapping ─────────────────────────────────────────

/**
 * A duration cell that has also caught the row's TIME: "0:40:00 8:02:00 PM".
 *
 * PDF extraction assigns text to columns by where it sits on the page, and on
 * some rows the time lands in the duration's band — the TIME cell comes out
 * empty and the DUR cell holds both values with a space between them. The
 * whole string parses as neither, so the row falls through to whatever the
 * next merged line offers.
 *
 * On a real sheet that cost both halves of the match their length: the DUR
 * cell said `0:40:00 8:02:00 PM`, the next line said `0:05:00`, and forty
 * minutes of football was imported as five. That one substitution is behind
 * the two forty-minute holes the timing check reports on that sheet AND the
 * live drift it showed, because the rows around it were left with no length
 * to spend.
 *
 * Deliberately narrow: the remainder must parse as a TIME. "45mins - 1hr" and
 * "6 mins 15 mins" are genuinely ambiguous cells that the import screen asks
 * about, and taking the first thing that looks like a duration would answer a
 * question the sheet has not answered.
 */
export function durationFromMixedCell(raw: string): string | null {
  return splitMixedCell(raw)?.duration ?? null;
}

/**
 * The row's TIME, when it has landed in the duration's cell.
 *
 * The other half of the same artefact. `0:40:00 8:02:00 PM` is a duration AND
 * a start, and the TIME cell it should have been in is empty — so recovering
 * only the duration left the first half of the match with a length but no
 * time of its own, cascading from whatever sat above it.
 */
export function startFromMixedCell(raw: string): string | null {
  return splitMixedCell(raw)?.start ?? null;
}

/** Splits `"0:40:00 8:02:00 PM"` into its duration and its time. */
function splitMixedCell(raw: string): { duration: string; start: string } | null {
  const m = /^\s*(\S+)\s+(.+)$/.exec(raw);
  if (!m) return null;
  const head = m[1]!;
  const rest = m[2]!.trim();
  if (parseDurationLoose(head) == null) return null;
  if (parseTimeLoose(rest) == null) return null;
  return { duration: head, start: rest };
}

export type ColumnTarget =
  | { kind: "title" }
  | { kind: "start" }
  | { kind: "duration" }
  | { kind: "type" }
  | { kind: "department"; key: string; title: string }
  | { kind: "skip" };

const TITLE_HEADERS = ["title", "item", "name", "action", "activity", "segment", "cue", "description"];
const START_HEADERS = ["start", "start time", "time", "time of day", "tod"];
const DURATION_HEADERS = ["duration", "dur", "length", "run time", "runtime", "rt"];
const TYPE_HEADERS = ["type", "row type"];
const NUMBER_HEADERS = ["#", "no", "no.", "item #", "item no"];

/** Department headers used only to SCORE header rows during detection. */
const DEFAULT_TITLE_TO_KEY = new Map<string, true>([
  ["audio", true],
  ["video", true],
  ["lights", true],
  ["graphics", true],
  ["script", true],
  ["production notes", true],
  ["prod notes", true],
]);

/** Common department headers — used only to SCORE header rows, never to fold columns. */
const DEPARTMENT_DETECTION_HEADERS = [
  "audio", "video", "lights", "graphics", "script", "notes", "location",
  "track", "big screen", "side panel", "led", "screen", "who", "what",
  "vtr", "gfx", "cameras", "camera", "crew", "read",
];

/** Values that identify an untitled column as the cue-type column. */
const CUE_TYPE_TOKENS = new Set([
  "audio", "gfx", "vtr", "led", "pa", "mc", "ga", "dj", "hk", "crew", "pyro",
  "lighting", "super", "takeover", "score", "note", "cam", "live vision",
  "live vsn", "gfx and led", "vtr and led", "gfx & led", "dj booth", "sting",
  "trk", "track", "vt", "cam", "scr", "ob", "ppt", "stills",
]);

function normalizeHeader(cell: string): string {
  return cell.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Score how header-like a row is (count of recognized header keywords). */
function headerScore(row: string[]): number {
  let score = 0;
  for (const cell of row) {
    const h = normalizeHeader(cell);
    if (!h) continue;
    if (
      TITLE_HEADERS.includes(h) ||
      START_HEADERS.includes(h) ||
      DURATION_HEADERS.includes(h) ||
      TYPE_HEADERS.includes(h) ||
      NUMBER_HEADERS.includes(h) ||
      DEFAULT_TITLE_TO_KEY.has(h) ||
      DEPARTMENT_DETECTION_HEADERS.includes(h)
    )
      score += 1;
  }
  return score;
}

/**
 * Finds the most header-like row near the top of the grid. Real sheets bury
 * the header under multi-line title blocks, so the scan window is generous
 * (30 rows); the preview also lets the user override the pick.
 */
export function detectHeaderRow(grid: string[][]): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(grid.length, 30); i++) {
    const score = headerScore(grid[i]!);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 2 ? best : 0;
}

/**
 * Folds a heading printed over two or three lines back into one.
 *
 * A narrow column headed "TIME OF DAY" is printed as "TIME OF" above "DAY",
 * and a PDF hands those over as two separate lines. The detector then picks
 * the middle line — the one carrying most of the headings — and that line has
 * a HOLE exactly where each stacked heading was. The column comes through
 * unnamed, so a sheet's times are never recognised as times and almost nothing
 * gets a fixed start.
 *
 * A neighbouring line belongs to the heading when it does nothing but fill
 * those holes: every word it has sits where the header row has nothing, it
 * carries fewer cells than the header does, and it holds words rather than
 * values. A row of data fails all three.
 *
 * Returns the merged names and the lines that were consumed, which are part of
 * the heading and must not be read as the first rows of the sheet.
 */
export function foldWrappedHeader(grid: string[][], headerIndex: number): { headers: string[]; folded: number[] } {
  const header = grid[headerIndex];
  if (!header) return { headers: [], folded: [] };
  const filled = header.filter((c) => c.trim()).length;
  if (filled === 0) return { headers: header, folded: [] };

  // Words, not values: a heading fragment is a short run of letters. Anything
  // with a digit in it is a time, a duration or a count — that is a data row.
  const headingWords = (cell: string): boolean => /^[A-Za-z][A-Za-z &/'.-]{0,23}$/.test(cell);

  const parts: { cells: string[]; above: boolean }[] = [];
  const folded: number[] = [];
  for (const [index, above] of [
    [headerIndex - 1, true],
    [headerIndex + 1, false],
  ] as const) {
    const line = grid[index];
    if (!line) continue;
    const cells = line.map((c) => c.trim());
    const count = cells.filter(Boolean).length;
    if (count === 0 || count >= filled) continue;
    if (!cells.every((c, i) => !c || (!header[i]?.trim() && headingWords(c)))) continue;
    parts.push({ cells, above });
    folded.push(index);
  }
  if (parts.length === 0) return { headers: header, folded: [] };

  const before = parts.find((p) => p.above)?.cells;
  const after = parts.find((p) => !p.above)?.cells;
  const headers = header.map((cell, i) => [before?.[i] ?? "", cell.trim(), after?.[i] ?? ""].filter(Boolean).join(" "));
  return { headers, folded };
}

/**
 * Splits a heading that arrived as one piece of text covering two columns.
 *
 * A PDF does not hand over cells, it hands over runs of text, and a narrow
 * DURATION column butted against ACTIVITY can be emitted as the single run
 * "DURATION ACTIVITY". It is placed in one column and the other is left with
 * no heading at all — so on a sheet whose durations are perfectly readable,
 * nothing is mapped to duration and the whole run sheet imports with no
 * lengths and a total of zero. The title then falls to whatever is left,
 * which on that sheet was the item-number column.
 *
 * Only split where the sheet is unambiguous: the cell must be exactly two
 * known headings side by side, and the column that would receive the second
 * must have no heading of its own to lose.
 */
export function splitRunTogetherHeadings(headers: string[]): string[] {
  const known = (h: string): boolean =>
    TITLE_HEADERS.includes(h) ||
    START_HEADERS.includes(h) ||
    DURATION_HEADERS.includes(h) ||
    TYPE_HEADERS.includes(h) ||
    NUMBER_HEADERS.includes(h) ||
    DEFAULT_TITLE_TO_KEY.has(h) ||
    DEPARTMENT_DETECTION_HEADERS.includes(h);

  const out = [...headers];
  for (let i = 0; i < out.length - 1; i++) {
    if ((out[i + 1] ?? "").trim()) continue; // the neighbour has its own name
    const words = normalizeHeader(out[i] ?? "").split(" ").filter(Boolean);
    if (words.length < 2) continue;
    for (let cut = 1; cut < words.length; cut++) {
      const left = words.slice(0, cut).join(" ");
      const right = words.slice(cut).join(" ");
      if (!known(left) || !known(right)) continue;
      // Keep the sheet's own spelling, not the normalised one — every titled
      // column carries its heading through verbatim.
      const raw = (out[i] ?? "").trim().split(/\s+/);
      out[i] = raw.slice(0, cut).join(" ");
      out[i + 1] = raw.slice(cut).join(" ");
      break;
    }
  }
  return out;
}

/**
 * Maps each source column to a rundown target. The title goes to the
 * STRONGEST candidate — "ITEM" is a row-number column on many real sheets, so
 * it only wins when nothing better (ACTION, ACTIVITY, TITLE…) exists; losing
 * title-synonyms are skipped as numbering. Every non-structural column
 * becomes a column in the rundown, mirroring the source sheet's format;
 * `sampleRows` lets untitled columns be recognized by their DATA (a header-
 * less column full of VTR/PA/GFX tokens is the cue-type column, and a
 * header-less column with any other content still imports as "Column N"
 * instead of being dropped).
 */
export function mapColumns(headers: string[], sampleRows: string[][] = []): ColumnTarget[] {
  const normalized = headers.map(normalizeHeader);
  // Priority: earlier entries in TITLE_HEADERS beat later ones; "item" is last.
  const priority = ["title", "name", "activity", "action", "segment", "cue", "description", "item"];
  let titleIndex = -1;
  for (const candidate of priority) {
    const at = normalized.indexOf(candidate);
    if (at >= 0) {
      titleIndex = at;
      break;
    }
  }
  // Compound headers — "ITEM / ACTION", "SEGMENT / CONTENT", "CUE DESCRIPTION"
  // — match none of those outright, and a sheet headed that way came in with no
  // title column at all: every cue row arrived blank, with only milestones
  // saved by their own fallback. So when nothing matched exactly, take a header
  // that CONTAINS one of the words.
  //
  // Two guards, because "cue" and "item" also head columns that are not the
  // title: never a header that is already doing a structural job, and among
  // what is left prefer the column carrying the most text. The title column is
  // the wordy one — that is what makes it the title column.
  if (titleIndex < 0) {
    const structural = (h: string): boolean =>
      NUMBER_HEADERS.includes(h) || START_HEADERS.includes(h) || DURATION_HEADERS.includes(h) || TYPE_HEADERS.includes(h);
    const textPerRow = (col: number): number => {
      if (sampleRows.length === 0) return 0;
      return sampleRows.reduce((sum, row) => sum + (row[col] ?? "").trim().length, 0) / sampleRows.length;
    };
    let best = -1;
    let bestScore = -1;
    normalized.forEach((h, i) => {
      if (structural(h)) return;
      if (!priority.some((word) => new RegExp(`\\b${word}\\b`).test(h))) return;
      const score = textPerRow(i);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best >= 0) titleIndex = best;
  }

  const usedKeys = new Set<string>();
  const uniqueKey = (base: string): string => {
    let key = base;
    let n = 2;
    while (usedKeys.has(key)) key = `${base}-${n++}`;
    usedKeys.add(key);
    return key;
  };
  const usedTitles = new Set<string>();
  const uniqueTitle = (base: string): string => {
    let title = base;
    let n = 2;
    while (usedTitles.has(title.toLowerCase())) title = `${base} (${n++})`;
    usedTitles.add(title.toLowerCase());
    return title;
  };

  return headers.map((cell, i) => {
    const h = normalized[i]!;
    if (i === titleIndex) return { kind: "title" };
    if (NUMBER_HEADERS.includes(h) || /^\d+$/.test(h) || TITLE_HEADERS.includes(h)) return { kind: "skip" };
    if (START_HEADERS.includes(h)) return { kind: "start" };
    if (DURATION_HEADERS.includes(h)) return { kind: "duration" };
    if (TYPE_HEADERS.includes(h)) return { kind: "department", key: uniqueKey("type"), title: "Type" };

    if (!h) {
      // Untitled column: recognize it by what it contains.
      const values = sampleRows.map((row) => (row[i] ?? "").trim().toLowerCase()).filter(Boolean);
      if (values.length === 0) return { kind: "skip" };
      // Pure row numbering (sheets often mirror # on the right edge) → skip.
      if (values.filter((v) => /^\d+$/.test(v)).length / values.length >= 0.9) return { kind: "skip" };
      const typeish = values.filter((v) => CUE_TYPE_TOKENS.has(v)).length;
      if (typeish / values.length >= 0.5)
        return { kind: "department", key: uniqueKey("type"), title: uniqueTitle("Type") };
      return { kind: "department", key: uniqueKey(`column-${i + 1}`), title: uniqueTitle(`Column ${i + 1}`) };
    }

    // Every titled column keeps its header VERBATIM as the column name —
    // the imported rundown mirrors the source sheet exactly.
    return { kind: "department", key: uniqueKey(h.replace(/\W+/g, "-")), title: uniqueTitle(cell.trim()) };
  });
}

// ── Row classification ────────────────────────────────────────────────────────

export interface ClassifiedRow {
  kind: "cue" | "milestone" | "banner" | "spacer";
  title: string;
  /** Parsed start (anchor) seconds, when the row carries one. */
  startSec: number | null;
  /** Raw start text that failed to parse (flagged in the preview). */
  startRaw: string | null;
  durationSec: number | null;
  durationRaw: string | null;
  /**
   * Lengths this row's duration cell held besides the one taken, added up.
   *
   * A wrapped row can arrive carrying two: a half is written "0:40:00" and
   * then "0:05:00" for extra time on the line beneath, and the merge that
   * joins those lines into one row kept the first and dropped the second.
   * Held here rather than acted on — see `adoptExtraDurations`, which spends
   * it only where the sheet's own times prove it should be spent.
   */
  durationExtraSec?: number;
  cells: Record<string, string>;
  /** Source row index in the original grid (for the preview). */
  sourceIndex: number;
  /** The sheet's own number for this row (its ITEM/# cell), when it has one. */
  sourceNumber?: string;
  /** Detected outcome branch ("win" | "lose" | "draw" | "golden") — sport
   *  sheets carry alternate full-time endings; the caller picks one live. */
  outcome?: string | null;
  /** Words meant to be READ ALOUD, not performed — feeds the prompter. */
  script?: boolean;
  /** Which game's endings this row belongs to (1, 2, 3…) — a day can hold several. */
  outcomeGame?: number;
  /** Shot alongside the running order — a pre-record. See `detectAlongside`. */
  parallel?: boolean;
  /** Covers the rows beneath it rather than preceding them. See `detectBlocks`. */
  spans?: boolean;
}

/**
 * Tags alternate-ending blocks from their banner rows: "Fulltime - X WIN",
 * "Full Time (DRAW)", "GOLDEN POINT Kick off"… A trigger row starts a block
 * that runs until the next trigger (or the end of the sheet). A full-time
 * DRAW block is tagged "golden" — in NRL a level score goes to golden point,
 * and that block carries the extra-time content.
 */
export function detectOutcomes(rows: ClassifiedRow[]): void {
  const trigger = (title: string): string | null => {
    const t = title.toLowerCase();
    const fullTime = /\bfull\s?time\b/.test(t);
    // "Golden point" names the block; "extra time" on its own does NOT. The
    // phrase turns up in ordinary notes ("allow extra time for egress") and
    // treating it as a trigger opened an ending block that swallowed the rest
    // of the sheet — 130 rows on one real run sheet.
    const extra = /\bgolden\s?point\b/.test(t);
    const drawn = /\bdrawn?\b/.test(t);
    // A draw is only a real ending once extra time has been played. At full
    // time a level score does not end the match — it sends it to golden point,
    // and the block under that banner is the extra-time period. So a drawn
    // result NAMED alongside extra time is its own ending, and "full time,
    // draw" on its own still opens the golden-point block.
    if (drawn && extra) return "draw";
    if (fullTime && /\bwin\b/.test(t)) return "win";
    if (fullTime && /\b(lose|loss|lost)\b/.test(t)) return "lose";
    if (extra) return "golden";
    if (fullTime && drawn) return "golden";
    return null;
  };

  /**
   * A kick-off says the day has moved on to the NEXT match. It closes whatever
   * ending block is open, and it is the only thing that makes the next banner
   * a different game's — three endings for one game (win, lose, golden point)
   * are three blocks, not three games.
   */
  // Deliberately NOT "next match": sheets close their ending blocks with a plug
  // for the next FIXTURE ("Next Match Round 14"), weeks away. Reading that as a
  // second game today split one match's win / lose / golden-point blocks across
  // three games, and the chooser then asked about a game that did not exist.
  const startsGame = (title: string): boolean =>
    /\bkick\s?off\b|\bpre[-\s]?game\b|\bwarm\s?up\b/i.test(title);

  let current: string | null = null;
  let game = 0;
  // The first ending banner opens game 1; after that, only a kick-off does.
  let nextIsNewGame = true;
  for (const r of rows) {
    if (r.kind === "spacer") continue;
    const next = trigger(r.title);
    if (next) {
      if (nextIsNewGame) {
        game += 1;
        nextIsNewGame = false;
      }
      current = next;
      r.outcome = current;
      r.outcomeGame = game;
      continue;
    }
    if (startsGame(r.title)) {
      current = null;
      nextIsNewGame = true;
      continue;
    }
    if (current == null) continue;
    // A milestone is the sheet's own marker for a fixed moment — the day has
    // reached something that happens whatever the result, so the block closes.
    // It is NOT a new game: the next banner is still this match's.
    if (r.kind === "milestone") {
      current = null;
      continue;
    }
    r.outcome = current;
    r.outcomeGame = game;
  }
}

/**
 * Classifies data rows using the mapping:
 * - spacer: every mapped cell empty (dropped on import);
 * - banner: a title but no time, no duration, and no department content
 *   (section headings like "MAIN SHOW" → group rows);
 * - milestone: a start time but no duration ("Gates Open", "TEAM LIST DUE");
 * - cue: everything else.
 * Unparseable start/duration text is preserved in *Raw for the preview.
 */
export function classifyRows(grid: string[][], headerIndex: number, mapping: ColumnTarget[]): ClassifiedRow[] {
  const headerRow = grid[headerIndex]!;
  const out: ClassifiedRow[] = [];

  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]!;
    // Repeated page headers (PDF extraction) are dropped.
    if (headerScore(row) >= 2 && row.join("|") === headerRow.join("|")) continue;

    let title = "";
    let startRaw = "";
    let durationRaw = "";
    /** Other lengths this row's DUR cell held. See `adoptExtraDurations`. */
    const durationExtra: number[] = [];
    /** A time that came out of the DUR cell — used only if TIME is empty. */
    let strayStart = "";
    const cells: Record<string, string> = {};
    let departmentContent = false;

    mapping.forEach((target, col) => {
      const value = (row[col] ?? "").trim();
      if (!value) return;
      if (target.kind === "title") title = title ? `${title} ${value}` : value;
      else if (target.kind === "start") {
        // Merged multi-line cells may hold several lines; the first parseable one wins.
        for (const line of value.split("\n")) {
          const v = line.trim();
          if (!v) continue;
          if (!startRaw || (parseTimeLoose(startRaw) == null && parseTimeLoose(v) != null)) startRaw = v;
        }
      } else if (target.kind === "duration") {
        for (const line of value.split("\n")) {
          const text = line.trim();
          if (!text) continue;
          // A line that is a duration with the row's time glued on carries
          // both. Take the duration rather than falling to the next line, and
          // keep the time for the start column, which came out empty.
          const v = parseDurationLoose(text) == null ? durationFromMixedCell(text) ?? text : text;
          if (parseDurationLoose(text) == null) {
            const rescued = startFromMixedCell(text);
            if (rescued && !strayStart) strayStart = rescued;
          }
          const took = !durationRaw || (parseDurationLoose(durationRaw) == null && parseDurationLoose(v) != null);
          if (took) {
            // The line being replaced was a real duration that lost only on
            // ordering; it still counts as one of the lines this cell held.
            const displaced = parseDurationLoose(durationRaw);
            if (displaced != null) durationExtra.push(displaced);
            durationRaw = v;
          } else {
            const spare = parseDurationLoose(v);
            if (spare != null) durationExtra.push(spare);
          }
        }
      }
      else if (target.kind === "department") {
        cells[target.key] = cells[target.key] ? `${cells[target.key]}\n${value}` : value;
        departmentContent = true;
      }
    });

    const empty = !title && !startRaw && !durationRaw && !departmentContent;
    if (empty) {
      out.push({ kind: "spacer", title: "", startSec: null, startRaw: null, durationSec: null, durationRaw: null, cells: {}, sourceIndex: i });
      continue;
    }

    // The sheet's own TIME cell always wins; the rescued one only fills a gap
    // it left. A row that says when it happens is never overruled by a value
    // recovered from a neighbouring column.
    if (!startRaw && strayStart) startRaw = strayStart;
    const startSec = startRaw ? parseTimeLoose(startRaw) : null;
    const durationSec = durationRaw ? parseDurationLoose(durationRaw) : null;

    let kind: ClassifiedRow["kind"] = "cue";
    if (title && !startRaw && !durationRaw && !departmentContent) kind = "banner";
    else if (startSec != null && !durationRaw) kind = "milestone";

    out.push({
      kind,
      title,
      startSec,
      startRaw: startRaw && startSec == null ? startRaw : null,
      durationSec,
      durationRaw: durationRaw && durationSec == null ? durationRaw : null,
      durationExtraSec: durationExtra.reduce((a, b) => a + b, 0) || undefined,
      cells,
      sourceIndex: i,
    });
  }
  return out;
}

/**
 * The sheet's own item/cue-number column: mostly pure integers with enough of
 * them to matter. Drives wrapped-row merging AND the rundown's row numbering
 * (which mirrors the sheet — see `sourceNumber`).
 */
/**
 * An item number in the sheet's own numbering column. Real run sheets insert
 * late additions as "129a"/"129b" rather than renumber the whole document, so
 * a trailing letter still opens a row — treating those as unnumbered
 * continuation lines merges them into the row above and drags their times
 * with them, which scrambles the running order.
 */
const ITEM_NUMBER = /^\d{1,4}[a-z]?$/i;

/**
 * Classification PLUS everything that makes a row match its source line: the
 * sheet's own item number, and which alternate ending it belongs to.
 *
 * This exists as one function because it used not to be. The import screen
 * re-classified the grid on its own — so it could reflect the user's fixes to
 * unparseable cells — and in doing so quietly produced rows with NO item
 * numbers and NO outcome branches, while the preview it was built from had
 * both. Every sheet imported that way lost its numbering. Anything that turns
 * a grid into rows must come through here.
 */
/**
 * Is this cell a botched time or duration, or simply not one?
 *
 * A run sheet uses its TIME and DUR columns for other things on some rows — a
 * team list puts positions there, a pre-show row says "TBC". Those are not
 * mistakes to be corrected; the sheet is right and there is nothing to fix.
 * Only a value that was clearly REACHING for a time deserves to be flagged,
 * and every one of those has a digit in it ("7.3O pm", "0:9O:00", "2 mins").
 *
 * Two more that have a digit and still are not attempts at a value:
 *
 * - A BRACKETED value — "(4:25)", "(0:00)". Sheets bracket what they mean as
 *   an aside, and this one is a second clock: the elapsed time within a
 *   segment, printed beside the real times. Reading it as a start would put
 *   the row at twenty-five past four in the morning.
 * - PAGE FURNITURE — "Page 3" — which is not on the row at all; it is the
 *   footer, caught by the column it happens to sit under.
 *
 * Both stay visible verbatim beside the row. They are simply not questions.
 */
export const looksLikeBotchedValue = (raw: string): boolean => {
  const v = raw.trim();
  if (!/\d/.test(v)) return false;
  if (/^\(.*\)$/.test(v)) return false;
  if (/^page\s*\d+$/i.test(v)) return false;
  // A digit alone is not enough. An event plan reuses these columns for room
  // allocations — "Changeroom 3", "Radio Box No. 2", "LEVEL 1 OUTLETS" — and
  // asking someone to correct twenty of those as if they were mistyped times
  // buries the one that really is one. A value reaching for a time is SHAPED
  // like one: numbers either side of a separator, a unit, a meridiem, or a
  // bare military figure.
  return (
    // A digit against a separator ("12:", ":30", "7.3O") — but "No. 2" has a
    // space after its dot, and that space is the whole difference between a
    // mistyped time and a room number.
    /\d\s*[:.]/.test(v) ||
    /[:.]\d/.test(v) ||
    // A number against a unit, spelt any of the usual ways ("2 mins", "1030hrs").
    /\d\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)\b/i.test(v) ||
    /\b(am|pm)\b/i.test(v) ||
    /^\d{3,4}$/.test(v)
  );
};

export function classifySheet(
  grid: string[][],
  headerIndex: number,
  mapping: ColumnTarget[],
  italicText?: string[],
): ClassifiedRow[] {
  const rows = classifyRows(grid, headerIndex, mapping);
  // Row numbering mirrors the sheet: each row carries ITS OWN number (first
  // line of it for merged rows); rows the sheet didn't number get none.
  const numberCol = detectNumberColumn(grid, headerIndex);
  if (numberCol != null) {
    for (const r of rows) {
      const value = (grid[r.sourceIndex]?.[numberCol] ?? "").split("\n")[0]!.trim();
      if (ITEM_NUMBER.test(value)) r.sourceNumber = value;
    }
  }
  adoptInlineStarts(rows);
  adoptInlineDurations(rows);
  collapseRepeatedBanners(rows);
  // After the collapse — the sheet prints the period name twice, and the pair
  // to join is the timed row and ONE caption — and before everything that
  // reads a title, because a half only announces its outcomes once it has a
  // name.
  adoptCaptionTitles(rows);
  // Before the passes that read durations — a half that is really forty-five
  // minutes has to be forty-five before anything reasons about what covers
  // what.
  adoptExtraDurations(rows);
  detectAlongside(rows);
  detectBlocks(rows);
  detectOutcomes(rows);
  detectScript(rows, italicText);
  return rows;
}


/**
 * Marks the rows whose length COVERS what follows instead of preceding it.
 *
 * "NRL | BULLDOGS v RABBITOHS- HALF TIME (15 mins)" is a quarter of an hour,
 * and the wrap, the review, the ad reel and the giveaway beneath it are also
 * that quarter of an hour. Both are true — it is the same fifteen minutes
 * written twice, once as a block and once as its contents — and counted in
 * sequence the sheet claims half an hour it has not got.
 *
 * The test is an identity, not a resemblance: does dropping this row's own
 * duration make the chain land EXACTLY on the next printed time? A block's
 * children fill it by construction, so they do; a cue that genuinely runs
 * before them does not. Across the sample sheets that fires on six rows —
 * five half-times and a half of football — and on nothing else.
 *
 * Two guards, both earned. The children must add up to something: where they
 * sum to zero, "dropping the block lands exactly" only means the next row
 * starts when this one does, which is simultaneity and not containment, and
 * that alone accounted for both of the rule's false positives. And the match
 * must be exact — sixty-seven rows across those sheets come within a minute,
 * and every one of them is an ordinary cue.
 */
export function detectBlocks(rows: ClassifiedRow[]): void {
  // Where each row sits if the sheet is read straight through. Anchors reset
  // it, exactly as the cascade does.
  const startOf: (number | null)[] = [];
  let cursor: number | null = null;
  for (const r of rows) {
    if (r.startSec != null) cursor = r.startSec;
    startOf.push(cursor);
    if (cursor != null && !r.parallel) cursor += r.durationSec ?? 0;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const own = row.durationSec ?? 0;
    if (own <= 0 || row.parallel || row.startSec == null) continue;
    const start = startOf[i];
    if (start == null) continue;

    let children = 0;
    let j = i + 1;
    while (j < rows.length && rows[j]!.startSec == null) {
      if (rows[j]!.kind !== "spacer" && !rows[j]!.parallel) children += rows[j]!.durationSec ?? 0;
      j += 1;
    }
    if (j >= rows.length || j === i + 1) continue;
    if (children <= 0) continue; // simultaneity, not containment
    const next = rows[j]!.startSec;
    if (next == null) continue;

    const withoutBlock = Math.abs(start + children - next);
    const withBlock = Math.abs(start + own + children - next);
    if (withoutBlock < 1 && withBlock >= 1) row.spans = true;
  }
}


/**
 * Two identical headings in a row are one heading printed twice.
 *
 * A sheet can carry the same banner on consecutive lines — a rule drawn
 * across two rows, a period name repeated for emphasis — and the source here
 * does exactly that: "NRL | BULLDOGS v RABBITOHS - FIRST HALF" appears as two
 * adjacent rows with nothing whatever between them. Read faithfully that is
 * two section headings for one section, and the sheet gains a heading that
 * announces nothing.
 *
 * Only ADJACENT duplicates, and only banners. A banner that recurs later in
 * the day is a real second occurrence — a sheet says HALF TIME once per game —
 * and anything with a time or a duration is a row, not a heading.
 */
export function collapseRepeatedBanners(rows: ClassifiedRow[]): void {
  const same = (a: ClassifiedRow, b: ClassifiedRow) =>
    a.kind === "banner" && b.kind === "banner" && a.title.trim() !== "" && a.title.trim() === b.title.trim();
  for (let i = rows.length - 1; i > 0; i--) {
    let prev = i - 1;
    while (prev >= 0 && rows[prev]!.kind === "spacer") prev -= 1;
    if (prev >= 0 && same(rows[prev]!, rows[i]!)) rows.splice(i, 1);
  }
}

/**
 * Spends a length the row was carrying but not counting — but only where the
 * sheet's own times prove it should be spent.
 *
 * A half is written as two lengths: "0:40:00", and "0:05:00" for extra time on
 * the line beneath. Those lines belong to one row, and the merge that joins
 * them kept the first and dropped the second — so the app scheduled a
 * forty-minute half where the sheet had planned forty-five, and then reported
 * the missing five as a fault in the sheet. Twice a game, on most of the match
 * sheets here.
 *
 * Adding them up wherever they appear is NOT safe: of the seventeen rows in
 * the sample carrying two lengths, some are two lengths for one row and some
 * are junk (one reads "00:30" and "7"), and nothing in the text distinguishes
 * them. So this does not decide — it asks the sheet. The extra is taken only
 * when adding it lands the running order EXACTLY on the next printed time and
 * leaving it out does not. On a half that is decisive: kick-off at 8:02 plus
 * forty is 8:42 and half time is printed at 8:47, plus five it is 8:47 to the
 * second. Where the times do not settle it, nothing is spent and the row keeps
 * the length it always had.
 */
export function adoptExtraDurations(rows: ClassifiedRow[]): void {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const extra = row.durationExtraSec ?? 0;
    if (extra <= 0 || row.durationSec == null || row.startSec == null) continue;
    // Everything between this row and the next printed time is spent too.
    let between = 0;
    let j = i + 1;
    for (; j < rows.length; j++) {
      const r = rows[j]!;
      if (r.kind === "spacer") continue;
      if (r.startSec != null) break;
      between += r.durationSec ?? 0;
    }
    const anchor = rows[j]?.startSec;
    if (anchor == null) continue;
    const reach = row.startSec + row.durationSec + between;
    if (Math.abs(reach + extra - anchor) < 1 && Math.abs(reach - anchor) >= 1) row.durationSec += extra;
  }
}

/**
 * Gives a timed row the name printed on the line beneath it.
 *
 * A game's halves are the spine of a match-day sheet, and this is how the
 * sheets write them: the timing on a numbered line with nothing in the item
 * column — `87 | 0:40:00 8:02:00 PM` — and the name alone on the next line,
 * `NRL | BULLDOGS v RABBITOHS - FIRST HALF`, printed across the width. Read
 * faithfully that is two rows: forty anonymous minutes, and a heading. So the
 * halves arrived as headings, and a heading is a piece of page furniture that
 * everything below it hangs from — which is exactly what it should not be. The
 * first half IS the row that runs from kick-off; the cues inside it are not
 * its children, they are what happens during it.
 *
 * The pair is only ever joined when the name row is a BANNER with no number of
 * its own. A banner by construction carries nothing but its title — no time,
 * no length, no department content — so a row with its own item number, its
 * own roles and its own screen content can never be swallowed. That
 * distinction is the whole safety of this: across twenty sheets the loose
 * reading (any titled row after an untitled timed one) matched 39 places, and
 * on the two densest cue sheets those were real neighbouring cues — a DJ cue
 * #62 next to a GFX cue #63 — which joining would have destroyed. The banner
 * rule matches 15, and every one of them is a game half.
 */
export function adoptCaptionTitles(rows: ClassifiedRow[]): void {
  /**
   * A cell holding nothing but a dash is an empty cell.
   *
   * Sheets type one where they mean to leave the item blank, and so did our
   * own soak-test generator until today — which means a sheet already imported
   * can carry hundreds. Without this the timing row reads as a row NAMED "—",
   * the caption below it is never adopted, and re-importing the same file
   * cannot repair a sheet that predates the fix.
   */
  const untitled = (r: ClassifiedRow): boolean => /^[\s—–-]*$/.test(r.title);
  const nextReal = (from: number): number => {
    let j = from;
    while (j < rows.length && rows[j]!.kind === "spacer") j += 1;
    return j;
  };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.kind === "spacer" || !untitled(row)) continue;
    if (row.startSec == null && row.durationSec == null) continue;
    const j = nextReal(i + 1);
    const caption = rows[j];
    if (!caption || caption.kind !== "banner") continue;
    if (caption.sourceNumber?.trim()) continue;
    if (caption.title.trim() === "") continue;
    row.title = caption.title;
    rows.splice(j, 1);
  }
}

/** A clock time with a meridiem, sitting at the very end of the text. */
const TRAILING_CLOCK = /[\s(\[|-]*\b(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?\s*([ap])\.?\s*m\.?\s*$/i;

/**
 * Takes the time a row wrote into its title.
 *
 * Run sheets are typed by people, and a row whose TIME cell is empty often
 * carries its time at the end of the description instead — "Clear Field
 * 6:25:00PM", "TWO MINUTE BELL 8:56:00 PM", "FMs, Announcers, DJ arrive
 * 4:30:00PM". Read as untimed, those rows are scheduled wherever the durations
 * above happen to land: one sheet showed the production meeting at 4:00 when
 * the sheet plainly said 4:45. The time was on the page; the app was not
 * looking at it.
 *
 * Two conditions keep this from inventing anchors:
 *
 * 1. The time must END the title. Across 3347 untimed rows in the sample
 *    sheets, all 42 matches were trailing and every one was that row's own
 *    start — a time in the MIDDLE of a sentence is prose ("doors from 6pm
 *    until kick-off") and is left alone.
 * 2. It must fit between the anchors that bracket it. Two of those 42 were
 *    typos in the source — a "TWO MINUTE BELL 3:56:00 PM" among rows running
 *    at 20:44 — and anchoring those would drag a row hours out of place. A
 *    time that does not fit the running order is not this row's start, so the
 *    text stays in the title where a human can see it.
 */
export function adoptInlineStarts(rows: ClassifiedRow[]): void {
  // The anchors already known, so a candidate can be checked against them.
  // Rebuilt from the ORIGINAL starts only: one adopted time must not become
  // the bracket that justifies the next.
  const anchors = rows.map((r) => r.startSec);
  const before = (i: number): number | null => {
    for (let k = i - 1; k >= 0; k--) if (anchors[k] != null) return anchors[k]!;
    return null;
  };
  const after = (i: number): number | null => {
    for (let k = i + 1; k < rows.length; k++) if (anchors[k] != null) return anchors[k]!;
    return null;
  };

  rows.forEach((row, i) => {
    if (row.kind !== "cue" || row.startSec != null || row.startRaw != null) return;
    const m = TRAILING_CLOCK.exec(row.title);
    if (!m) return;
    const hour = Number(m[1]);
    const min = Number(m[2]);
    const sec = Number(m[3] ?? 0);
    if (hour < 1 || hour > 12 || min > 59 || sec > 59) return;
    const pm = m[4]!.toLowerCase() === "p";
    const start = ((hour % 12) + (pm ? 12 : 0)) * 3600 + min * 60 + sec;

    const lo = before(i);
    const hi = after(i);
    if (lo != null && start < lo) return;
    if (hi != null && start > hi) return;

    row.startSec = start;
    // The time now lives in the start column; leaving it in the title too
    // would print it twice on every surface.
    row.title = row.title.slice(0, m.index).replace(/[\s(\[|,-]+$/, "");
  });
}

/**
 * A line that OPENS with "pre record" — the recording, not the playback.
 *
 * Anchored to the start of a line rather than searched for anywhere, and that
 * is the whole of the rule. See `detectPreRecords`.
 */
const PRE_RECORD_LEAD = /^[\s|>*-]*pre[-\s]?rec(?:ord(?:ing)?)?\b/im;

/**
 * "TWO MINUTE BELL", "2 min bell" — the warning, counted down to a moment.
 *
 * Deliberately not just "bell". Real sheets ring bells on camera as part of
 * the show: "RINGING THE BELL", "BELL RINGING MOMENT ON CAMERA", "LX - BELL
 * LIGHTS ON", and a read that begins "Ringing the legacy bell tonight is…".
 * Those are cues and must stay cues. The pattern is the LENGTH of the warning
 * followed by the word, which is how every genuine one is written.
 */
const MINUTE_BELL = /\b(?:\d{1,2}|one|two|three|four|five|ten)[-\s]?min(?:ute)?s?\s+bell\b/i;

/**
 * Marks the rows that run ALONGSIDE the show rather than in it.
 *
 * A pre-record is recorded while the running order carries on around it — the
 * coin toss in the tunnel at 7:02 while the crowd is being warmed up — and
 * played out later as a VTR. It belongs on the sheet, because it occupies
 * people and cameras, but it takes none of the running order's time and it
 * cannot be running late against it.
 *
 * The rule is that a LINE of the title must OPEN with "pre record", and the
 * reason is the other half of every pre-record: its playback. Real sheets
 * carry both, and they look almost identical to a search:
 *
 *     "Pre Record - COIN TOSS with Jacob Kertabani"   CREW   ← the recording
 *     "VTR - Pre Record - Coin Toss"                  VTR    ← the playback
 *     "MC Chat with Dem Mob"  (cell: "Dem Mob Pre record")   ← the playback
 *
 * The playback is an ordinary cue that genuinely takes seventy-five seconds of
 * the show, and pulling it out of the running order would be a far worse error
 * than the one this fixes. So a mention anywhere is not enough: the row has to
 * announce itself as one, which is what a sheet's author does when the row IS
 * the recording. Matching on cell text was tried against the sample sheets and
 * caught four playbacks; matching on the lead caught none.
 *
 * Multi-line because a merged PDF row can carry the label on its second line
 * ("Extra Buffer ⏎ Pre Record - PLAYER WALK OVER").
 */
export function detectAlongside(rows: ClassifiedRow[]): void {
  for (const row of rows) {
    if (row.kind === "spacer") continue;
    // A pre-record is shot while the show goes on; a two-minute bell is a
    // WARNING rung during whatever is on air. Neither is a thing to take a cue
    // on, and both take none of the running order's time — a bell carrying
    // four minutes of duration was spending four minutes the show does not.
    if (PRE_RECORD_LEAD.test(row.title) || MINUTE_BELL.test(row.title)) row.parallel = true;
  }
}

/** "(15 Mins)", "(5:00mins)", "(3 Sec)" — a length written into the name. */
const TRAILING_LENGTH = /\((\d{1,3})(?::(\d{2}))?\s*(m(?:in(?:ute)?s?)?|s(?:ec(?:ond)?s?)?)\.?\)\s*$/i;

/**
 * Takes the length a row wrote into its title.
 *
 * The same habit as `adoptInlineStarts`, in the other column: "1st Quarter
 * (15 Mins)", "Half Time (15mins)", "Crew Brief Commence (30 mins)" — the
 * length is on the page, in the name, with the DUR cell left empty. Untimed,
 * a fifteen-minute quarter advanced the running order by nothing, and the
 * netball sheets reported a seventeen-minute hole across every period of play.
 *
 * Only rows with NO duration are touched. Where a sheet fills in both — the
 * NRL half-time rows carry 15:00 in DUR and "(15 mins)" in the name — the
 * parsed cell already agrees and there is nothing to add.
 *
 * The text stays in the title. It reads as part of the item's name on these
 * sheets ("2nd Quarter Commences (15mins)"), and the rows that already parse
 * keep it, so removing it only here would make two identical-looking rows
 * differ for no reason the reader can see.
 */
export function adoptInlineDurations(rows: ClassifiedRow[]): void {
  for (const row of rows) {
    // A MILESTONE is a row with a start and no duration — a moment rather than
    // a block. That is precisely the row this rule is about to give a length
    // to, so it stops being a moment: "1st Quarter Break (5:00mins)" is five
    // minutes of the day, not an instant in it. Left as a milestone the
    // duration would be dropped again on the way out of `buildSheet`.
    if (row.kind !== "cue" && row.kind !== "milestone") continue;
    if (row.durationSec != null || row.durationRaw != null) continue;
    const m = TRAILING_LENGTH.exec(row.title.trim());
    if (!m) continue;
    const seconds = m[3]!.toLowerCase().startsWith("s");
    // "(5:00mins)" is five minutes and no seconds; a seconds part alongside a
    // seconds unit is not a spelling anyone uses, so it is left alone.
    if (seconds && m[2] != null) continue;
    const value = seconds ? Number(m[1]) : Number(m[1]) * 60 + Number(m[2] ?? 0);
    if (!Number.isFinite(value) || value <= 0 || value > 6 * 3600) continue;
    row.durationSec = value;
    row.kind = "cue";
  }
}

/**
 * Marks the rows that are WORDS TO BE READ ALOUD rather than things to do.
 *
 * Run sheets set them in italic — a presenter's read, an interview question,
 * an announcement — and that is the signal used here, because it is the one
 * the sheet's author actually intended. A row counts as script when its title
 * text was italic in the source and it carries no time, duration or cue type
 * of its own: an italic aside inside a normal cue is decoration, not a read.
 *
 * Without italics (a CSV, a plain export) nothing is marked, which is the
 * honest outcome — inventing script from sentence length would put stage
 * directions and notes in front of a presenter mid-show.
 */
/**
 * Words in sentences, as opposed to a label or an instruction.
 *
 * Case carries the distinction on a run sheet: things said are written like
 * speech ("Please welcome to the field, tonight's special guest!"),
 * while cues and directions are shouted in capitals ("LX - STAGE BACK LIGHTS
 * ON", "WALK-ON - EDIT 2"). Length alone puts those in front of a presenter.
 */
const isProse = (line: string): boolean => {
  const words = line.split(/\s+/).filter(Boolean);
  const spoken = words.filter((w) => /^[a-z]/.test(w)).length;
  if (words.length >= 6 && spoken >= 3) return true;
  return /[.!?]$/.test(line) && words.length >= 3 && spoken >= 1;
};

export function detectScript(rows: ClassifiedRow[], italicText?: string[]): void {
  if (!italicText || italicText.length === 0) return;
  const italic = new Set(italicText.map((t) => t.replace(/\s+/g, " ").trim()).filter(Boolean));
  if (italic.size === 0) return;
  // Which rows are set in italic — necessary, but not sufficient. A row may
  // carry the italic read AND the line that pays it off ("…the one and only /
  // LADIES AND GENTLEMEN, WELCOME TO THE FIELD … THEIR NAME!"), which the sheet
  // sets in bold. Those belong together, so a non-italic line is tolerated as
  // long as it too is speech.
  const allItalic = rows.map((row) => {
    if (row.kind === "spacer") return false;
    const lines = row.title.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.length === 0) return false;
    const italicLines = lines.filter((l) => italic.has(l));
    if (italicLines.length === 0) return false;
    return lines.every((l) => italic.has(l) || isProse(l));
  });

  // Pass one seeds on italic PROSE: sentences someone says. An italic label
  // ("WALK-ON - EDIT 2", "Back Announce") is a name or a stage direction, and
  // putting either in front of a presenter mid-show would be worse than
  // missing it. Timing and cue types are not disqualifying — the opening line
  // of a read normally carries both.
  for (let i = 0; i < rows.length; i++) {
    if (!allItalic[i]) continue;
    const lines = rows[i]!.title.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.some(isProse)) rows[i]!.script = true;
  }

  // Pass two extends through the block: a short italic line sitting between
  // two spoken ones is part of the same read — "<Captain to speak>",
  // "Thank you." — and belongs with it.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!allItalic[i] || row.script) continue;
    // …but never a row that names its own piece of media. An italic track
    // title sitting right after a read is still a track, not a line to say.
    if (Object.values(row.cells).some((v) => CUE_TYPE_TOKENS.has(v.trim().toLowerCase()))) continue;
    if (rows[i - 1]?.script || rows[i + 1]?.script) row.script = true;
  }

  // Pass three picks up the lines a read runs into that are not italic at all:
  // the hole left when an author misses the italics mid-sentence, and the
  // pay-off line a sheet sets in bold to close a welcome ("Please welcome to
  // the field, tonight's special guest!"). Both sit directly against
  // spoken lines and have nothing of their own to do — no time, no duration,
  // no cue. Judged against the rows marked BEFORE this pass, so one absorbed
  // line cannot drag the next cue in after it.
  const seeded = rows.map((r) => r.script === true);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (row.script || row.kind === "spacer") continue;
    if (!seeded[i - 1] && !seeded[i + 1]) continue;
    if (row.startSec != null || row.durationSec != null) continue;
    if (Object.values(row.cells).some((v) => v.trim())) continue;
    const lines = row.title.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    if (lines.length > 0 && lines.every(isProse)) row.script = true;
  }

  // A read is not a section header. Rows with nothing but text classify as
  // banners, which is how a paragraph of script ended up rendering as a great
  // grey heading across the sheet — and, because banners carry no cells, is
  // why the marker had nowhere to live. They are cues with no time of their own.
  for (const row of rows) if (row.script && row.kind === "banner") row.kind = "cue";
}

export function detectNumberColumn(grid: string[][], headerIndex: number): number | null {
  const dataRows = grid.slice(headerIndex + 1);
  if (dataRows.length === 0) return null;
  const columnCount = Math.max(...dataRows.map((r) => r.length), 0);
  let best: number | null = null;
  let bestInts = 0;
  for (let c = 0; c < columnCount; c++) {
    let nonEmpty = 0;
    let ints = 0;
    for (const row of dataRows) {
      const v = (row[c] ?? "").trim();
      if (!v) continue;
      nonEmpty += 1;
      if (ITEM_NUMBER.test(v)) ints += 1;
    }
    if (ints >= 5 && ints / Math.max(1, nonEmpty) >= 0.8 && ints > bestInts) {
      best = c;
      bestInts = ints;
    }
  }
  return best;
}

/**
 * Where the sheet's own rows really start, when its header is printed part-way
 * down the first page.
 *
 * Some run sheets open with a block of build-up — content check, production
 * meeting, comms, rehearsals — and only rule in the ITEM/TIME/DURATION heading
 * once the doors are about to open. The heading then repeats at the top of
 * every later page, so it is a perfectly good heading; it simply is not the
 * first line of the table. Everything above it was being discarded as title
 * matter, which on one sheet silently removed its first ten items and moved
 * the show's start three hours later.
 *
 * The test is that the numbering runs straight through: the numbers above the
 * heading must ascend, and the first number below it must be the next one
 * along. Ten items numbered 1…10 above a heading followed by 11 is a heading
 * printed late. Anything else is a coincidence of digits and is left alone.
 *
 * Returns the index the table actually starts at, or `headerIndex` unchanged.
 */
export function reclaimRowsAboveHeader(grid: string[][], headerIndex: number, numberCol: number | null): number {
  if (numberCol == null || headerIndex === 0) return headerIndex;
  const intAt = (i: number): number | null => {
    const v = (grid[i]?.[numberCol] ?? "").trim();
    return ITEM_NUMBER.test(v) && /^\d+$/.test(v) ? Number(v) : null;
  };

  const above: { index: number; n: number }[] = [];
  for (let i = 0; i < headerIndex; i++) {
    const n = intAt(i);
    if (n != null) above.push({ index: i, n });
  }
  // Three is the fewest that can show a run rather than an accident.
  if (above.length < 3) return headerIndex;
  for (let i = 1; i < above.length; i++) if (above[i]!.n !== above[i - 1]!.n + 1) return headerIndex;

  let firstBelow: number | null = null;
  for (let i = headerIndex + 1; i < grid.length && firstBelow == null; i++) firstBelow = intAt(i);
  if (firstBelow == null || firstBelow !== above[above.length - 1]!.n + 1) return headerIndex;

  return above[0]!.index;
}

/** Page/vertical position of each extracted grid line (from the PDF extractor). */
export interface LineMeta {
  page: number;
  /** PDF y (grows upward — larger is higher on the page). */
  y: number;
}

/** The table's ruled horizontal lines on one page — authoritative row boundaries. */
export interface RowLines {
  page: number;
  ys: number[];
}

/**
 * The lines a PDF repeats on every page: the running header and footer.
 *
 * Repetition ALONE cannot find these, and the mistake is worth recording.
 * A cue sheet legitimately repeats itself — the contingency block appears
 * once per scoring scenario, so "START STOPWATCH", "Try Scorer LED" and
 * "Try Sting - Freed From Desire" each turn up three or four times. Filing
 * those as page furniture moved 43 live cues off one NRL sheet.
 *
 * What separates them is WHERE they sit. A running header is printed at the
 * same height on every page; a contingency cue falls wherever the running
 * order puts it. So the test is the conjunction: same text, same y, on
 * several different pages. That is a printing artefact, and nothing else is.
 *
 * `y` is the PDF's own coordinate (it grows upward). Rounding absorbs the
 * sub-point drift between pages without letting genuinely different rows
 * collapse together.
 */
export function detectRunningHeaders(
  grid: string[][],
  lineMeta: LineMeta[],
  opts: { minPages?: number; tolerance?: number } = {},
): string[] {
  const minPages = opts.minPages ?? 3;
  const tolerance = opts.tolerance ?? 2;
  const pages = new Set(lineMeta.map((m) => m.page));
  // Two pages cannot establish a pattern, and a one-page sheet has no
  // furniture by definition.
  if (pages.size < minPages) return [];

  // A footer usually carries the PAGE NUMBER, so its text is different on
  // every page — "… NOT FOR EXTERNAL DISTRIBUTION 1", then 2, then 3. Matched
  // literally it never repeats, so the one line printed on all twenty-six
  // pages was the one thing the detector could not see, and it arrived in the
  // sheet as content: a production company's name inside a cue.
  //
  // Numbers are therefore ignored when deciding what repeats — but only for
  // the decision. Every distinct line in a group that qualifies is returned as
  // it was actually printed, so the callers still match whole lines and no
  // real cue is dropped by a near-miss.
  // Only the PAGE NUMBER is ignored — a number is blanked solely where its
  // value is the number of the page it is printed on. Ignoring digits in
  // general is not safe: a team list repeats "Front Row" against jersey 8 on
  // one page and jersey 10 on another, and blanking those made three pages of
  // squad look like one line printed three times. That deleted ten live cues
  // off a run sheet when this was first written the loose way. A jersey number
  // has nothing to do with the page it lands on; a page number is the page.
  // Only the FIRST match is blanked: a line carries one page number. "Page 6
  // of 6" on the sixth page would otherwise have both of its numbers blanked
  // and stop matching "Page 1 of 6", so the last page's footer — and only the
  // last page's — would escape.
  const digitsOut = (text: string, page: number): string => {
    let done = false;
    return text.replace(/\d+/g, (n) => {
      if (done || (Number(n) !== page && Number(n) !== page + 1)) return n;
      done = true;
      return "\u0002";
    });
  };
  const byKey = new Map<string, { texts: Set<string>; perPage: Map<number, number> }>();
  grid.forEach((row, i) => {
    const meta = lineMeta[i];
    if (!meta) return;
    const text = row.map((c) => (c ?? "").trim()).filter(Boolean).join(" ").trim();
    if (!text) return;
    const band = Math.round(meta.y / tolerance);
    const key = `${band}\u0000${digitsOut(text, meta.page)}`;
    const hit = byKey.get(key) ?? { texts: new Set<string>(), perPage: new Map<number, number>() };
    hit.texts.add(text);
    hit.perPage.set(meta.page, (hit.perPage.get(meta.page) ?? 0) + 1);
    byKey.set(key, hit);
  });

  const out: string[] = [];
  for (const { texts, perPage } of byKey.values()) {
    if (perPage.size < minPages) continue;
    // Where the text is identical on every page this is the original test,
    // unchanged. A group that only came together because a page number was
    // ignored has two further conditions, and both are about not handing the
    // callers a string that matches something else:
    //   · once per page — a page number is printed once; a squad position is
    //     printed against every player;
    //   · something other than the number itself. A footer that is nothing BUT
    //     the page number returns as "1", "2", "3" … and a caller matching
    //     whole lines against those will drop any line that is only a number —
    //     which on a run sheet is a jersey number, and cost ten of them.
    if (texts.size > 1) {
      if ([...perPage.values()].some((n) => n > 1)) continue;
      if (!/[A-Za-z]/.test([...texts][0] ?? "")) continue;
    }
    for (const text of texts) if (!out.includes(text)) out.push(text);
  }
  return out;
}

/**
 * PDF text extraction emits one grid row per VISUAL LINE, so a sheet item
 * whose cells wrap (a four-line WHAT column) arrives as several rows — most
 * of them empty shells. Real sheets number their items, and that column is
 * the row boundary: numbered lines start logical rows, every other line is a
 * continuation of a neighbouring item, cell lines joined with newlines.
 *
 * Attachment, in order of authority: (1) `rowLines` — the table's actual
 * ruled borders; two lines between the same pair of rules are the same
 * physical row. A ruled row with NO item number is a section banner when it
 * carries title-column content alone (kept as its own row); otherwise it is
 * a SUB-ROW of a merged item (sheets rule the WHO/WHAT lines inside one
 * item) and joins the previous numbered row. (2) `lineMeta` y-distance to
 * the nearer numbered line (cells are vertically centred, so a wrapped
 * cell's top lines sit ABOVE the item number). (3) The previous numbered
 * line. Without a credible item-number column the grid is returned
 * untouched.
 */
export function mergeWrappedRows(
  grid: string[][],
  headerIndex: number,
  lineMeta?: LineMeta[],
  rowLines?: RowLines[],
  mapping?: ColumnTarget[],
  /** Lines `detectRunningHeaders` identified as page furniture, printed verbatim. */
  furniture?: string[],
): string[][] {
  const headerRow = grid[headerIndex] ?? [];
  const dataRows = grid.slice(headerIndex + 1);
  if (dataRows.length === 0) return grid;

  const columnCount = Math.max(...dataRows.map((r) => r.length), 0);
  const groupCol = detectNumberColumn(grid, headerIndex);
  if (groupCol == null) return grid;

  // Page furniture: the title block, running heads, and footers a document
  // repeats on every page. They carry no item number and no time, so they
  // would otherwise be absorbed as continuation lines of whatever row happens
  // to precede a page break — dragging a page's masthead into a cue title.
  // Identified by repetition: the same text on three or more pages.
  //
  // The page NUMBER is part of the footer, so the line reads differently on
  // every page and matching it literally finds nothing. Numbers are ignored
  // when deciding what repeats; the guard above — never furniture if the line
  // is numbered or timed — is what keeps a real cue safe.
  // Identified by repetition: the same text on three or more pages. Matched
  // LITERALLY here — this test has no idea where on the page a line sits, so
  // loosening it is how a team list ("Front Row" against jersey 8 on one page
  // and 10 on another) starts looking like one line printed three times.
  //
  // A footer carrying the page number never repeats literally, so it cannot be
  // caught here at all. That is what `furniture` is for: `detectRunningHeaders`
  // knows each line's height on the page and can afford to ignore a page
  // number, because it also demands the same height every time.
  const pagesOfText = new Map<string, Set<number>>();
  if (lineMeta) {
    for (let i = headerIndex + 1; i < grid.length; i++) {
      const row = grid[i]!;
      const text = row.join("|").trim();
      const page = lineMeta[i]?.page;
      if (!text || page == null) continue;
      const numbered = ITEM_NUMBER.test((row[groupCol] ?? "").trim());
      const timed = row.some((v) => parseTimeLoose(v) != null || parseDurationLoose(v) != null);
      if (numbered || timed) continue; // real content, however often it repeats
      const seen = pagesOfText.get(text) ?? new Set<number>();
      seen.add(page);
      pagesOfText.set(text, seen);
    }
  }
  const known = new Set(furniture ?? []);
  const isFurniture = (i: number): boolean => {
    const row = grid[i]!;
    if ((pagesOfText.get(row.join("|").trim())?.size ?? 0) >= 3) return true;
    if (known.size === 0) return false;
    // `detectRunningHeaders` joins a line's cells with a space; match it the
    // same way, and never drop a line that carries an item number or a time.
    if (ITEM_NUMBER.test((row[groupCol] ?? "").trim())) return false;
    if (row.some((v) => parseTimeLoose(v) != null || parseDurationLoose(v) != null)) return false;
    return known.has(row.map((c) => (c ?? "").trim()).filter(Boolean).join(" ").trim());
  };

  // Data lines in order, page headers repeated by pagination dropped.
  const lineIdxs: number[] = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i]!;
    if (headerScore(row) >= 2 && row.join("|") === headerRow.join("|")) continue;
    if (isFurniture(i)) continue;
    if (row.some((v) => v.trim())) lineIdxs.push(i);
  }

  // Numbered lines each open an item.
  const itemOf = new Map<number, number>();
  const numbered: number[] = [];
  for (const i of lineIdxs) {
    if (ITEM_NUMBER.test((grid[i]![groupCol] ?? "").trim())) {
      itemOf.set(i, numbered.length);
      numbered.push(i);
    }
  }
  /**
   * A numbering column has to actually number the sheet.
   *
   * Some sheets carry no column headers at all, so the header detector settles
   * on the title block and the number-column detector then picks whichever
   * column happens to hold a few digits — a stand number, a camera number. On
   * one real sheet that was seven lines out of 288, and merging on it folded
   * the entire run sheet into seven rows: every time in it lost, hours long.
   *
   * The bar is deliberately low. Real sheets number as little as a fifth of
   * their lines — the rest are the wrapped continuations this merge exists to
   * fold — so anything stricter switches the merge off where it was working.
   * One line in twelve separates the sheets that number themselves from the
   * one that happened to hold seven digits in a column.
   */
  if (numbered.length < Math.max(3, lineIdxs.length * 0.08)) return grid;

  // Physical-row bands from the ruled lines: band = which inter-rule gap a
  // line's y falls into. Two lines in the same band share a table row.
  const boundsByPage = new Map<number, number[]>();
  for (const b of rowLines ?? []) {
    if (b.ys.length > 0) boundsByPage.set(b.page, [...b.ys].sort((x, y) => y - x));
  }
  const bandOf = (i: number): string | null => {
    const m = lineMeta?.[i];
    if (!m) return null;
    const ys = boundsByPage.get(m.page);
    if (!ys) return null;
    let k = 0;
    while (k < ys.length && ys[k]! > m.y) k++;
    return `${m.page}:${k}`;
  };
  const itemByBand = new Map<string, number>();
  for (const n of numbered) {
    const band = bandOf(n);
    if (band != null && !itemByBand.has(band)) itemByBand.set(band, itemOf.get(n)!);
  }

  // Does this line look like a section banner? Title-column content and
  // nothing in any data column (times, durations, departments).
  const titleOnly = (i: number): boolean => {
    if (!mapping) return true; // no mapping knowledge — keep the row standalone
    let title = false;
    for (let c = 0; c < (grid[i]?.length ?? 0); c++) {
      if (!(grid[i]![c] ?? "").trim()) continue;
      const kind = mapping[c]?.kind ?? "skip";
      if (kind === "title") title = true;
      else if (kind !== "skip") return false;
    }
    return title;
  };

  /**
   * A line that carries its own clock time is a ROW of the sheet, not a
   * wrapped continuation of the one above. Whole blocks go unnumbered on real
   * sheets (everything before the first cue — call times, rehearsals, doors),
   * and folding them into a neighbour swallows every one of their times and
   * collapses the block into a single row hours long.
   */
  const hasOwnTime = (i: number): boolean => {
    if (!mapping) return false;
    for (let c = 0; c < (grid[i]?.length ?? 0); c++) {
      const v = (grid[i]![c] ?? "").trim();
      // Anything the author put in the time column counts, parseable or not:
      // call-time rows are routinely written "TBC" and are still real rows.
      if (v && mapping[c]?.kind === "start") return true;
    }
    return false;
  };

  const itemLines: number[][] = numbered.map((i) => [i]);
  const soloBands = new Map<string, number[]>(); // banner rows, merged per band
  const standalone: number[] = []; // unattachable lines, kept as their own rows
  let prevNum: number | null = null;
  for (const i of lineIdxs) {
    if (itemOf.has(i)) {
      prevNum = i;
      continue;
    }
    const band = bandOf(i);
    if (band != null) {
      const owner = itemByBand.get(band);
      if (owner != null) {
        itemLines[owner]!.push(i);
        continue;
      }
      // Numberless ruled row: a banner keeps its own row; anything else is a
      // sub-row of the item above (ruled WHO/WHAT lines inside one item).
      if (titleOnly(i)) {
        const lines = soloBands.get(band) ?? [];
        lines.push(i);
        soloBands.set(band, lines);
        continue;
      }
      if (hasOwnTime(i)) {
        standalone.push(i);
        continue;
      }
      const nextNum = numbered.find((n) => n > i);
      const target = prevNum != null ? itemOf.get(prevNum)! : nextNum != null ? itemOf.get(nextNum)! : null;
      if (target != null) itemLines[target]!.push(i);
      else standalone.push(i);
      continue;
    }
    // Without ruled lines there is no way to tell a genuine row from a
    // wrapped cell, so a time here still belongs to the item it follows.
    const nextNum = numbered.find((n) => n > i);
    let target: number | null = prevNum != null ? itemOf.get(prevNum)! : null;
    if (lineMeta && nextNum != null) {
      const m = lineMeta[i];
      const nm = lineMeta[nextNum];
      const pm = prevNum != null ? lineMeta[prevNum] : undefined;
      if (m && nm && nm.page === m.page) {
        if (!pm || pm.page !== m.page || Math.abs(m.y - nm.y) < Math.abs(m.y - pm.y))
          target = itemOf.get(nextNum)!;
      }
    }
    if (target == null) standalone.push(i);
    else itemLines[target]!.push(i);
  }

  const build = (idxs: number[]): string[] => {
    const out: string[] = Array.from({ length: columnCount }, () => "");
    for (const i of [...idxs].sort((a, b) => a - b)) {
      grid[i]!.forEach((v, c) => {
        const value = v.trim();
        if (!value) return;
        out[c] = out[c] ? `${out[c]}\n${value}` : value;
      });
    }
    return out;
  };

  // Sheet order is preserved: each unit (item, banner band, or standalone
  // line) lands where its first line appeared.
  const units: { at: number; rows: () => string[] }[] = [
    ...itemLines.map((lines, idx) => ({ at: Math.min(...lines), rows: () => build(itemLines[idx]!) })),
    ...[...soloBands.values()].map((lines) => ({ at: Math.min(...lines), rows: () => build(lines) })),
    ...standalone.map((i) => ({ at: i, rows: () => [...grid[i]!] })),
  ].sort((a, b) => a.at - b.at);
  return [...grid.slice(0, headerIndex + 1), ...units.map((u) => u.rows())];
}

/** Headers that mark the sheet's own role/assignment column (labels vary per production house). */
const ROLE_HEADERS = [
  "who", "role", "roles", "resp", "responsible", "owner", "assigned", "assigned to",
  "crew", "talent", "presenter", "cast", "dept",
];

/** The imported column that carries role assignments, if the sheet has one. */
export function findRoleColumn(headers: string[], mapping: ColumnTarget[]): string | null {
  for (let i = 0; i < mapping.length; i++) {
    const t = mapping[i];
    if (t?.kind === "department" && ROLE_HEADERS.includes(normalizeHeader(headers[i] ?? ""))) return t.key;
  }
  return null;
}

/** One-call pipeline: grid in, header + mapping + classified rows out. */
export function planImport(
  grid: string[][],
  opts: { headerIndex?: number; mergeWrapped?: boolean; lineMeta?: LineMeta[]; rowLines?: RowLines[]; italicText?: string[] } = {},
): {
  grid: string[][];
  headerIndex: number;
  headers: string[];
  mapping: ColumnTarget[];
  roleColumnKey: string | null;
  rows: ClassifiedRow[];
  /** Lines the PDF prints on every page — see `detectRunningHeaders`. */
  runningHeaders: string[];
} {
  let headerIndex = opts.headerIndex ?? detectHeaderRow(grid);
  // Found on the RAW grid, before wrapped rows are merged: that is the only
  // point where a line still matches its own page and y one-for-one.
  const runningHeaders = opts.lineMeta ? detectRunningHeaders(grid, opts.lineMeta) : [];
  const folding = foldWrappedHeader(grid, headerIndex);
  const folded = folding.folded;
  const headers = splitRunTogetherHeadings(folding.headers);
  // A line folded into the heading is part of it, not the first row of the
  // sheet. Blanking it in place rather than removing it keeps every later line
  // at the index `lineMeta` and `rowLines` measured it at.
  let readGrid =
    folded.length === 0 ? grid : grid.map((row, i) => (folded.includes(i) ? row.map(() => "") : row));

  // A heading printed part-way down page one has the sheet's first items ABOVE
  // it. Lift the heading to the top of that block rather than throwing them
  // away — a permutation, so `lineMeta` moves with it and every line keeps the
  // page and y it was measured at.
  let lineMeta = opts.lineMeta;
  {
    const startsAt = reclaimRowsAboveHeader(readGrid, headerIndex, detectNumberColumn(readGrid, headerIndex));
    if (startsAt < headerIndex) {
      const lift = <T,>(arr: T[]): T[] => [
        ...arr.slice(0, startsAt),
        arr[headerIndex]!,
        ...arr.slice(startsAt, headerIndex),
        ...arr.slice(headerIndex + 1),
      ];
      readGrid = lift(readGrid);
      if (lineMeta) lineMeta = lift(lineMeta);
      headerIndex = startsAt;
    }
  }
  const dataRows = readGrid.slice(headerIndex + 1);
  // A data sample lets untitled columns be identified by their contents.
  // The WHOLE sheet, not a sample: an untitled column is identified by what it
  // contains, and "contains nothing" drops it. A column whose data starts on
  // page five — a countdown, a late-running note — looked empty in a 60-row
  // sample and was silently discarded.
  const mapping = mapColumns(headers, dataRows);

  // Centered/right-aligned columns (common in PDF layouts) put header text in
  // a different x-band than the data beneath, leaving the mapped column nearly
  // empty while the values sit in an untitled neighbour. Rescue each
  // structural target by ALSO mapping the data-rich neighbour to it; values
  // accumulate and the first parseable one wins.
  if (dataRows.length > 0) {
    const coverage = (col: number, parses?: (v: string) => boolean): number =>
      dataRows.filter((r) => {
        const v = (r[col] ?? "").trim();
        return v && (!parses || parses(v));
      }).length;

    // Times and durations can both parse as each other ("0:15:00" is a valid
    // time, "2:00:00PM" leaks as a 2-hour duration), so the two targets are
    // rescued JOINTLY: each candidate band is scored by parse coverage minus a
    // distance penalty from the declared header, and a band claimed by one
    // target is excluded from the other. Reading order does the rest — the
    // time band always sits nearer the TIME header than the duration band.
    const claimed = new Set<number>();
    // Rows that open an item. On a sheet where each item spans several printed
    // lines — a WHO column listing AUDIO, then GFX, then GA — only the first
    // line of each item carries the activity, so measuring the title column
    // against EVERY line makes a perfectly good column look two-thirds empty.
    // It was then "rescued" onto the notes column beside it and the two were
    // imported as one, so every cue read "GATES OPEN Control Room - TVC's,
    // graphics. SET DJ on south end bay 5". Judge the title column by the rows
    // that are actually item rows.
    const numberCol = detectNumberColumn(readGrid, headerIndex);
    const itemRows = numberCol == null ? [] : dataRows.filter((r) => ITEM_NUMBER.test((r[numberCol] ?? "").trim()));

    const rescue = (
      kind: "title" | "start" | "duration",
      parses: ((v: string) => boolean) | undefined,
      reach: number,
    ) => {
      const at = mapping.findIndex((t) => t.kind === kind);
      if (at < 0) return;
      const declared = coverage(at, parses);
      if (declared / dataRows.length >= 0.3) return; // the declared column works
      // …and it also works when it is filled in on the item rows themselves.
      if (kind === "title" && itemRows.length >= 10) {
        const onItems = itemRows.filter((r) => (r[at] ?? "").trim()).length;
        if (onItems / itemRows.length >= 0.6) return;
      }
      const penalty = Math.max(1, dataRows.length * 0.08);
      let bestCol = -1;
      let bestScore = -Infinity;
      let bestCoverage = 0;
      mapping.forEach((t, i) => {
        if (t.kind !== "department" || !t.key.startsWith("column-") || claimed.has(i)) return;
        const dist = Math.abs(i - at);
        if (dist > reach) return;
        const c = coverage(i, parses);
        const score = c - dist * penalty;
        if (score > bestScore) {
          bestScore = score;
          bestCol = i;
          bestCoverage = c;
        }
      });
      if (bestCol >= 0 && bestCoverage > Math.max(declared * 2, dataRows.length * 0.1)) {
        mapping[bestCol] = { kind };
        claimed.add(bestCol);
      }
    };

    rescue("start", (v) => parseTimeLoose(v) != null, 3);
    rescue("duration", (v) => parseDurationLoose(v) != null, 3);
    rescue("title", undefined, 6);

    // The same band mismatch hits NAMED department columns: a centred ACTION
    // or NOTES header sits in one band while its left-aligned text sits in
    // another, so the sheet's own column imports empty next to an anonymous
    // "Column 7" holding the real content. Give that content the sheet's name
    // and drop the empty shell, so a rundown carries the sheet's headings over
    // the sheet's data.
    // The test is RELATIVE, not a fixed share of the sheet: notes and other
    // optional columns are legitimately sparse (a couple of dozen rows out of
    // hundreds), so a neighbour only needs to hold clearly more than the
    // named column to be recognised as that column's real content.
    const adopted = new Set<number>();
    mapping.forEach((t, i) => {
      if (t.kind !== "department" || t.key.startsWith("column-")) return;
      const named = coverage(i);
      if (named / dataRows.length >= 0.15) return; // the named column has its data
      let best = -1;
      let bestCoverage = 0;
      for (let distance = 1; distance <= 6 && best < 0; distance++) {
        for (const j of [i - distance, i + distance]) {
          const candidate = mapping[j];
          if (!candidate || candidate.kind !== "department" || !candidate.key.startsWith("column-")) continue;
          if (adopted.has(j) || claimed.has(j)) continue;
          const c = coverage(j);
          if (c > bestCoverage) {
            bestCoverage = c;
            best = j;
          }
        }
      }
      if (best < 0 || bestCoverage < 3 || bestCoverage < named * 3 + 1) return;
      mapping[best] = { kind: "department", key: t.key, title: t.title };
      mapping[i] = { kind: "skip" };
      adopted.add(best);
    });
  }
  const finalGrid = opts.mergeWrapped
    ? mergeWrappedRows(readGrid, headerIndex, lineMeta, opts.rowLines, mapping, runningHeaders)
    : readGrid;
  const rows = classifySheet(finalGrid, headerIndex, mapping, opts.italicText);
  return {
    grid: finalGrid,
    headerIndex,
    headers,
    mapping,
    roleColumnKey: findRoleColumn(headers, mapping),
    rows,
    runningHeaders,
  };
}

// ── Unparseable-cell repair suggestions ───────────────────────────────────────

/**
 * Suggests a fixed spelling for a time cell that failed to parse — wrong
 * separators ("7.30", "7;30"), glued digits ("730pm", "1930"), or a time
 * buried in prose ("TBC 7:30pm"). Returns a string that parses, or null.
 */
export function suggestTimeFix(raw: string): string | null {
  const s = raw.trim();
  if (s === "" || parseTimeLoose(s) != null) return null;
  const sep = s.match(/(\d{1,2})\s*[:.;hH]\s*(\d{2})(?:\s*[:.;]\s*(\d{2}))?\s*(am|pm)?/i);
  if (sep) {
    const cand = `${sep[1]}:${sep[2]}${sep[3] ? `:${sep[3]}` : ""}${sep[4] ? ` ${sep[4].toLowerCase()}` : ""}`;
    if (parseTimeLoose(cand) != null) return cand;
  }
  const glued = s.match(/\b(\d{3,4})\s*(am|pm)?\b/i);
  if (glued) {
    const digits = glued[1]!;
    const cand = `${digits.slice(0, digits.length - 2)}:${digits.slice(-2)}${glued[2] ? ` ${glued[2].toLowerCase()}` : ""}`;
    if (parseTimeLoose(cand) != null) return cand;
  }
  return null;
}

/**
 * Suggests a fixed spelling for a duration cell that failed to parse —
 * "2.30" → "2:30", a duration buried in prose ("approx 5 mins TBC"), or a
 * bare number (treated as minutes). Returns a string that parses, or null.
 */
export function suggestDurationFix(raw: string): string | null {
  const s = raw.trim().toLowerCase();
  if (s === "" || parseDurationLoose(s) != null) return null;
  const sep = s.match(/^(\d{1,3})\s*[.;]\s*(\d{2})$/);
  if (sep) {
    const cand = `${sep[1]}:${sep[2]}`;
    if (parseDurationLoose(cand) != null) return cand;
  }
  const worded = s.match(/(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/);
  if (worded) {
    const cand = `${worded[1]} ${worded[2]}`;
    if (parseDurationLoose(cand) != null) return cand;
  }
  const bare = s.match(/^\D*?(\d{1,3})\D*$/);
  if (bare) return `${bare[1]}:00`; // a lone number in a duration column is minutes
  return null;
}

// ── Role detection ────────────────────────────────────────────────────────────

/** Distinct, readable highlight colours assigned to detected roles in order. */
/** The prompter's colour, fixed: it is the same job on every sheet. */
export const PROMPTER_COLOR = "#c084fc";

export const ROLE_COLORS = [
  "#2dd4bf", "#f59e0b", "#818cf8", "#f472b6", "#34d399", "#38bdf8",
  "#fb923c", "#a78bfa", "#4ade80", "#facc15", "#f87171", "#22d3ee",
];

export interface DetectedRole {
  name: string;
  color: string;
}

/**
 * Mines assigned roles (BGM, Camera 1, PA, VTR…) from classified rows: short
 * cell lines that repeat across the sheet and aren't times or durations. Each
 * role gets a stable colour from the palette, most frequent first. When the
 * sheet has its own role column (WHO, ROLE…) pass its key — roles come from
 * that column alone, with a lower repeat threshold since it IS the roster.
 */
/**
 * One WHO cell → the people it names.
 *
 * Two things get in the way of reading it straight. A cell often says what to
 * DO with someone rather than naming them — "cue DP", "DP cue" — and treated
 * literally those become two separate roles, neither of which is a person.
 * And a cell naming two people by their initials separates them with nothing
 * but a space ("LC JM"), so the pair reads as one unknown role and neither
 * person's rows light up for them.
 *
 * Names are left alone: "Wayne Bennett" is one person, not two.
 */
export function roleTokens(cell: string): string[] {
  let v = cell.trim();
  if (!v) return [];
  // "cue" is the verb, not part of anyone's name.
  v = v.replace(/^cue\s+/i, "").replace(/\s+cue$/i, "").trim();
  if (!v) return [];
  const parts = v.split(/\s+/);
  // Initials only — two or three capitals — split into one role each.
  if (parts.length > 1 && parts.every((p) => /^[A-Z]{2,3}$/.test(p))) return parts;
  return [v];
}

export function detectRoles(
  rows: ClassifiedRow[],
  max = 12,
  roleColumns?: string | string[] | null,
): DetectedRole[] {
  const keys = (typeof roleColumns === "string" ? [roleColumns] : (roleColumns ?? [])).filter(Boolean);
  const counts = new Map<string, { name: string; count: number }>();
  const minCount = keys.length > 0 ? 2 : 3;
  for (const row of rows) {
    const values =
      keys.length > 0
        ? keys.map((k) => row.cells[k]).filter((v): v is string => v != null)
        : Object.values(row.cells);
    for (const value of values) {
      // Multi-role cells are common ("VTR | LED", "GA, GFX") — each part is a role.
      for (const line of value.split(/\n|\s*[|,+]\s*|\s+&\s+|\s+and\s+/i)) {
        for (const v of roleTokens(line)) {
        if (!v || v.length > 24) continue;
        if (/^\d/.test(v)) continue; // numbering, times, "2 x wedges"…
        if (parseTimeLoose(v) != null || parseDurationLoose(v) != null) continue;
        // The prompter marker used to be skipped here as "something this app
        // writes, not a crew position". It is both: whoever runs the prompter
        // is a position like any other, and wants to pick it as their role,
        // see their rows lit up, and find them on the role bar. It still
        // drives the prompter view — that is what the tag is for — and now it
        // is a role as well.
        const key = v.toLowerCase();
        const entry = counts.get(key);
        if (entry) entry.count += 1;
        else counts.set(key, { name: v, count: 1 });
        }
      }
    }
  }
  return [...counts.values()]
    .filter((e) => e.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, max)
    .map((e, i) => ({
      name: e.name,
      // The prompter always gets the same colour wherever it lands in the
      // order — it is the one role that is the same job on every sheet.
      color: e.name.toLowerCase() === PROMPTER_TAG ? PROMPTER_COLOR : ROLE_COLORS[i % ROLE_COLORS.length]!,
    }));
}

// ── Plan → rundown ────────────────────────────────────────────────────────────

/**
 * Where text rescued from a structural column lands. A sheet's TIME or DUR cell
 * that holds a label rather than a value keeps its content under the sheet's
 * own heading for that column.
 */
export const UNPARSED_START_KEY = "start-text";
export const UNPARSED_DURATION_KEY = "duration-text";

/** A row as the rundown stores it. Structural mirror of the doc package's SeedRow. */
export interface BuiltRow {
  type: "cue" | "group" | "milestone";
  title: string;
  durationSec?: number | null;
  hardStartSec?: number | null;
  durationMuted?: boolean;
  untimed?: boolean;
  sourceNumber?: string;
  outcome?: string | null;
  /**
   * Which game on the day this ending belongs to, counting from 1. A sheet with
   * several matches has several sets of endings, and picking a winner for the
   * afternoon game must not skip the evening one's alternatives.
   */
  outcomeGame?: number;
  /** Shot alongside the running order — a pre-record. See `detectAlongside`. */
  parallel?: boolean;
  /** Covers the rows beneath it rather than preceding them. See `detectBlocks`. */
  spans?: boolean;
  cells?: Record<string, string>;
}

/** The value written into a sheet's cue column to send a row to the prompter. */
export const PROMPTER_TAG = "prompter";

/**
 * The column a sheet uses to say what KIND of thing each row is — SCR, TYPE,
 * SOURCE — recognised by its contents (VTR, GFX, LED, CAM…) rather than its
 * name, because every house calls it something different. That is where a
 * marker belongs: the showcaller can see it, and change it, in the same place
 * they already read the cue from.
 */
export function findCueTypeColumn(mapping: ColumnTarget[], rows: ClassifiedRow[]): string | null {
  let best: string | null = null;
  let bestScore = 0;
  for (const target of mapping) {
    if (target.kind !== "department") continue;
    let filled = 0;
    let cueish = 0;
    for (const row of rows) {
      const value = (row.cells[target.key] ?? "").trim().toLowerCase();
      if (!value) continue;
      filled += 1;
      if (CUE_TYPE_TOKENS.has(value)) cueish += 1;
    }
    if (filled < 5 || cueish / filled < 0.6) continue;
    if (cueish > bestScore) {
      bestScore = cueish;
      best = target.key;
    }
  }
  return best;
}

export interface BuiltSheet {
  rows: BuiltRow[];
  columns: { key: string; title: string; width?: number }[];
  roles: DetectedRole[];
  roleColumnKey: string | null;
  /** Every column that says who a row is for — the WHO column and the cue column. */
  roleColumnKeys: string[];
  /** What the document carried that is not the running order. */
  showInfo: ShowInfoBlock[];
  plannedStartSec: number | null;
  baseTitles: { title?: string; start?: string; duration?: string };
  columnOrder: string[];
}

/**
 * Turns a classified sheet into the rundown that gets created.
 *
 * This lived inside the import screen, which meant the rules that decide what
 * the sheet BECOMES — which rows are groups, which times are real, which
 * columns survive and in what order — could not be tested or checked against a
 * source sheet without driving a browser. It is the same conversion either
 * way; only its address changed.
 */
export function buildSheet(
  plan: { headers: string[]; mapping: ColumnTarget[]; rows: ClassifiedRow[]; runningHeaders?: string[] },
  opts: { widths?: (number | null)[]; roleColumnKey?: string | null; roles?: DetectedRole[] } = {},
): BuiltSheet {
  const { headers, mapping } = plan;
  // The masthead the PDF printed on every page belongs beside the sheet, not
  // in it. Geometry decided which lines those are; see `splitShowInfo`.
  const split = splitShowInfo(plan.rows, plan.runningHeaders ?? []);
  // Spacers are the sheet's blank separator lines — they carry nothing.
  const importable = split.rows.filter((r) => r.kind !== "spacer");
  const roleKey = opts.roleColumnKey !== undefined ? opts.roleColumnKey : findRoleColumn(headers, mapping);
  // The cue column names positions — VTR, GFX, LED, CAM — and the people on
  // those desks need to find their rows just as much as the ones named by
  // initials in WHO. Both are role columns.
  const cueKey = findCueTypeColumn(mapping, importable);
  const roleKeys = [roleKey, cueKey].filter((k): k is string => !!k);
  const roles = opts.roles ?? detectRoles(importable, 12, roleKeys);
  const widths = opts.widths ?? [];

  // When the sheet has NO role column of its own, every detected role that
  // appears in a row's cells lands in a synthesized "Roles" column.
  const rolesFor = (r: ClassifiedRow): string => {
    if (roleKey) return "";
    const hay = `${r.title}\n${Object.values(r.cells).join("\n")}`.toLowerCase();
    return roles
      .filter((role) => hay.includes(role.name.toLowerCase()))
      .map((role) => role.name)
      .join(", ");
  };

  // Sparse-timed sheets (cue-sheet style) time only PARENT rows; rows with a
  // blank TIME cell are sub-cues inside that block. Marking them `untimed`
  // keeps the grid faithful — no invented cascade times — and their durations
  // are listed rather than spent: the thirty seconds of each ad inside a
  // three-minute reel.
  //
  // Where the line sits was measured, not guessed. Every sample sheet was
  // imported twice, once spending those durations and once muting them, and
  // scored by how many places the resulting times disagreed with the sheet's
  // own anchors. The two groups separated cleanly and with nothing in between:
  // the sheets that wanted their durations SPENT were 44–49% timed (a match-day
  // run sheet, where the chain is the point), and the ones that wanted them
  // MUTED were 11–22% (a cue sheet, where a timed parent is followed by its
  // contents). At the old 50% threshold every one of them was treated as a cue
  // sheet, and the five run sheets reported two to three times as many faults
  // as they have — 5 became 17 on one of them.
  const cueish = importable.filter((r) => r.kind !== "banner");
  const sparseTimed = cueish.length >= 10 && cueish.filter((r) => r.startSec != null).length / cueish.length < 0.35;

  // Rows the sheet meant to be read aloud are TAGGED in the sheet's own cue
  // column, so the prompter can find them and a showcaller can see — and
  // change — the decision in the place they already read cues from.
  const cueTypeKey = cueKey;

  const rows: BuiltRow[] = importable.map((r) => {
    if (r.kind === "banner")
      return { type: "group", title: r.title, sourceNumber: r.sourceNumber, outcome: r.outcome ?? undefined, outcomeGame: r.outcomeGame, parallel: r.parallel || undefined };
    if (r.kind === "milestone") {
      const fallback = Object.values(r.cells).find((v) => v.trim());
      return {
        type: "milestone",
        title: r.title || fallback || "—",
        durationSec: null,
        hardStartSec: r.startSec,
        parallel: r.parallel || undefined,
        sourceNumber: r.sourceNumber,
        outcome: r.outcome ?? undefined,
        outcomeGame: r.outcomeGame,
        cells: r.cells,
      };
    }
    const assigned = rolesFor(r);
    /**
     * Two different questions, which used to share one answer.
     *
     * `untimed` is about what the sheet SAYS. A row whose TIME cell was blank
     * has no time, and the grid must not print one — on a run sheet the
     * cascade can work out where the row falls, and that number looks exactly
     * like a time somebody typed. A showcaller reading a screen cannot tell an
     * inferred time from a printed one, and will hold a cue to a minute the
     * document never claimed. Blank in, blank out.
     *
     * `durationMuted` is about what the sheet MEANS, and that really does
     * differ by shape: on a cue sheet a timed parent is followed by its
     * contents and their durations are a listing (the thirty seconds of each
     * ad inside a three-minute reel), while on a run sheet the chain IS the
     * point and every duration is spent. That measurement stands — see the
     * note on `sparseTimed` above — so it keeps the sheet-shaped test.
     *
     * Splitting them costs nothing in the running order: `untimed` is not read
     * by computeTiming at all, so the row still takes its duration and the
     * projected end does not move. What changes is that the row stops showing
     * a time nobody wrote, and stops being a target the clock can jump to —
     * which is right, because following the clock means following the times
     * the sheet actually gives.
     */
    const untimed = r.startSec == null;
    const muteDuration = sparseTimed && untimed && r.durationSec != null;
    // Text in a TIME or DUR column that is not a time or a duration — a sheet
    // that puts "Fullback" or "Interchange" in the duration column of a team
    // list — has nowhere to live in a structural column, and used to simply
    // vanish. Keep it beside the row so the rundown still says what the sheet
    // said; the import preview offers to turn it into a real value.
    const spilled: Record<string, string> = {};
    if (r.startRaw) spilled[UNPARSED_START_KEY] = r.startRaw;
    if (r.durationRaw) spilled[UNPARSED_DURATION_KEY] = r.durationRaw;
    // Never overwrite a cue the sheet already gave the row.
    if (r.script && cueTypeKey && !(r.cells[cueTypeKey] ?? "").trim()) spilled[cueTypeKey] = PROMPTER_TAG;
    return {
      type: "cue",
      title: r.title,
      durationSec: r.durationSec,
      hardStartSec: r.startSec,
      untimed: untimed || undefined,
      durationMuted: muteDuration || undefined,
      parallel: r.parallel || undefined,
      spans: r.spans || undefined,
      sourceNumber: r.sourceNumber,
      outcome: r.outcome ?? undefined,
      outcomeGame: r.outcomeGame,
      cells: { ...r.cells, ...spilled, ...(assigned ? { roles: assigned } : {}) },
    };
  });

  // Whoever runs the prompter is a position like any other: they want to pick
  // it as their role, see their rows lit up and find them on the role bar.
  // A sheet that WRITES "prompter" in its cue column is picked up by the
  // ordinary detection; a sheet whose scripts were recognised from their
  // formatting gets the tag added here, after that detection has run — so
  // without this the same job is a role on one sheet and not on another.
  const hasPrompter = rows.some((r) => Object.values(r.cells ?? {}).some((v) => v.trim().toLowerCase() === PROMPTER_TAG));
  if (hasPrompter && !roles.some((r) => r.name.toLowerCase() === PROMPTER_TAG)) {
    roles.push({ name: PROMPTER_TAG.toUpperCase(), color: PROMPTER_COLOR });
  }

  // The structural columns keep the sheet's own header names. Several bands can
  // map to one structural target (a centred header and the data beneath it);
  // the NAMED one is the sheet's own heading.
  const headerFor = (kind: "title" | "start" | "duration"): string | undefined => {
    for (let i = 0; i < mapping.length; i++) {
      if (mapping[i]?.kind !== kind) continue;
      const h = headers[i]?.trim();
      if (h) return h;
    }
    return undefined;
  };

  // The rundown mirrors the sheet: every department column with data, in
  // source order, with the source's own name and a proportional width.
  const usedKeys = new Set(rows.flatMap((r) => Object.keys(r.cells ?? {})));
  const clampWidth = (w: number | null | undefined): number | undefined =>
    w ? Math.min(420, Math.max(80, w)) : undefined;
  const roleColumn: { key: string; title: string; width?: number }[] =
    roles.length > 0 && !roleKey ? [{ key: "roles", title: "Roles", width: 140 }] : [];
  const columns: { key: string; title: string; width?: number }[] = roleColumn.concat(
    mapping
      .map((t, i) => ({ t, i }))
      .filter((x): x is { t: Extract<ColumnTarget, { kind: "department" }>; i: number } => x.t.kind === "department" && usedKeys.has(x.t.key))
      .map(({ t, i }) => ({ key: t.key, title: t.title, width: clampWidth(widths[i]) })),
  );

  // Rescued structural text gets its own column, named after the sheet's
  // heading for the column it came from, and sits immediately beside it.
  const spillColumns: { key: string; title: string; after: string }[] = [];
  if (usedKeys.has(UNPARSED_START_KEY))
    spillColumns.push({ key: UNPARSED_START_KEY, title: `${headerFor("start") ?? "Start"} (text)`, after: "start" });
  if (usedKeys.has(UNPARSED_DURATION_KEY))
    spillColumns.push({ key: UNPARSED_DURATION_KEY, title: `${headerFor("duration") ?? "Duration"} (text)`, after: "duration" });
  for (const c of spillColumns) columns.push({ key: c.key, title: c.title, width: 110 });

  // …and their exact left-to-right POSITIONS: the grid renders this order.
  const columnOrder: string[] = [];
  const push = (key: string) => {
    if (!columnOrder.includes(key)) columnOrder.push(key);
    for (const c of spillColumns) if (c.after === key && !columnOrder.includes(c.key)) columnOrder.push(c.key);
  };
  for (const t of mapping) {
    const key =
      t.kind === "title"
        ? "title"
        : t.kind === "start"
          ? "start"
          : t.kind === "duration"
            ? "duration"
            : t.kind === "department" && usedKeys.has(t.key)
              ? t.key
              : null;
    if (key) push(key);
  }
  if (roleColumn.length > 0) columnOrder.push("roles");

  return {
    rows,
    columns,
    roles,
    roleColumnKey: roleKey ?? (roles.length > 0 ? "roles" : null),
    roleColumnKeys: roleKeys.length > 0 ? roleKeys : roles.length > 0 ? ["roles"] : [],
    plannedStartSec: importable.find((r) => r.startSec != null)?.startSec ?? null,
    baseTitles: { title: headerFor("title"), start: headerFor("start"), duration: headerFor("duration") },
    columnOrder,
    showInfo: split.info,
  };
}

/** A block of a source document that is about the show, but is not the running order. */
export interface ShowInfoBlock {
  kind: "furniture";
  lines: string[];
}

export interface SplitSheet {
  /** The running order — what the sheet is FOR. */
  rows: ClassifiedRow[];
  /** What the document carried besides it, kept rather than dropped. */
  info: ShowInfoBlock[];
}

/**
 * Lift the page furniture out of the running order.
 *
 * A production run sheet is a document as well as a running order: a header
 * on all fourteen pages, a footer under them. Imported flat that arrives as
 * cues, and a showcaller stepping through the sheet at kick-off steps through
 * the masthead once a page.
 *
 * `furniture` comes from `detectRunningHeaders`, which knows WHERE each line
 * was printed. This function does no guessing of its own — an earlier version
 * did, using repetition, and moved 43 live cues off an NRL sheet because a
 * contingency block repeats too. Two rules guard what is left:
 *
 *   · a row carrying a time or a duration is ALWAYS a cue, whatever it says;
 *   · a line is furniture only if the geometry said so.
 *
 * Nothing is deleted: what comes out of the rows goes into `info`, and the
 * sheet shows it under Show information.
 */
export function splitShowInfo(rows: ClassifiedRow[], furniture: string[]): SplitSheet {
  if (furniture.length === 0) return { rows, info: [] };
  const timed = (r: ClassifiedRow) =>
    r.startSec != null || r.durationSec != null || r.startRaw != null || r.durationRaw != null;
  // Furniture is matched against the whole line as it was printed, so compare
  // the row's own text the same way.
  const textOf = (r: ClassifiedRow) =>
    [r.title, ...Object.values(r.cells)].map((v) => (v ?? "").trim()).filter(Boolean).join(" ").trim();
  const wanted = new Set(furniture);

  const keep: ClassifiedRow[] = [];
  const found: string[] = [];
  for (const r of rows) {
    const text = textOf(r);
    if (!timed(r) && r.kind !== "spacer" && wanted.has(text)) {
      if (!found.includes(text)) found.push(text); // once, not once per page
      continue;
    }
    keep.push(r);
  }
  return { rows: keep, info: found.length ? [{ kind: "furniture", lines: found }] : [] };
}
