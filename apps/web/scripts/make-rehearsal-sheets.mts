/**
 * Two sheets for exercising things that are hard to sit and wait for.
 *
 * Usage (from apps/web):
 *   ../sync/node_modules/.bin/tsx scripts/make-rehearsal-sheets.mts [outDir]
 *
 * Both run the full 24 hours on a short repeating cycle, so whatever time of
 * day somebody opens one, the thing it is for is a minute or two away rather
 * than a wait until the evening. Everything in them is invented.
 *
 * ── 1. "Concurrency Test" ────────────────────────────────────────────────
 * Things happening AT ONCE, which the sheet has several separate ideas about
 * and which are otherwise rare enough to be awkward to catch:
 *   · rows sharing a moment with real lengths, so they genuinely overlap and
 *     group — the "runs at the same time as…" reading;
 *   · a PRE-RECORD, which the importer marks as running alongside the order
 *     and which takes none of its time — the tally light while it rolls;
 *   · a TWO MINUTE BELL, the other thing marked alongside, and for a different
 *     reason: it is a warning rung over whatever is on air.
 * A sheet with genuine overlap CANNOT have its printed times add up — three
 * things in one minute is the whole point — so this one imports with timing
 * gaps reported. That is the correct answer, not a fault in the sheet.
 *
 * ── 2. "Golden Point Test" ───────────────────────────────────────────────
 * A complete match every twelve minutes: kick-off, two short halves either
 * side of a half time, then full time with all four endings written out —
 * win, loss, the golden-point block, and drawn after it. Roughly 120 matches
 * a day, so the result chooser, the extra-time band and the golden-point
 * insert are always a couple of minutes from being testable.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

interface Row { n: string; time: string; dur: string; scr: string; title: string; who: string; notes: string }

const hhmmss = (sec: number): string => {
  const s = ((sec % 86400) + 86400) % 86400;
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const mmss = (sec: number): string => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;

class Sheet {
  readonly rows: Row[] = [];
  private n = 0;
  /** A numbered item at an explicit time. Blank `dur` leaves the length off. */
  add(timeSec: number, durSec: number | null, title: string, who = "", scr = "", notes = ""): void {
    this.n += 1;
    this.rows.push({
      n: String(this.n),
      time: hhmmss(timeSec),
      dur: durSec == null ? "" : mmss(durSec),
      scr, title, who, notes,
    });
  }
  /** A banner: no number of its own, the way sheets write section headings. */
  banner(timeSec: number, title: string, who = "", notes = ""): void {
    this.rows.push({ n: "", time: hhmmss(timeSec), dur: "", scr: "", title, who, notes });
  }
}

const DAY = 24 * 60 * 60;

// ── 1. Concurrency ───────────────────────────────────────────────────────────
const conc = new Sheet();
const CYCLE = 120; // two minutes, so a full cycle is visible without waiting
for (let t = 0, seg = 1; t + CYCLE <= DAY; t += CYCLE, seg += 1) {
  // Notes carry the segment number so no line is IDENTICAL across cycles.
  // Repeated verbatim, they trip the importer's own page-furniture check —
  // "the same line sits inside 720 different rows" — which is that check
  // working correctly on a sheet nobody would really print, and a permanent
  // false fault on a sheet whose whole job is to be run against.
  conc.add(t, 30, `Segment ${seg} — opening item`, "SC", "", `Running order, segment ${seg}`);
  // Three at one moment, each with a real length: they overlap, so they group.
  conc.add(t + 30, 45, `Segment ${seg} — camera check`, "CAM", "CAM");
  conc.add(t + 30, 45, `Segment ${seg} — audio line check`, "AUD", "AUDIO");
  conc.add(t + 30, 45, `Segment ${seg} — graphics build`, "GFX", "GFX");
  // Alongside the order, not in it: takes none of the running time.
  conc.add(t + 30, 60, `PRE-RECORD — sponsor read ${seg}`, "MC", "VTR", `Shot in the tunnel during segment ${seg}`);
  conc.add(t + 90, null, "TWO MINUTE BELL", "SC", "", `Warning over segment ${seg}`);
  conc.add(t + 95, 25, `Segment ${seg} — close`, "SC");
}
conc.banner(DAY - 1, "END OF CONCURRENCY TEST DAY", "SC", "Sheet closes at midnight");

// ── 2. Golden point ──────────────────────────────────────────────────────────
const gp = new Sheet();
const MATCH = 12 * 60;
const TEAMS: [string, string][] = [
  ["HARBOUR KINGS", "RIVERS UNITED"],
  ["COAST RAIDERS", "RANGERS ATHLETIC"],
  ["NORTHBANK CITY", "STONEWELL ROVERS"],
];
for (let t = 0, m = 1; t + MATCH <= DAY; t += MATCH, m += 1) {
  const [home, away] = TEAMS[(m - 1) % TEAMS.length]!;
  gp.banner(t, `MATCH ${m} — ${home} v ${away}`, "SC");
  gp.add(t, 60, `KICK OFF — MATCH ${m}`, "SC", "", "Starts this match's endings");
  gp.add(t + 60, 240, "First half", "SC", "", "Four minutes standing in for forty");
  gp.add(t + 300, 60, "HALF TIME — sponsor activation", "MC", "GA");
  gp.add(t + 360, 240, "Second half", "SC");
  // All four endings, written the way sheets write them.
  gp.banner(t + 600, `FULL TIME — ${home} WIN`, "SC");
  gp.add(t + 600, 45, "Winning song and lap of the ground", "AUD");
  gp.add(t + 645, 45, "Player of the match presentation", "MC");
  gp.banner(t + 600, `FULL TIME — ${home} LOSS`, "SC");
  gp.add(t + 600, 45, "Music bed only — no winning song", "AUD", "", "Do not play the anthem");
  gp.add(t + 645, 45, "Away captain interview", "CAM");
  gp.banner(t + 600, "FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME", "SC");
  gp.add(t + 600, 30, "Golden point break and re-set", "SC");
  gp.add(t + 630, 90, "Golden point period", "SC", "", "First score ends it — be ready to cut at any moment");
  gp.banner(t + 720 - 60, "GOLDEN POINT — NO SCORE, MATCH DRAWN", "SC");
  gp.add(t + 660, 60, "Drawn match wrap and thank you", "MC");
}
gp.banner(DAY - 1, "END OF GOLDEN POINT TEST DAY", "SC", "Sheet closes at midnight");

// ── Render ───────────────────────────────────────────────────────────────────
const HEAD = ["#", "TIME", "DUR", "SCR", "ITEM / ACTION", "WHO", "NOTES"];
const outDir = process.argv[2] ?? join(process.cwd(), "..", "..", "Example Cue Sheets");
mkdirSync(outDir, { recursive: true });

const render = (sheet: Sheet, file: string, title: string, sub: string): void => {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(title, 40, 34);
  doc.setFontSize(9);
  doc.text(sub, 40, 48);
  autoTable(doc, {
    head: [HEAD],
    body: sheet.rows.map((r) => [r.n, r.time, r.dur, r.scr, r.title, r.who, r.notes]),
    startY: 60,
    margin: { top: 40, left: 24, right: 24, bottom: 30 },
    // Ruled cells: the importer reads row boundaries off these lines, so a
    // themeless table would not exercise the path a real sheet takes.
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 3, lineWidth: 0.5, lineColor: [120, 120, 120], overflow: "linebreak" },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold", fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 30, halign: "right" },
      1: { cellWidth: 48 },
      2: { cellWidth: 36 },
      3: { cellWidth: 52 },
      4: { cellWidth: 300 },
      5: { cellWidth: 54 },
      6: { cellWidth: "auto" },
    },
  });
  const out = join(outDir, file);
  writeFileSync(out, Buffer.from(doc.output("arraybuffer")));
  console.log(`${String(sheet.rows.length).padStart(5)} rows · ${doc.getNumberOfPages()} pages · ${out}`);
};

render(
  conc,
  "Concurrency Test - many things at once.pdf",
  "CONCURRENCY TEST — MANY THINGS AT ONCE",
  "Two-minute cycles, all day · overlapping rows, a pre-record and a bell · every name invented",
);
render(
  gp,
  "Golden Point Test - a match every 12 minutes.pdf",
  "GOLDEN POINT TEST — A MATCH EVERY TWELVE MINUTES",
  "120 complete matches a day, each with all four endings · every team and person invented",
);
