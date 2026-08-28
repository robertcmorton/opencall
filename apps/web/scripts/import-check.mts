/**
 * Import check: would this sheet come in clean?
 *
 * Runs a sheet through the very same pipeline the import screen uses and
 * reports what the app would say about it — cells it could not read, timing
 * that does not add up, ending blocks it found, roles it detected. No server,
 * no database, no browser.
 *
 * This exists because "it imported" and "it imported correctly" are different
 * claims, and the second one takes twenty minutes of reading a screen against
 * a PDF. Point it at a folder and it reads them all.
 *
 * Usage (from apps/web):
 *   ../sync/node_modules/.bin/tsx scripts/import-check.mts <file-or-folder>… [--verbose]
 *
 * Exits non-zero when any sheet reports a problem, so it can gate a release.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, basename } from "node:path";
import {
  buildSheet,
  computeTiming,
  findTimingGaps,
  formatTimeOfDay,
  looksLikeBotchedValue,
  parseDurationLoose,
  planImport,
  UNPARSED_DURATION_KEY,
  UNPARSED_START_KEY,
  type PlanRow,
} from "@opencall/core";
import { extractGrid } from "../lib/importExtract";

// The browser build of pdf.js wants a DOM. The legacy build does not, and it
// is the same parser — so the check reads exactly what the import screen reads.
const legacyPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs") as never;

const READABLE = new Set([".pdf", ".xlsx", ".xls", ".csv"]);

const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) {
  console.error("usage: import-check.mts <file-or-folder>… [--verbose]");
  process.exit(2);
}

/** Every readable sheet under the given paths, folders expanded one level. */
async function collect(paths: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const p of paths) {
    const info = await stat(p);
    if (info.isDirectory()) {
      for (const name of (await readdir(p)).sort()) {
        if (READABLE.has(extname(name).toLowerCase())) out.push(join(p, name));
      }
    } else if (READABLE.has(extname(p).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

interface Report {
  file: string;
  rows: number;
  unreadable: { number: string; title: string; value: string }[];
  gaps: number;
  roles: string[];
  endings: Map<number, Map<string, number>>;
  startSec: number | null;
  endSec: number | null;
  totalSec: number;
  /**
   * Ways the sheet came in WRONG that no unreadable cell reports.
   *
   * This script called a 26-page run sheet clean while it was missing its
   * first ten items, had no durations at all and a production company's
   * footer sitting inside thirty-two cues. Every cell it could see parsed;
   * the damage was in what never became a cell. Counting only unreadable
   * cells and timing gaps measures how well the sheet was READ, not whether
   * what came out resembles the sheet — so these check the shape of the
   * result against the shape of the source.
   */
  faults: string[];
  error?: string;
}

async function check(file: string): Promise<Report> {
  const base = basename(file);
  const empty: Report = {
    file: base,
    rows: 0,
    unreadable: [],
    gaps: 0,
    roles: [],
    endings: new Map(),
    startSec: null,
    endSec: null,
    totalSec: 0,
    faults: [],
  };
  let built: ReturnType<typeof buildSheet>;
  let plan: ReturnType<typeof planImport>;
  try {
    const bytes = new Uint8Array(await readFile(file));
    const extracted = await extractGrid(new File([bytes as unknown as BlobPart], base), legacyPdfjs);
    // The same options the import screen passes. Without the ruled-line
    // metadata a wrapped cell arrives as three rows instead of one, and the
    // check would report faults the app does not have.
    plan = planImport(extracted.grid, {
      mergeWrapped: /\.pdf$/i.test(base),
      lineMeta: extracted.lineMeta,
      rowLines: extracted.rowLines,
      italicText: extracted.italicText,
    });
    built = buildSheet(plan);
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) };
  }

  // A cell the app could not read is kept verbatim under a reserved key so the
  // import screen can ask about it — but it only WARNS about text that was
  // trying to be a time. "FULLBACK" in a time column is a team list, not a
  // botched time, and counting it here would report faults the app never
  // shows anyone. Same test the import screen uses.
  const unreadable = built.rows.flatMap((r) => {
    const raw = r.cells?.[UNPARSED_START_KEY] ?? r.cells?.[UNPARSED_DURATION_KEY];
    return raw && looksLikeBotchedValue(raw) ? [{ number: r.sourceNumber ?? "", title: r.title.slice(0, 48), value: raw }] : [];
  });

  // `durationMuted` MUST come along. A muted duration is written down but not
  // spent — the thirty seconds of each ad inside a three-minute reel, listed
  // so the operator can see the order. Leaving the flag out charged the reel
  // and then every ad in it, and the check reported an overlap the size of the
  // reel at each one: twenty phantom faults on a single netball sheet, none of
  // them in the app, all of them in this script.
  const planRows: PlanRow[] = built.rows.map((r, i) => ({
    id: String(i),
    type: r.type,
    durationSec: r.durationSec ?? null,
    durationMuted: r.durationMuted ?? false,
    parallel: r.parallel ?? false,
    spans: r.spans ?? false,
    hardStartSec: r.hardStartSec ?? null,
    outcome: r.outcome ?? null,
    outcomeGame: r.outcomeGame,
  }));
  const timing = computeTiming(planRows, null);
  const gaps = findTimingGaps(
    built.rows.map((r, i) => ({
      index: i,
      hardStartSec: r.hardStartSec ?? null,
      durationSec: r.durationSec ?? null,
      title: r.title,
      skipped: false,
      durationMuted: r.durationMuted ?? false,
      parallel: r.parallel ?? false,
      spans: r.spans ?? false,
      outcome: r.outcome ?? null,
      outcomeGame: r.outcomeGame,
    })),
    timing,
  );

  const endings = new Map<number, Map<string, number>>();
  for (const r of built.rows) {
    if (!r.outcome) continue;
    const game = r.outcomeGame ?? 1;
    if (!endings.has(game)) endings.set(game, new Map());
    const m = endings.get(game)!;
    m.set(r.outcome, (m.get(r.outcome) ?? 0) + 1);
  }

  // ── Shape checks ────────────────────────────────────────────────────────
  const faults: string[] = [];
  const has = (kind: string) => plan.mapping.some((m) => m.kind === kind);
  const cells = built.rows.flatMap((r) => Object.values(r.cells ?? {}));

  // A structural column the sheet plainly has, that nothing was mapped to.
  // Two headings printed as one run ("DURATION ACTIVITY") name one column and
  // leave the other blank, and the sheet imports with no lengths at all.
  if (!has("title")) faults.push("no column became the title");
  if (!has("start") && built.rows.some((r) => r.hardStartSec != null)) faults.push("no column became the time");
  if (!has("duration")) {
    // Only a fault if the sheet HAS durations to lose — a cue sheet that
    // times its rows and never gives a length is a legitimate shape.
    const durationish = built.rows.filter((r) => r.durationSec != null).length;
    const looksTimed = cells.filter((v) => parseDurationLoose(v) != null).length;
    if (durationish === 0 && looksTimed >= 10) faults.push(`no column became the duration, but ${looksTimed} cells parse as one`);
  }

  // A sheet of any size that spends no time at all did not read its lengths.
  if (built.rows.length >= 20 && timing.totalDurationSec === 0) faults.push("the whole sheet is zero seconds long");

  // Page furniture INSIDE a row. An undetected running head or footer is not
  // left on its own — it is absorbed into whatever cue precedes the page
  // break, so it arrives as part of a cue's text rather than as its own row.
  //
  // Deliberately NOT asked of `runningHeaders`: that is the detector whose
  // blind spot puts the furniture there in the first place, and a check that
  // consults it can only find what it already found. A footer gives itself
  // away without any of that — one line of text, repeated word for word,
  // inside row after unrelated row. Cue text does not do that; even a
  // contingency block repeats a handful of times, not once per page.
  const rowsPerLine = new Map<string, number>();
  for (const r of built.rows) {
    const lines = new Set(
      [r.title, ...Object.values(r.cells ?? {})]
        .flatMap((v) => (v ?? "").split("\n"))
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter((l) => l.length >= 20),
    );
    for (const l of lines) rowsPerLine.set(l, (rowsPerLine.get(l) ?? 0) + 1);
  }
  // Thresholds measured against the sample sheets, not guessed. A footer is
  // printed ONCE PER PAGE, which makes it frequent but always a minority:
  // the absorbed one sat in 26 rows of 143 (18%). Both edges are needed —
  //   · at 5 rows this flagged 17 of 27 sheets, every one a correct import:
  //     lighting and graphics cues legitimately recur ("North & South Flames"
  //     14 times in 89 rows, "Bulldogs Fast LIVE TAKE OVER" 5 times in 126);
  //   · without an upper edge it flags a sheet whose rows are MEANT to be
  //     alike — the generated 30-second timing fixture repeats one line 2,040
  //     times out of 2,041. A line in nearly every row is the sheet's shape,
  //     not something printed on top of it.
  const rowCount = built.rows.length;
  const repeated = [...rowsPerLine.entries()]
    .filter(([, n]) => n >= 20 && n >= rowCount * 0.1 && n <= rowCount * 0.6)
    .sort((a, b) => b[1] - a[1]);
  if (repeated.length > 0) {
    const worst = repeated[0]!;
    faults.push(
      `the same line sits inside ${worst[1]} different rows — "${worst[0].slice(0, 48)}"${repeated.length > 1 ? ` (and ${repeated.length - 1} more)` : ""}`,
    );
  }

  return {
    file: base,
    rows: built.rows.length,
    unreadable,
    gaps: gaps.length,
    faults,
    roles: built.roles.map((r) => r.name),
    endings,
    startSec: timing.startSec,
    endSec: timing.endSec,
    totalSec: timing.totalDurationSec,
  };
}

const files = await collect(targets);
if (files.length === 0) {
  console.error("no readable sheets found");
  process.exit(2);
}

const clock = (sec: number | null): string => (sec != null ? formatTimeOfDay(sec, true) : "—");
let problems = 0;

for (const file of files) {
  const r = await check(file);
  if (r.error) {
    problems += 1;
    console.log(`✗ ${r.file}\n    could not be read: ${r.error}`);
    continue;
  }
  const clean = r.unreadable.length === 0 && r.gaps === 0 && r.faults.length === 0;
  if (!clean) problems += 1;
  console.log(`${clean ? "✓" : "✗"} ${r.file}`);
  console.log(
    `    ${r.rows} rows · ${clock(r.startSec)} → ${clock(r.endSec)} · ${Math.round(r.totalSec / 60)} min · ${r.roles.length} roles`,
  );
  if (r.endings.size > 0) {
    const games = [...r.endings]
      .sort((a, b) => a[0] - b[0])
      .map(([g, m]) => `game ${g}: ${[...m].map(([o, n]) => `${o}×${n}`).join(" ")}`);
    console.log(`    endings — ${games.join(" · ")}`);
  }
  if (r.unreadable.length > 0) {
    console.log(`    ${r.unreadable.length} cell(s) the app could not read:`);
    for (const u of r.unreadable.slice(0, verbose ? 100 : 5)) console.log(`      #${u.number} ${u.title} → "${u.value}"`);
    if (!verbose && r.unreadable.length > 5) console.log(`      …and ${r.unreadable.length - 5} more (--verbose)`);
  }
  if (r.gaps > 0) console.log(`    ${r.gaps} place(s) where the times do not add up`);
  for (const f of r.faults) console.log(`    ⚠ ${f}`);
}

console.log(`\n${files.length - problems}/${files.length} sheets import clean`);
process.exit(problems > 0 ? 1 : 0);
