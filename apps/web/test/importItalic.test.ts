import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { jsPDF } from "jspdf";
import { extractGrid } from "../lib/importExtract";

// Real sheets EMBED their fonts ("Arial-ItalicMT"), and that is the case that
// broke: a built-in font such as Helvetica-Oblique was still read as italic
// without the fix, so a test using one proved nothing. These two fonts ship
// inside the PDF library itself, so the test needs nothing from this machine.
const fontDir = createRequire(import.meta.url).resolve("pdfjs-dist/package.json").replace(/package\.json$/, "standard_fonts/");
const font = (file: string) => readFileSync(fontDir + file).toString("binary");

/**
 * Italic lines in a PDF are found (22 Oct 2026).
 *
 * Run sheets set the words a presenter reads aloud in italic, and the importer
 * turns those into script for the prompter. It finds italic from the font's
 * NAME, and from PDF.js 6.4 the name only comes across when asked for: after
 * the upgrade every font read as upright and three sample sheets lost their
 * prompter script without a word. This builds a small sheet with one italic
 * line and checks it is still found.
 */
describe("italic lines in a PDF run sheet", () => {
  it("finds the line set in italic, and only that one", async () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    // Named the way a real PDF names them ("Arial-ItalicMT"): jsPDF writes
    // the name it is given, and the style is only in the name.
    doc.addFileToVFS("LiberationSans-Regular.ttf", font("LiberationSans-Regular.ttf"));
    doc.addFont("LiberationSans-Regular.ttf", "LiberationSans", "normal");
    doc.addFileToVFS("LiberationSans-Italic.ttf", font("LiberationSans-Italic.ttf"));
    doc.addFont("LiberationSans-Italic.ttf", "LiberationSans-Italic", "normal");
    doc.setFontSize(10);
    const row = (y: number, cells: string[], italic = false) => {
      doc.setFont("LiberationSans", "normal");
      doc.text(cells[0]!, 40, y);
      doc.text(cells[1]!, 140, y);
      doc.setFont(italic ? "LiberationSans-Italic" : "LiberationSans", "normal");
      doc.text(cells[2]!, 240, y);
    };
    row(60, ["TIME", "DURATION", "ITEM"]);
    row(90, ["7:30 PM", "5:00", "Gates open"]);
    row(120, ["7:35 PM", "1:00", "Good evening and welcome to the final round"], true);
    row(150, ["7:36 PM", "2:00", "Anthem"]);
    const bytes = doc.output("arraybuffer");

    const sheet = await extractGrid(new File([bytes], "Run sheet.pdf"), () => import("pdfjs-dist/legacy/build/pdf.mjs") as never);
    expect(sheet.italicText).toEqual(["Good evening and welcome to the final round"]);
  });
});
