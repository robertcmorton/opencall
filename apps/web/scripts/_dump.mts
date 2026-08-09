import { readFile } from "node:fs/promises";
import { planImport, UNPARSED_START_KEY, UNPARSED_DURATION_KEY, buildSheet } from "@opencall/core";
import { extractGrid } from "../lib/importExtract";
const legacyPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs") as never;
const f = process.argv[2]!;
const bytes = new Uint8Array(await readFile(f));
const g = await extractGrid(new File([bytes as unknown as BlobPart], f.split("/").pop()!), legacyPdfjs);
const built = buildSheet(planImport(g.grid, { mergeWrapped: true, lineMeta: g.lineMeta, rowLines: g.rowLines, italicText: g.italicText }));
built.rows.forEach((r, i) => {
  const st = r.cells?.[UNPARSED_START_KEY], du = r.cells?.[UNPARSED_DURATION_KEY];
  if (!st && !du) return;
  const near = built.rows.slice(Math.max(0, i - 1), i + 2).map((x) => `${x.hardStartSec ?? "-"}/${x.durationSec ?? "-"} ${x.title.slice(0, 30)}`);
  console.log(`row ${i}  start-text=${JSON.stringify(st ?? "")} dur-text=${JSON.stringify(du ?? "")}\n    ${near.join("\n    ")}`);
});
