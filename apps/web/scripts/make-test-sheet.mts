/**
 * Generates the 24-hour test run sheet as a PDF.
 *
 * Usage (from apps/web):
 *   ../sync/node_modules/.bin/tsx scripts/make-test-sheet.mts [outDir]
 *
 * With no outDir it writes into the repo's local "Example Cue Sheets" folder.
 *
 * Why a PDF and not a fixture: import is the path every real sheet takes, and
 * the parts of it that break — ruled-line row boundaries, wrapped cells,
 * blank times, ending blocks — only exist in a PDF. A hand-written fixture
 * proves the code works on input the code produced.
 *
 * What it exercises:
 *   · a full 24 hours, so a sheet that crosses midnight is a normal case
 *   · four games, each with its own set of alternate endings, so a result
 *     called on one game must not touch another's
 *   · win / lose / golden point (extra time) / drawn-after-extra-time, with
 *     the branch rows deliberately left untimed so they stack
 *   · prompter scripts, a role column of initials, and a cue-type column
 *   · times that add up exactly, so a clean sheet imports with no warnings
 *
 * Everything in it is invented — teams, venues, people.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ── The sheet ────────────────────────────────────────────────────────────────

interface Row {
  n: string;
  time: string;
  dur: string;
  scr: string;
  title: string;
  who: string;
  notes: string;
}

const hhmmss = (sec: number): string => {
  const s = ((sec % 86400) + 86400) % 86400;
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};
const mmss = (sec: number): string => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
const mins = (m: number): number => m * 60;

/** Builds the sheet with a running clock, so its own arithmetic is consistent. */
class Sheet {
  readonly rows: Row[] = [];
  private cursor = 0;
  private n = 0;

  private push(r: Omit<Row, "n">): void {
    this.n += 1;
    this.rows.push({ n: String(this.n), ...r });
  }

  at(sec: number): this {
    this.cursor = sec;
    return this;
  }

  /** A timed item that advances the clock. */
  cue(durSec: number, title: string, who = "", scr = "", notes = ""): this {
    this.push({ time: hhmmss(this.cursor), dur: mmss(durSec), scr, title, who, notes });
    this.cursor += durSec;
    return this;
  }

  /** A fixed moment — a time, no duration. Also closes an endings block. */
  milestone(title: string, who = "", notes = ""): this {
    this.push({ time: hhmmss(this.cursor), dur: "", scr: "", title, who, notes });
    return this;
  }

  /**
   * Fills the dead time up to a fixed moment with one holding item. A sheet
   * that simply jumps to the next game leaves a hole the timing check is right
   * to complain about — a real day has something in that time, even if it is
   * only the venue standing by.
   */
  holdUntil(sec: number, title: string, who = "", notes = ""): this {
    const span = sec - this.cursor;
    if (span > 0) this.cue(span, title, who, "", notes);
    else this.cursor = sec;
    return this;
  }

  /** A section heading: no time, no duration. */
  banner(title: string): this {
    this.push({ time: "", dur: "", scr: "", title, who: "", notes: "" });
    return this;
  }

  /**
   * A set of alternate endings. The branch rows carry a duration but NO time —
   * which is how a real sheet writes them, because what time they happen at
   * depends on a result nobody has yet. The clock resumes after the longest.
   */
  endings(blocks: { header: string; rows: [number, string, string?, string?][] }[]): this {
    let longest = 0;
    for (const block of blocks) {
      this.banner(block.header);
      let span = 0;
      for (const [dur, title, who, notes] of block.rows) {
        this.push({ time: "", dur: mmss(dur), scr: "", title, who: who ?? "", notes: notes ?? "" });
        span += dur;
      }
      longest = Math.max(longest, span);
    }
    this.cursor += longest;
    return this;
  }
}

const s = new Sheet();

// ── 00:00 — overnight ────────────────────────────────────────────────────────
s.at(0).milestone("MIDNIGHT — 24 HOUR TEST DAY BEGINS", "SC", "Day rolls over; sheet runs to 24:00");
s.cue(mins(25), "Overnight venue check and power up", "CREW");
s.cue(mins(20), "Pitch inspection and line marking", "CREW");
s.cue(mins(15), "Broadcast truck link test", "VT", "", "Confirm return feeds both directions");
s.cue(mins(10), "Comms check — all positions", "SC", "", "Every position acknowledges by name");
s.cue(mins(20), "LED wall power up and test pattern", "GFX");

// ── Game one: 02:00 ──────────────────────────────────────────────────────────
s.holdUntil(mins(90), "Venue hold — overnight crew stand by", "CREW").banner("GAME ONE — NORTHSIDE KESTRELS v RIVERBEND RHINOS");
s.milestone("GATES OPEN — WEST STAND", "FOH");
s.cue(mins(15), "Walk-in music bed", "AUD");
s.cue(mins(5), "Overnight crowd welcome", "MC", "PROMPTER", "Read as written");
s.cue(mins(5), "GOOD MORNING AND WELCOME TO HARBOUR PARK STADIUM FOR THE OPENING MATCH OF OUR TWENTY FOUR HOUR FESTIVAL. PLEASE MAKE YOUR WAY TO YOUR SEATS — WE ARE UNDERWAY IN FIVE MINUTES.", "MC", "PROMPTER");
s.cue(mins(3), "Team run-on", "CAM", "CAM 3", "Hold wide until both teams are out");
s.cue(mins(2), "Anthem", "AUD", "AUDIO");
s.milestone("KICK OFF — GAME ONE", "SC");
s.cue(mins(40), "First half", "SC", "", "Clock follows the match, not the sheet");
s.cue(mins(12), "HALF TIME — sponsor activation on field", "MC", "GA");
s.cue(mins(40), "Second half", "SC");
s.endings([
  {
    header: "FULL TIME — KESTRELS WIN",
    rows: [
      [mins(4), "Winning song and lap of the ground", "AUD", "Full volume, house lights up"],
      [mins(8), "Player of the match presentation", "MC"],
      [mins(6), "Winning coach interview", "CAM"],
    ],
  },
  {
    header: "FULL TIME — KESTRELS LOSS",
    rows: [
      [mins(4), "Music bed only — no winning song", "AUD", "Do not play the anthem"],
      [mins(6), "Away captain interview", "CAM"],
    ],
  },
  {
    header: "FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME",
    rows: [
      [mins(5), "Golden point break and re-set", "SC"],
      [mins(20), "Golden point period", "SC", "First score ends it — be ready to cut at any moment"],
    ],
  },
  {
    header: "GOLDEN POINT — NO SCORE, MATCH DRAWN",
    rows: [[mins(6), "Drawn match wrap and thank you", "MC"]],
  },
]);
s.milestone("VENUE RESET — GAME ONE COMPLETE", "CREW");

// ── Between games ────────────────────────────────────────────────────────────
s.cue(mins(30), "Field repair and re-mark", "CREW");
s.cue(mins(45), "Junior clinic on field", "GA");
s.cue(mins(30), "Camera positions reset for game two", "CAM");
s.cue(mins(30), "Crowd changeover — west stand cleared", "FOH");

// ── Game two: 08:00 ──────────────────────────────────────────────────────────
s.holdUntil(mins(8 * 60), "Venue hold — morning crew stand by", "CREW").banner("GAME TWO — COASTAL MARINERS v IRONBARK BULLS");
s.milestone("GATES OPEN — ALL STANDS", "FOH");
s.cue(mins(20), "Morning music bed", "AUD");
s.cue(mins(6), "WELCOME BACK TO HARBOUR PARK. OUR SECOND MATCH OF THE DAY IS ABOUT TO BEGIN — THE COASTAL MARINERS TAKE ON THE IRONBARK BULLS. PLEASE WELCOME BOTH SIDES TO THE FIELD.", "MC", "PROMPTER");
s.cue(mins(4), "Team run-on", "CAM");
s.cue(mins(2), "Anthem", "AUD");
s.cue(mins(8), "Community award presentation", "MC", "GA");
s.milestone("KICK OFF — GAME TWO", "SC");
s.cue(mins(40), "First half", "SC");
s.cue(mins(12), "HALF TIME — half-court shootout", "MC", "GA");
s.cue(mins(40), "Second half", "SC");
s.endings([
  {
    header: "FULL TIME — MARINERS WIN",
    rows: [
      [mins(4), "Winning song and lap of the ground", "AUD"],
      [mins(8), "Player of the match presentation", "MC"],
      [mins(5), "Sponsor cheque presentation", "GA"],
      [mins(6), "Winning coach interview", "CAM"],
    ],
  },
  {
    header: "FULL TIME — MARINERS LOSS",
    rows: [
      [mins(4), "Music bed only — no winning song", "AUD"],
      [mins(6), "Away captain interview", "CAM"],
      [mins(3), "Thank you and drive-safe read", "MC"],
    ],
  },
  {
    header: "FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME",
    rows: [
      [mins(5), "Golden point break and re-set", "SC"],
      [mins(20), "Golden point period", "SC"],
    ],
  },
  {
    header: "GOLDEN POINT — NO SCORE, MATCH DRAWN",
    rows: [[mins(6), "Drawn match wrap and thank you", "MC"]],
  },
]);
s.milestone("VENUE RESET — GAME TWO COMPLETE", "CREW");

// ── Midday ───────────────────────────────────────────────────────────────────
s.cue(mins(40), "Field repair and re-mark", "CREW");
s.cue(mins(60), "Midday supporter lunch — function room", "GA");
s.cue(mins(30), "Broadcast handover to afternoon crew", "VT", "", "Full comms re-check on handover");
s.cue(mins(30), "LED and lighting check for evening", "LX");
s.cue(mins(30), "Camera positions reset for game three", "CAM");

// ── Game three: 14:00 ────────────────────────────────────────────────────────
s.holdUntil(mins(14 * 60), "Venue hold — afternoon crew stand by", "CREW").banner("GAME THREE — SUMMIT WOLVES v DELTA SHARKS");
s.milestone("GATES OPEN — ALL STANDS", "FOH");
s.cue(mins(20), "Afternoon music bed", "AUD");
s.cue(mins(5), "GOOD AFTERNOON HARBOUR PARK. GAME THREE OF FOUR IS MOMENTS AWAY. PLEASE SHOW YOUR APPRECIATION FOR THE SUMMIT WOLVES AND THE DELTA SHARKS.", "MC", "PROMPTER");
s.cue(mins(4), "Team run-on", "CAM");
s.cue(mins(2), "Anthem", "AUD");
s.cue(mins(6), "Life member acknowledgement", "MC", "", "Names on the prompter — do not ad lib");
s.cue(mins(3), "Coin toss on field", "SC");
s.milestone("KICK OFF — GAME THREE", "SC");
s.cue(mins(40), "First half", "SC");
s.cue(mins(12), "HALF TIME — junior curtain raiser", "GA");
s.cue(mins(40), "Second half", "SC");
s.endings([
  {
    header: "FULL TIME — WOLVES WIN",
    rows: [
      [mins(4), "Winning song and lap of the ground", "AUD"],
      [mins(8), "Player of the match presentation", "MC"],
      [mins(6), "Winning coach interview", "CAM"],
      [mins(4), "Fireworks — west end", "PYRO", "Hold until the ground is clear"],
    ],
  },
  {
    header: "FULL TIME — WOLVES LOSS",
    rows: [
      [mins(4), "Music bed only — no winning song", "AUD"],
      [mins(6), "Away captain interview", "CAM"],
    ],
  },
  {
    header: "FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME",
    rows: [
      [mins(5), "Golden point break and re-set", "SC"],
      [mins(20), "Golden point period", "SC"],
    ],
  },
  {
    header: "GOLDEN POINT — NO SCORE, MATCH DRAWN",
    rows: [[mins(6), "Drawn match wrap and thank you", "MC"]],
  },
]);
s.milestone("VENUE RESET — GAME THREE COMPLETE", "CREW");

// ── Evening ──────────────────────────────────────────────────────────────────
s.cue(mins(40), "Field repair and re-mark", "CREW");
s.cue(mins(30), "Evening lighting to full", "LX");
s.cue(mins(45), "Pre-match entertainment build", "AUD", "", "Stage on halfway, struck before kick off");
s.cue(mins(30), "Camera positions reset for game four", "CAM");

// ── Game four: 20:00 ─────────────────────────────────────────────────────────
s.holdUntil(mins(20 * 60), "Venue hold — evening crew stand by", "CREW").banner("GAME FOUR — FRONTIER FALCONS v HIGHLAND STAGS");
s.milestone("GATES OPEN — ALL STANDS", "FOH");
s.cue(mins(20), "Evening walk-in and light show", "LX");
s.cue(mins(6), "GOOD EVENING AND WELCOME TO THE FINAL MATCH OF OUR TWENTY FOUR HOUR FESTIVAL. WOULD YOU PLEASE WELCOME THE FRONTIER FALCONS AND THE HIGHLAND STAGS.", "MC", "PROMPTER");
s.cue(mins(4), "Team run-on with pyrotechnics", "PYRO", "", "Cold spark only — crew clear of the tunnel");
s.cue(mins(2), "Anthem", "AUD");
s.cue(mins(8), "Festival thank-you montage", "VT");
s.milestone("KICK OFF — GAME FOUR", "SC");
s.cue(mins(40), "First half", "SC");
s.cue(mins(12), "HALF TIME — festival highlights package", "VT");
s.cue(mins(40), "Second half", "SC");
s.endings([
  {
    header: "FULL TIME — FALCONS WIN",
    rows: [
      [mins(4), "Winning song and lap of the ground", "AUD"],
      [mins(8), "Player of the match presentation", "MC"],
      [mins(6), "Winning coach interview", "CAM"],
      [mins(10), "Festival closing ceremony", "MC"],
      [mins(6), "Closing fireworks", "PYRO"],
    ],
  },
  {
    header: "FULL TIME — FALCONS LOSS",
    rows: [
      [mins(4), "Music bed only — no winning song", "AUD"],
      [mins(6), "Away captain interview", "CAM"],
      [mins(10), "Festival closing ceremony", "MC"],
      [mins(6), "Closing fireworks", "PYRO"],
    ],
  },
  {
    header: "FULL TIME — SCORES LEVEL, GOLDEN POINT EXTRA TIME",
    rows: [
      [mins(5), "Golden point break and re-set", "SC"],
      [mins(20), "Golden point period", "SC"],
      [mins(8), "Shortened closing ceremony", "MC", "Cut the montage if we run past 23:20"],
    ],
  },
  {
    header: "GOLDEN POINT — NO SCORE, MATCH DRAWN",
    rows: [
      [mins(6), "Drawn match wrap and thank you", "MC"],
      [mins(8), "Festival closing ceremony", "MC"],
    ],
  },
]);

// ── Pack down to midnight ────────────────────────────────────────────────────
// A fixed moment closes the last game's endings; without one the pack-down
// would read as part of whichever result was called.
s.milestone("VENUE RESET — FESTIVAL COMPLETE", "CREW");
s.cue(mins(20), "Crowd egress and stand sweep", "FOH");
s.cue(mins(20), "Broadcast de-rig", "VT");
s.cue(mins(15), "Comms down — all positions", "SC");
s.holdUntil(mins(23 * 60 + 59), "Venue dark — overnight security", "CREW");
s.milestone("END OF 24 HOUR TEST DAY", "SC", "Sheet closes at midnight");

// ── Render ───────────────────────────────────────────────────────────────────

// "ITEM" alone would be ambiguous against "ITEM / ACTION" — both read as
// the item column. Real sheets number with "#", so this does too.
const HEAD = ["#", "TIME", "DUR", "SCR", "ITEM / ACTION", "WHO", "NOTES"];

const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
doc.setFontSize(14);
doc.text("24 HOUR TEST RUN SHEET — HARBOUR PARK STADIUM", 40, 34);
doc.setFontSize(9);
doc.text("Four-game festival · 00:00 to 24:00 · every team, venue and person in this sheet is invented", 40, 48);

autoTable(doc, {
  head: [HEAD],
  body: s.rows.map((r) => [r.n, r.time, r.dur, r.scr, r.title, r.who, r.notes]),
  startY: 60,
  margin: { top: 40, left: 24, right: 24, bottom: 30 },
  // The grid theme rules every cell. The importer reads row boundaries off
  // those ruled lines, so a themeless table would not exercise the real path.
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

const outDir = process.argv[2] ?? join(process.cwd(), "..", "..", "Example Cue Sheets");
mkdirSync(outDir, { recursive: true });
const out = join(outDir, "24 Hour Test Run Sheet - Harbour Park Festival.pdf");
writeFileSync(out, Buffer.from(doc.output("arraybuffer")));

const endings = s.rows.filter((r) => /full\s?time|golden\s?point/i.test(r.title)).length;
console.log(`${s.rows.length} rows · ${endings} ending banners · ${doc.getNumberOfPages()} pages`);
console.log(out);
