import type { BuiltSheet, ColumnTarget } from "./import";
import { parseDurationLoose } from "./import";

/**
 * Something structurally wrong with what a document became, stated in the
 * words a showcaller would use rather than in the importer's own terms.
 *
 * These are NOT parse warnings. A warning says "this cell did not read";
 * a fault says "the thing you are about to import is not a run sheet, or is
 * one that has lost a whole column". The distinction matters on the import
 * screen: warnings are noise on a 300-row sheet and are counted, faults are
 * few and are worth reading out.
 *
 * Thresholds here were measured against the sample corpus, not guessed; the
 * comments on each say what moving them costs. They are shared between the
 * import screen and the offline checker deliberately — a check that lives in
 * only one of the two silently stops matching the other.
 */
export interface SheetFault {
  kind: "no-title" | "no-time" | "no-duration" | "zero-length" | "repeated-line" | "bare-durations";
  message: string;
}

/**
 * Duration cells that are a bare number — "15", "90" — with nothing to say
 * whether that is seconds or minutes. The importer reads them as SECONDS,
 * which is right for "20" on a sting and wrong by sixty times for "15" on
 * a segment, and nothing on the preview used to say which it had assumed.
 * Counted here so the preview can flag them; the fix is in the sheet
 * ("15m", "15:00"), because guessing at a hinge is worse than asking.
 */
export function bareNumberDurations(raw: readonly string[]): { count: number; samples: string[] } {
  const bare = raw.map((v) => v.trim()).filter((v) => /^\d+$/.test(v));
  return { count: bare.length, samples: [...new Set(bare)].slice(0, 4) };
}

export function sheetFaults(
  built: BuiltSheet,
  mapping: ColumnTarget[],
  totalDurationSec: number,
  /** The duration column's raw cells, when one was mapped — see `bareNumberDurations`. */
  rawDurations: readonly string[] = [],
): SheetFault[] {
  const faults: SheetFault[] = [];
  const bare = bareNumberDurations(rawDurations);
  if (bare.count > 0)
    faults.push({
      kind: "bare-durations",
      message: `${bare.count} duration${bare.count === 1 ? "" : "s"} ${bare.count === 1 ? "is" : "are"} a bare number (${bare.samples
        .map((s) => `“${s}”`)
        .join(", ")}) and will be read as seconds. If they are minutes, write them as “15m” or “15:00” in the sheet first.`,
    });
  const has = (kind: string) => mapping.some((m) => m.kind === kind);
  const cells = built.rows.flatMap((r) => Object.values(r.cells ?? {}));

  // A structural column the sheet plainly has, that nothing was mapped to.
  // Two headings printed as one run ("DURATION ACTIVITY") name one column and
  // leave the other blank, and the sheet imports with no lengths at all.
  if (!has("title")) faults.push({ kind: "no-title", message: "No column became the item name." });
  if (!has("start") && built.rows.some((r) => r.hardStartSec != null))
    faults.push({ kind: "no-time", message: "No column became the time, but the sheet has clock times in it." });

  // Only a fault if the sheet HAS durations to lose — a schedule that gives a
  // time for each activity and never a length is a legitimate shape, not a
  // broken import. One sample event plan is exactly that: TIME and ACTIVITY,
  // both mapped correctly, and nothing else. Both tests below share the guard.
  const durationish = built.rows.filter((r) => r.durationSec != null).length;
  const looksTimed = cells.filter((v) => parseDurationLoose(v) != null).length;
  const losingLengths = durationish === 0 && looksTimed >= 10;
  if (!has("duration") && losingLengths)
    faults.push({
      kind: "no-duration",
      message: `No column became the duration, but ${looksTimed} cells read as one.`,
    });

  // A sheet of any size that spends no time at all did not read its lengths —
  // unless it never had any to read.
  if (built.rows.length >= 20 && totalDurationSec === 0 && losingLengths)
    faults.push({ kind: "zero-length", message: "The whole sheet is zero seconds long." });

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
  //     lighting and graphics cues legitimately recur;
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
    faults.push({
      kind: "repeated-line",
      message: `The same line sits inside ${worst[1]} different rows — “${worst[0].slice(0, 48)}”${
        repeated.length > 1 ? ` (and ${repeated.length - 1} more)` : ""
      }. That is usually a page header or footer that has been read as part of a cue.`,
    });
  }

  return faults;
}
