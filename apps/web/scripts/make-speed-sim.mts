/**
 * Builds a 24-hour soak test out of a REAL run sheet, run at speed.
 *
 * Usage (from apps/web):
 *   ../sync/node_modules/.bin/tsx scripts/make-speed-sim.mts <source sheet> \
 *     [--divisor 10] [--hours 24] [--out <dir>]
 *
 * Why derive it from a real sheet rather than write one: a sheet somebody
 * invented exercises the cases they thought of. A match-day sheet brings its
 * own — a pre-record shot during the game, a two-minute bell, a block that
 * spans the cues filling it, four endings only one of which will be played,
 * a title with a time typed into it. Those are the shapes that break things,
 * and none of them would be written on purpose.
 *
 * At a tenth speed a whole match day takes about fifty minutes, so a day of
 * testing is roughly thirty consecutive games. Each cycle carries its own
 * kick-off, which is what separates one game's endings from the next's — so
 * the sheet also exercises calling a result on game 17 and leaving 16 and 18
 * alone.
 *
 * The source is read through the very same pipeline the import screen uses,
 * so what is compressed is what the app would actually have imported.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readFile } from "node:fs/promises";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { buildSheet, computeTiming, planImport, type BuiltRow, type PlanRow } from "@opencall/core";
import { extractGrid } from "../lib/importExtract";

const legacyPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs") as never;

const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1]! : fallback;
};
const source = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
if (!source) {
  console.error("usage: make-speed-sim.mts <source sheet> [--divisor 10] [--hours 24] [--out <dir>]");
  process.exit(2);
}
const divisor = Math.max(1, Number(flag("divisor", "10")));
const hours = Math.max(1, Number(flag("hours", "24")));

const hhmmss = (sec: number): string => {
  const s = ((Math.round(sec) % 86400) + 86400) % 86400;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const dur = (sec: number): string => {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// ── Read the source exactly as the import screen would ───────────────────────
const bytes = new Uint8Array(await readFile(source));
const base = basename(source);
const ex = await extractGrid(new File([bytes as unknown as BlobPart], base), legacyPdfjs);
const built = buildSheet(
  planImport(ex.grid, {
    mergeWrapped: /\.pdf$/i.test(base),
    lineMeta: ex.lineMeta,
    rowLines: ex.rowLines,
    italicText: ex.italicText,
  }),
);

/**
 * Every row's offset from the start of the day, and its length.
 *
 * Taken from `computeTiming` rather than walked by hand. Walking it looked
 * simple and got two things wrong that the engine already knows: a set of
 * alternate endings is not a queue — only one of them will be played, so the
 * day advances by the longest branch and not by their sum — and a row that
 * runs alongside the order contributes nothing to it. Laid end to end, the
 * endings alone put every cycle minutes out of step with the next.
 */
interface Beat {
  row: BuiltRow;
  offsetSec: number;
  lengthSec: number;
  /** The source pinned this row to a time of its own. */
  anchored: boolean;
  /** Its length once compressed — settled below so segments add up exactly. */
  smallSec: number;
}
const planRows: PlanRow[] = built.rows.map((r, i) => ({
  id: String(i),
  type: r.type,
  durationSec: r.durationSec ?? null,
  durationMuted: r.durationMuted ?? false,
  parallel: r.parallel ?? false,
  hardStartSec: r.hardStartSec ?? null,
  outcome: r.outcome ?? null,
  outcomeGame: r.outcomeGame,
}));
const sourceTiming = computeTiming(planRows, null);
const first = sourceTiming.startSec;
const beats: Beat[] = [];
if (first != null) {
  /**
   * Where the last row sat, so a row whose own time is WRONG still lands
   * where it belongs in the order.
   *
   * A sheet can carry a time that contradicts it — this one has "5:26:00 am"
   * typed for a bell in an afternoon sheet — and subtracting the sheet's start
   * from that gives a NEGATIVE offset. Formatted as a clock it wraps round
   * midnight, so the bell reappeared in the small hours and pulled its
   * neighbours' apparent order with it: six disagreements in the copy where
   * the source has four, none of them in the same place.
   *
   * The simulation is meant to reproduce the source's faults, not invent new
   * ones out of them. A row that cannot say when it happens is placed where
   * it sits in the running order instead.
   */
  let lastOffset = 0;
  built.rows.forEach((row, i) => {
    const t = sourceTiming.rows[i]!;
    if (t.startSec == null) return;
    const raw = t.startSec - first;
    const offsetSec = raw >= 0 ? raw : lastOffset;
    lastOffset = offsetSec;
    beats.push({
      row,
      offsetSec,
      lengthSec: t.effectiveDurationSec,
      // A row placed by its neighbour has no time of its own to print.
      anchored: row.hardStartSec != null && raw >= 0,
      smallSec: 0,
    });
  });
}

/**
 * Settle the compressed lengths so each stretch between two pinned times adds
 * up to exactly the compressed distance between them.
 *
 * Rounding each row on its own looked right and was not: a hundred rows each
 * half a second out is a minute of drift. The rounding is spent where it can
 * be seen and corrected — the last row of each stretch absorbs the remainder,
 * exactly as a showcaller would.
 */
const smallOffset = (sec: number) => Math.round(sec / divisor);
{
  let segStart = 0;
  for (let i = 0; i <= beats.length; i++) {
    const boundary = i === beats.length || beats[i]!.anchored;
    if (!boundary || i === segStart) continue;
    const seg = beats.slice(segStart, i);
    const spend = seg.filter((b) => !b.row.parallel && b.lengthSec > 0);
    for (const b of seg) b.smallSec = b.lengthSec > 0 ? Math.max(1, Math.round(b.lengthSec / divisor)) : 0;
    const target =
      i < beats.length ? smallOffset(beats[i]!.offsetSec) - smallOffset(beats[segStart]!.offsetSec) : null;
    if (target != null && spend.length > 0) {
      const have = spend.reduce((a, b) => a + b.smallSec, 0);
      const last = spend[spend.length - 1]!;
      // Never below a second: a row that takes no time is a row deleted.
      last.smallSec = Math.max(1, last.smallSec + (target - have));
    }
    segStart = i;
  }
}
if (first == null || beats.length === 0) {
  console.error("the source sheet has no timed rows to compress");
  process.exit(1);
}
const spanSec = Math.max(1, (sourceTiming.endSec ?? 0) - (first ?? 0));
const cycleSec = Math.max(60, Math.round(spanSec / divisor));
const cycles = Math.max(1, Math.floor((hours * 3600) / cycleSec));

// ── Stack the cycles ─────────────────────────────────────────────────────────
interface OutRow {
  n: string;
  time: string;
  dur: string;
  title: string;
  who: string;
  what: string;
}
const out: OutRow[] = [];
let n = 0;
for (let c = 0; c < cycles; c++) {
  const at = c * cycleSec;
  // Each cycle announces itself, and the word KICK OFF is what tells the
  // importer this is a NEW game — so game 17's result cannot touch game 16's.
  out.push({
    n: "",
    time: hhmmss(at),
    dur: "",
    title: `GAME ${c + 1} OF ${cycles} — PRE-GAME / KICK OFF`,
    who: "SC",
    what: `Simulation cycle ${c + 1} · source day compressed to 1/${divisor}`,
  });
  for (const b of beats) {
    n += 1;
    out.push({
      n: String(n),
      // Only the rows the SOURCE pinned get a printed time. Writing one on
      // every row turns a cascading sheet into a wall of hard anchors, and
      // then every place the source's own chain disagreed with its anchors —
      // which is what the timing check is for — becomes a fresh disagreement
      // of its own. The uncompressed round trip reported six where the source
      // has three, and that was the whole difference.
      time: b.anchored ? hhmmss(at + smallOffset(b.offsetSec)) : "",
      dur: b.smallSec > 0 ? dur(b.smallSec) : "",
      // No title in the source means no title here. Writing "—" put a dash
      // on hundreds of rows that simply keep their content in another column,
      // and a sheet full of dashes reads as a sheet full of holes.
      title: String(b.row.title ?? "").replace(/\s*\n\s*/g, " · ").trim(),
      who: (b.row.cells?.["who"] ?? b.row.cells?.["roles"] ?? "").split("\n")[0]!.trim(),
      what: Object.entries(b.row.cells ?? {})
        .filter(([k]) => k !== "who" && k !== "roles" && !k.startsWith("start-") && !k.startsWith("duration-"))
        .map(([, v]) => v)
        .join(" · ")
        .replace(/\s*\n\s*/g, " · ")
        .slice(0, 120),
    });
  }
}

// ── Render ───────────────────────────────────────────────────────────────────
const HEAD = ["#", "TIME", "DUR", "ITEM / ACTION", "WHO", "NOTES"];
const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
doc.setFontSize(14);
doc.text(`NRL SIMULATION — ${hours} HOURS AT 1/${divisor} SPEED`, 40, 34);
doc.setFontSize(9);
doc.text(
  `${cycles} consecutive games · one cycle = ${dur(cycleSec)} · generated from a match-day sheet for soak testing`,
  40,
  48,
);

autoTable(doc, {
  head: [HEAD],
  body: out.map((r) => [r.n, r.time, r.dur, r.title, r.who, r.what]),
  startY: 60,
  margin: { top: 40, left: 24, right: 24, bottom: 30 },
  // The importer reads row boundaries off ruled lines, so the grid theme is
  // not decoration — a themeless table would not exercise the real path.
  theme: "grid",
  styles: { fontSize: 7, cellPadding: 2.5, lineWidth: 0.5, lineColor: [120, 120, 120], overflow: "linebreak" },
  headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: "bold", fontSize: 7 },
  columnStyles: {
    0: { cellWidth: 28, halign: "right" },
    1: { cellWidth: 50 },
    2: { cellWidth: 34 },
    3: { cellWidth: 300 },
    4: { cellWidth: 52 },
    5: { cellWidth: "auto" },
  },
});

const outDir = flag("out", join(process.cwd(), "..", "..", "Example Cue Sheets"));
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `NRL Simulation ${hours}h at one-${divisor} speed.pdf`);
writeFileSync(file, Buffer.from(doc.output("arraybuffer")));

console.log(`source      ${base}`);
console.log(`source day  ${dur(spanSec)}  (${built.rows.length} rows)`);
console.log(`one cycle   ${dur(cycleSec)}  at 1/${divisor}`);
console.log(`stacked     ${cycles} games · ${out.length} rows · ${doc.getNumberOfPages()} pages`);
console.log(file);
