/**
 * Load every sheet in a folder into a running server, one at a time.
 *
 * `import-check.mts` proves a sheet PARSES; this proves it lands — that the
 * API accepts what the import screen would send, the document builds, and
 * there is a rundown at the other end to open. Between them they cover the
 * two halves of "it imported": the reading and the writing.
 *
 * The conversion is `buildSheet`, the same call the import screen makes, so
 * what gets created here is what a person clicking Import would get.
 *
 * Usage (from apps/web):
 *   ../sync/node_modules/.bin/tsx scripts/import-load.mts <folder> \
 *     [--token <token>] [--api http://localhost:8787] [--prefix load]
 *
 * The token is only needed against a locked server; a dev server answers
 * without one.
 *
 * Prints one line per sheet and a tab-separated id list at the end, so the
 * pages can be swept afterwards.
 */
import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { buildSheet, planImport } from "@opencall/core";
import { extractGrid } from "../lib/importExtract";

const legacyPdfjs = () => import("pdfjs-dist/legacy/build/pdf.mjs") as never;
const READABLE = new Set([".pdf", ".xlsx", ".xls", ".csv"]);

const args = process.argv.slice(2);
const flag = (name: string, fallback?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1]?.startsWith("--") !== true);
const api = flag("api", "http://localhost:8787")!;
const token = flag("token");
const prefix = flag("prefix", "load")!;
if (!dir) {
  console.error("usage: import-load.mts <folder> [--token <token>] [--api url] [--prefix name]");
  process.exit(2);
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const res = await fetch(`${api}${path}`, {
    method: "POST",
    // A dev server with no user database answers without one; a locked
    // server needs the token the operator passes in.
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
};

const today = new Date().toISOString().slice(0, 10);
const event = await post<{ id: string }>("/events", {
  name: `${prefix} — import sweep ${new Date().toISOString().slice(11, 16)}`,
  startDate: today,
  endDate: today,
});
console.log(`event ${event.id}`);

const created: { id: string; file: string }[] = [];
let failed = 0;

for (const name of (await readdir(dir)).sort()) {
  if (!READABLE.has(extname(name).toLowerCase())) continue;
  const base = basename(name);
  try {
    const bytes = new Uint8Array(await readFile(join(dir, name)));
    const ex = await extractGrid(new File([bytes as unknown as BlobPart], base), legacyPdfjs);
    const plan = planImport(ex.grid, {
      mergeWrapped: /\.pdf$/i.test(base),
      lineMeta: ex.lineMeta,
      rowLines: ex.rowLines,
      italicText: ex.italicText,
    });
    const built = buildSheet(plan);
    const made = await post<{ id: string }>("/rundowns", {
      eventId: event.id,
      name: base.replace(/\.[^.]+$/, "").slice(0, 90),
      rows: built.rows,
      columns: built.columns,
      roles: built.roles,
      roleColumnKey: built.roleColumnKey,
      roleColumnKeys: built.roleColumnKeys,
      plannedStartSec: built.plannedStartSec,
      baseTitles: built.baseTitles,
      columnOrder: built.columnOrder,
      showInfo: built.showInfo,
    });
    created.push({ id: made.id, file: base });
    console.log(`✓ ${made.id}  ${built.rows.length.toString().padStart(4)} rows  ${base}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${base}\n    ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n${created.length} created, ${failed} failed`);
console.log(`IDS\t${created.map((c) => c.id).join("\t")}`);
process.exit(failed > 0 ? 1 : 0);
