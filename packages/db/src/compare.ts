import type * as Y from "yjs";
import { projectRundownDoc, type ProjectedRow } from "./doc.ts";

/**
 * What separates two states of a sheet, row by row, in words a person can
 * check: which rows one has that the other does not, which rows differ and
 * in what, and which have changed place.
 *
 * Read it as "going from `from` to `to`". The Versions list compares the
 * sheet as it is NOW with an older version, so it can say what restoring
 * that version would undo before anybody presses Restore.
 */
export interface RowRef {
  id: string;
  /** Position in the sheet it was found in, counting from 1. */
  number: number;
  title: string;
}

export interface SheetComparison {
  /** Rows in `to` that `from` does not have. */
  added: RowRef[];
  /** Rows in `from` that `to` does not have. */
  removed: RowRef[];
  /** Rows in both whose content differs, with what differs. */
  changed: (RowRef & { fields: string[] })[];
  /** Rows in both that sit in a different order relative to the others. */
  moved: RowRef[];
  /** Differences in the sheet itself (name, planned start, columns). */
  sheet: string[];
  /** True when nothing differs at all. */
  same: boolean;
}

const TYPE_WORD: Record<string, string> = { cue: "Item", group: "Heading", milestone: "Fixed moment" };

function rowFields(a: ProjectedRow, b: ProjectedRow, columnTitle: (key: string) => string): string[] {
  const out: string[] = [];
  if (a.type !== b.type) out.push(`Type (${TYPE_WORD[a.type] ?? a.type} → ${TYPE_WORD[b.type] ?? b.type})`);
  if (a.title.trim() !== b.title.trim()) out.push("Title");
  if ((a.durationSec ?? null) !== (b.durationSec ?? null)) out.push("Duration");
  if ((a.hardStartSec ?? null) !== (b.hardStartSec ?? null)) out.push("Start time");
  if (Boolean(a.skipped) !== Boolean(b.skipped)) out.push(b.skipped ? "Struck" : "Un-struck");
  if (Boolean(a.durationMuted) !== Boolean(b.durationMuted)) out.push("Timing on/off");
  if (Boolean(a.backtime) !== Boolean(b.backtime)) out.push("Back-timing");
  if ((a.color ?? null) !== (b.color ?? null)) out.push("Colour");
  if ((a.outcome ?? null) !== (b.outcome ?? null)) out.push("Ending branch");
  const keys = new Set([...Object.keys(a.cells), ...Object.keys(b.cells)]);
  for (const key of keys) {
    if (key === "title") continue;
    if ((a.cells[key] ?? "").trim() !== (b.cells[key] ?? "").trim()) out.push(columnTitle(key));
  }
  return out;
}

/**
 * The rows that moved: of the rows both sheets share, the fewest whose
 * relative order has to change to turn one order into the other (everything
 * outside the longest run already in order).
 */
function movedIds(fromOrder: string[], toOrder: string[]): Set<string> {
  const both = new Set(fromOrder.filter((id) => toOrder.includes(id)));
  const a = fromOrder.filter((id) => both.has(id));
  const posInTo = new Map(toOrder.filter((id) => both.has(id)).map((id, i) => [id, i]));
  const seq = a.map((id) => posInTo.get(id)!);
  // Longest increasing subsequence, patience style, keeping the chain.
  const tails: number[] = [];
  const prev: number[] = new Array(seq.length).fill(-1);
  const tailIdx: number[] = [];
  seq.forEach((v, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1;
  });
  const keep = new Set<string>();
  for (let i = tails.length ? tailIdx[tails.length - 1]! : -1; i >= 0; i = prev[i]!) keep.add(a[i]!);
  return new Set(a.filter((id) => !keep.has(id)));
}

export function compareSheets(from: Y.Doc, to: Y.Doc): SheetComparison {
  const A = projectRundownDoc(from);
  const B = projectRundownDoc(to);
  const titles = new Map([...A.columns, ...B.columns].map((c) => [c.key, c.title]));
  const columnTitle = (key: string) => titles.get(key) ?? key;
  const ref = (r: ProjectedRow, i: number): RowRef => ({ id: r.id, number: i + 1, title: r.title.trim() || "(untitled)" });

  // Rows are the same row when they share an id. An update import rebuilds
  // every row with a new id, though, and a comparison across one would call
  // the whole sheet removed and re-added — true, and no help to anybody. So
  // rows left unpaired are then paired by type and title, in order.
  const idsInB = new Set(B.rows.map((r) => r.id));
  const pair = new Map<string, string>(); // A id → B id
  for (const r of A.rows) if (idsInB.has(r.id)) pair.set(r.id, r.id);
  const key = (r: ProjectedRow) => `${r.type}\u0000${r.title.trim().toLowerCase()}`;
  const paired = new Set(pair.values());
  const waiting = new Map<string, string[]>();
  for (const r of B.rows) if (!paired.has(r.id)) waiting.set(key(r), [...(waiting.get(key(r)) ?? []), r.id]);
  for (const r of A.rows) {
    if (pair.has(r.id)) continue;
    const match = waiting.get(key(r))?.shift();
    if (match) pair.set(r.id, match);
  }
  const pairedB = new Set(pair.values());

  const inA = new Map(A.rows.map((r, i) => [pair.get(r.id) ?? `\u0000${r.id}`, { r, i }]));
  const added = B.rows.flatMap((r, i) => (pairedB.has(r.id) ? [] : [ref(r, i)]));
  const removed = A.rows.flatMap((r, i) => (pair.has(r.id) ? [] : [ref(r, i)]));
  const changed = B.rows.flatMap((r, i) => {
    const old = inA.get(r.id);
    if (!old) return [];
    const fields = rowFields(old.r, r, columnTitle);
    return fields.length ? [{ ...ref(r, i), fields }] : [];
  });
  const moving = movedIds(
    A.rows.flatMap((r) => (pair.has(r.id) ? [pair.get(r.id)!] : [])),
    B.rows.map((r) => r.id),
  );
  const moved = B.rows.flatMap((r, i) => (moving.has(r.id) ? [ref(r, i)] : []));

  const sheet: string[] = [];
  if ((A.meta.name ?? "") !== (B.meta.name ?? "")) sheet.push("Name");
  if ((A.meta.plannedStartSec ?? null) !== (B.meta.plannedStartSec ?? null)) sheet.push("Planned start");
  const cols = (cs: typeof A.columns) => cs.map((c) => `${c.key}:${c.title}`).join("|");
  if (cols(A.columns) !== cols(B.columns)) sheet.push("Columns");

  return { added, removed, changed, moved, sheet, same: !added.length && !removed.length && !changed.length && !moved.length && !sheet.length };
}
