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
 * A complete match every fifteen minutes: a show between the games, then
 * kick-off, two short halves either side of a half time, then full time with
 * all four endings written out — win, loss, the golden-point block, and drawn
 * after it. 96 matches a day, so the result chooser, the extra-time band and
 * the golden-point insert are always a couple of minutes from being testable.
 *
 * The golden-point block is written the way the game is actually played and
 * the way core builds it: a hold, a half, a hold to change ends, a half.
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
  /**
   * A row inside an alternate ending: a length, and NO TIME.
   *
   * Which is how a real sheet writes them, because what time they happen at
   * depends on a result nobody has yet. Giving them printed times instead —
   * as this sheet first did — makes the running order add up four endings
   * that are alternatives, and every one after the first then contradicts its
   * own printed time. That is what 242 timing checks on a 120-match sheet
   * looked like: two per match, and none of them a real fault.
   */
  branch(durSec: number, title: string, who = "", notes = ""): void {
    this.n += 1;
    this.rows.push({ n: String(this.n), time: "", dur: mmss(durSec), scr: "", title, who, notes });
  }
  /**
   * An ending's heading: no time and no length, but IT KEEPS ITS NUMBER.
   *
   * A row with no number, no time and no duration is indistinguishable from a
   * wrapped continuation of the row above it, and the importer folds it in —
   * which silently ate 480 rows and three of every four endings on the first
   * attempt, leaving only the golden-point blocks. The number is what says
   * "this is a row of its own".
   */
  branchHead(title: string, who = ""): void {
    this.n += 1;
    this.rows.push({ n: String(this.n), time: "", dur: "", scr: "", title, who, notes: "" });
  }
}

const DAY = 24 * 60 * 60;

// ── 1. Concurrency ───────────────────────────────────────────────────────────
const conc = new Sheet();
const CYCLE = 120; // two minutes, so a full cycle is visible without waiting
for (let t = 0, seg = 1; t + CYCLE <= DAY; t += CYCLE, seg += 1) {
  /**
   * Overlap WITHOUT contradicting the clock, which the sheet can express.
   *
   * A row's length is used for two different questions and they have different
   * answers: `effDur` asks "how long is this", and `advanceBy` asks "what
   * happens next". A pre-record answers the first with its real length — the
   * crew shooting it need a countdown that is right — and the second with
   * zero, because it is shot beside the running order rather than in it.
   *
   * So it keeps a real window and overlaps everything sharing that window,
   * while the printed times of the main order still add up. Three ordinary
   * rows at one moment cannot do both: they overlap by contradicting the
   * clock, and the timing check is right to say so — 721 of them on the first
   * version of this sheet.
   *
   * The main order here is two rows totalling the whole cycle, so the clock is
   * exact; everything simultaneous is alongside it.
   */
  /**
   * THE ITEM ON AIR FIRST, the things running beside it underneath.
   *
   * This sheet had the three pre-records above the main item, which is not how
   * run sheets are written. Measured across the sixteen real sheets in the
   * sample: of the rows that run alongside something, 50 are printed AFTER the
   * item they run during and 9 before — and several sheets are unanimous about
   * it. The thing being called belongs at the top of its group; what is being
   * shot beside it hangs underneath.
   */
  conc.add(t, 30, `Segment ${seg} — opening item`, "SC", "", `Running order, segment ${seg}`);
  conc.add(t + 30, 90, `Segment ${seg} — main item`, "SC", "", `Runs while the three below are under way, segment ${seg}`);
  conc.add(t + 30, 45, `PRE-RECORD — camera check ${seg}`, "CAM", "CAM");
  conc.add(t + 30, 45, `PRE-RECORD — audio line check ${seg}`, "AUD", "AUDIO");
  conc.add(t + 30, 60, `PRE-RECORD — sponsor read ${seg}`, "MC", "VTR", `Shot in the tunnel during segment ${seg}`);
  conc.add(t + 90, null, "TWO MINUTE BELL", "SC", "", `Warning over segment ${seg}`);
}
// The day is the cycles; a banner after the last one only disagrees with it.

// ── 2. Golden point ──────────────────────────────────────────────────────────
const gp = new Sheet();
/**
 * Fifteen minutes a match, and the fifteen is arithmetic rather than taste.
 *
 * The match itself costs 600s (kick-off, two halves, a half time) and the show
 * between games costs 120s, so 180s is left between full time and the next
 * kick-off. The LONGEST way through the endings has to fit in exactly that, or
 * the sheet contradicts its own printed times: the clock after an endings block
 * resumes at the longest branch, and a row placed by arithmetic that assumes a
 * different figure disagrees with it.
 *
 *     a win, or a loss      90 + 90    = 180s   = exactly the room
 *     golden point   12 + 30 + 12 + 30 =  84s
 *     a draw after it             60   =  60s
 *
 * The running order resumes after the LONGEST BRANCH, and the longest is the
 * 180s one, so every printed time lands and this sheet reports no timing
 * faults at all. That is the point of it: a gap reported here is a bug in the
 * app, not a quirk of the sheet.
 *
 * What deliberately does NOT fit is golden point and then a result — 84 + 180
 * — because that is the shape a real sheet habitually under-budgets, and it is
 * the case worth having in a test bed. It shows up in the day's planned
 * length rather than as a gap.
 */
const MATCH = 15 * 60;
const TEAMS: [string, string][] = [
  ["HARBOUR KINGS", "RIVERS UNITED"],
  ["COAST RAIDERS", "RANGERS ATHLETIC"],
  ["NORTHBANK CITY", "STONEWELL ROVERS"],
];
/**
 * The show between the games — the part a run sheet spends most of its rows on.
 *
 * Varied per cycle on purpose. A sheet that repeats one line 96 times is read
 * as furniture (a header printed on every page) and folded away, so the
 * between-games show would have vanished from the very sheet meant to test it.
 */
const SHOWS = [
  "Junior curtain-raiser presentation",
  "Local band — two songs",
  "Cheer squad routine",
  "Fan competition on the big screen",
  "Community club cheque presentation",
  "Mascot race",
  "Legends lap of honour",
  "School choir",
];
const SPONSORS = ["Northbank", "Sponsor A", "Advertiser", "Harbour Freight", "Coast Mutual", "Riverline"];

for (let t = 0, m = 1; t + MATCH <= DAY; t += MATCH, m += 1) {
  const [home, away] = TEAMS[(m - 1) % TEAMS.length]!;
  const show = SHOWS[(m - 1) % SHOWS.length]!;
  const sponsor = SPONSORS[(m - 1) % SPONSORS.length]!;
  gp.banner(t, `MATCH ${m} — ${home} v ${away}`, "SC");

  // The show between the games. Includes one row marked to be read aloud, so
  // the prompter always has something on it, and one pre-record running
  // alongside the order rather than in it.
  gp.add(t, 30, "Walk-in music and crowd welcome", "MC", "", `Doors open for match ${m}`);
  gp.add(t + 30, 45, `SPONSOR READ — ${sponsor}`, "MC", "prompter", `Read live, match ${m}`);
  gp.add(t + 30, 45, `PRE-RECORD — ${show} package`, "CAM", "VTR", `Shot during the walk-in, match ${m}`);
  gp.add(t + 75, 45, show, "MC", "", `Between games, match ${m}`);

  gp.add(t + 120, 60, `KICK OFF — MATCH ${m}`, "SC", "", "Starts this match's endings");
  gp.add(t + 180, 240, "First half", "SC", "", "Four minutes standing in for forty");
  gp.add(t + 420, 60, `HALF TIME — ${sponsor} activation`, "MC", "GA");
  gp.add(t + 480, 240, "Second half", "SC");

  /**
   * All four endings — lengths but no times, because they are alternatives.
   *
   * THE GOLDEN-POINT BLOCK IS FOUR ROWS, not two, because that is what the
   * game is: a hold while the teams re-set and the cameras find them, five
   * minutes, a hold to change ends, five more. This sheet had it as a single
   * period behind one break, which is not a shape the product ever produces —
   * `goldenPointBlock` in core builds the real one, and a test sheet that
   * disagrees with the thing it is meant to test is worth very little.
   *
   * Scaled like the rest of the sheet, which runs a 40-minute half in 4:00:
   * the two-minute holds become 12s and the five-minute halves 30s.
   */
  gp.branchHead(`FULL TIME — ${home} WIN`, "SC");
  gp.branch(90, "Winning song and lap of the ground", "AUD");
  gp.branch(90, "Player of the match presentation", "MC");
  gp.branchHead(`FULL TIME — ${home} LOSS`, "SC");
  gp.branch(90, "Music bed only — no winning song", "AUD", "Do not play the anthem");
  gp.branch(90, "Away captain interview", "CAM");
  gp.branchHead("FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME", "SC");
  gp.branch(12, "HOLDING — golden point re-set", "SC", "Teams take a breather, cameras find them");
  gp.branch(30, "Golden point — first half", "SC", "First score ends it — be ready to cut at any moment");
  gp.branch(12, "HOLDING — change of ends", "SC", "Swap ends, hold the crowd");
  gp.branch(30, "Golden point — second half", "SC", "Still sudden death — a score ends it here too");
  gp.branchHead("GOLDEN POINT — NO SCORE, MATCH DRAWN", "SC");
  gp.branch(60, "Drawn match wrap and thank you", "MC");
}

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
  "Golden Point Test - a match every 15 minutes.pdf",
  "GOLDEN POINT TEST — A MATCH EVERY FIFTEEN MINUTES",
  "96 matches a day · all four endings, golden point in two halves, and a show between games · every team, sponsor and person invented",
);
