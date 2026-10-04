import * as Y from "yjs";
import { formatDuration, formatTimeOfDay } from "@opencall/core";
import { projectRundownDoc, type ProjectedRow } from "./doc.ts";

/**
 * What separates two states of a sheet, row by row, in words a person can
 * check: which rows one has that the other does not, which rows differ and
 * in what, and which have changed place.
 *
 * Read it as "going from `from` to `to`". The Versions list compares the
 * sheet as it is NOW with an older version, so it can say what restoring
 * that version would undo before anybody presses Restore. The change log
 * compares the sheet before a change with the sheet after it, keeping the
 * values on both sides so the change can be shown — and taken back alone.
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

/** One field of one row, before and after, as a person reads it. */
export interface FieldChange {
  /** What the field is called on screen: "Duration", "Notes", "Struck". */
  field: string;
  /** Which stored value it is: "durationSec", "skipped", "cell:notes"… */
  key: string;
  before: string;
  after: string;
  /** Fingerprint of the value just after the change, so an undo can tell whether anyone has touched it since. */
  afterHash: string;
}

export interface RowSnapshot extends RowRef {
  type: string;
  /** The row's text, by column title, as it was. */
  cells: Record<string, string>;
  duration: string | null;
  start: string | null;
  /** Fingerprint of the whole row, so an undo can tell whether anyone has touched it since. */
  hash: string;
}

/** A change, recorded: everything needed to show it and to take it back. */
export interface ChangeDetail {
  counts: { added: number; removed: number; changed: number; moved: number };
  /** Rows the change created, as they were left. */
  added: RowSnapshot[];
  /** Rows the change deleted, as they were. */
  removed: RowSnapshot[];
  changed: (RowRef & { changes: FieldChange[] })[];
  moved: (RowRef & { from: number })[];
  sheet: { field: string; before: string; after: string }[];
  /** More rows than are kept here changed; the counts are still whole. */
  truncated: boolean;
}

const TYPE_WORD: Record<string, string> = { cue: "Item", group: "Heading", milestone: "Fixed moment" };

/** FNV-1a: small, stable, and enough to notice that a value moved on. */
function fingerprint(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** The value behind a field key, as a canonical string. */
function rawValue(r: ProjectedRow, key: string): string {
  if (key.startsWith("cell:")) return (r.cells[key.slice(5)] ?? "").trim();
  const v = (r as unknown as Record<string, unknown>)[key];
  if (key === "skipped" || key === "durationMuted" || key === "backtime") return String(Boolean(v));
  return v == null ? "" : String(v);
}

const rowHash = (r: ProjectedRow) =>
  fingerprint(
    JSON.stringify([r.type, r.durationSec ?? null, r.hardStartSec ?? null, Boolean(r.skipped), Object.entries(r.cells).map(([k, v]) => [k, v.trim()]).sort()]),
  );

interface Ctx {
  columnTitle: (key: string) => string;
  use24h: boolean;
}

function fieldChanges(a: ProjectedRow, b: ProjectedRow, ctx: Ctx): FieldChange[] {
  const out: FieldChange[] = [];
  const time = (v: number | null | undefined) => (v == null ? "—" : formatTimeOfDay(v, ctx.use24h));
  const dur = (v: number | null | undefined) => (v == null ? "—" : formatDuration(v));
  const yes = (v: unknown) => (v ? "yes" : "no");
  const push = (key: string, field: string, before: string, after: string) => out.push({ key, field, before, after, afterHash: fingerprint(rawValue(b, key)) });
  if (a.type !== b.type) push("type", "Type", TYPE_WORD[a.type] ?? a.type, TYPE_WORD[b.type] ?? b.type);
  if ((a.durationSec ?? null) !== (b.durationSec ?? null)) push("durationSec", "Duration", dur(a.durationSec), dur(b.durationSec));
  if ((a.hardStartSec ?? null) !== (b.hardStartSec ?? null)) push("hardStartSec", "Start time", time(a.hardStartSec), time(b.hardStartSec));
  if (Boolean(a.skipped) !== Boolean(b.skipped)) push("skipped", "Struck", yes(a.skipped), yes(b.skipped));
  if (Boolean(a.durationMuted) !== Boolean(b.durationMuted)) push("durationMuted", "Left out of timing", yes(a.durationMuted), yes(b.durationMuted));
  if (Boolean(a.backtime) !== Boolean(b.backtime)) push("backtime", "Back-timing", yes(a.backtime), yes(b.backtime));
  if ((a.color ?? null) !== (b.color ?? null)) push("color", "Colour", a.color ?? "none", b.color ?? "none");
  if ((a.outcome ?? null) !== (b.outcome ?? null)) push("outcome", "Ending branch", a.outcome ?? "none", b.outcome ?? "none");
  const keys = [...new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])];
  // The title first, then the other columns in the order the sheet shows them.
  keys.sort((x, y) => (x === "title" ? -1 : y === "title" ? 1 : 0));
  for (const key of keys) {
    const before = (a.cells[key] ?? "").trim();
    const after = (b.cells[key] ?? "").trim();
    if (before !== after) push(`cell:${key}`, ctx.columnTitle(key), before, after);
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

/** The full comparison, with values; both public shapes are cut from it. */
function diff(from: Y.Doc, to: Y.Doc) {
  const A = projectRundownDoc(from);
  const B = projectRundownDoc(to);
  const titles = new Map([...A.columns, ...B.columns].map((c) => [c.key, c.title]));
  const ctx: Ctx = { columnTitle: (key) => titles.get(key) ?? key, use24h: Boolean(B.meta.use24h) };
  const ref = (r: ProjectedRow, i: number): RowRef => ({ id: r.id, number: i + 1, title: r.title.trim() || "(untitled)" });
  const snap = (r: ProjectedRow, i: number): RowSnapshot => ({
    ...ref(r, i),
    type: TYPE_WORD[r.type] ?? r.type,
    cells: Object.fromEntries(Object.entries(r.cells).flatMap(([k, v]) => (k !== "title" && v.trim() ? [[ctx.columnTitle(k), v.trim()]] : []))),
    duration: r.durationSec != null ? formatDuration(r.durationSec) : null,
    start: r.hardStartSec != null ? formatTimeOfDay(r.hardStartSec, ctx.use24h) : null,
    hash: rowHash(r),
  });

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
  const added = B.rows.flatMap((r, i) => (pairedB.has(r.id) ? [] : [snap(r, i)]));
  const removed = A.rows.flatMap((r, i) => (pair.has(r.id) ? [] : [snap(r, i)]));
  const changed = B.rows.flatMap((r, i) => {
    const old = inA.get(r.id);
    if (!old) return [];
    const changes = fieldChanges(old.r, r, ctx);
    return changes.length ? [{ ...ref(r, i), changes }] : [];
  });
  const moving = movedIds(
    A.rows.flatMap((r) => (pair.has(r.id) ? [pair.get(r.id)!] : [])),
    B.rows.map((r) => r.id),
  );
  const moved = B.rows.flatMap((r, i) => (moving.has(r.id) ? [{ ...ref(r, i), from: (inA.get(r.id)?.i ?? i) + 1 }] : []));

  const sheet: ChangeDetail["sheet"] = [];
  const startOf = (v: number | null | undefined) => (v == null ? "—" : formatTimeOfDay(v, ctx.use24h));
  if ((A.meta.name ?? "") !== (B.meta.name ?? "")) sheet.push({ field: "Name", before: A.meta.name ?? "", after: B.meta.name ?? "" });
  if ((A.meta.plannedStartSec ?? null) !== (B.meta.plannedStartSec ?? null))
    sheet.push({ field: "Planned start", before: startOf(A.meta.plannedStartSec), after: startOf(B.meta.plannedStartSec) });
  const cols = (cs: typeof A.columns) => cs.map((c) => c.title).join(", ");
  if (A.columns.map((c) => `${c.key}:${c.title}`).join("|") !== B.columns.map((c) => `${c.key}:${c.title}`).join("|"))
    sheet.push({ field: "Columns", before: cols(A.columns), after: cols(B.columns) });

  return { added, removed, changed, moved, sheet };
}

export function compareSheets(from: Y.Doc, to: Y.Doc): SheetComparison {
  const d = diff(from, to);
  const ref = ({ id, number, title }: RowRef): RowRef => ({ id, number, title });
  return {
    added: d.added.map(ref),
    removed: d.removed.map(ref),
    changed: d.changed.map((r) => ({ ...ref(r), fields: r.changes.map((c) => (c.key === "type" ? `Type (${c.before} → ${c.after})` : c.key === "skipped" ? (c.after === "yes" ? "Struck" : "Un-struck") : c.field)) })),
    moved: d.moved.map(ref),
    sheet: d.sheet.map((s) => s.field),
    same: !d.added.length && !d.removed.length && !d.changed.length && !d.moved.length && !d.sheet.length,
  };
}

/** Longest text kept for one value in a recorded change. */
const VALUE_MAX = 2000;
const clip = (v: string) => (v.length > VALUE_MAX ? `${v.slice(0, VALUE_MAX)}…` : v);

/**
 * A change as the change log keeps it: before and after for every field that
 * moved, the rows created and deleted as they were, up to `limit` rows of
 * each kind (the counts stay whole). Null when nothing changed.
 */
export function describeChange(before: Y.Doc, after: Y.Doc, limit = 300): ChangeDetail | null {
  const d = diff(before, after);
  if (!d.added.length && !d.removed.length && !d.changed.length && !d.moved.length && !d.sheet.length) return null;
  const cut = <T,>(xs: T[]) => xs.slice(0, limit);
  const clipRow = (r: RowSnapshot): RowSnapshot => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, clip(v)])) });
  return {
    counts: { added: d.added.length, removed: d.removed.length, changed: d.changed.length, moved: d.moved.length },
    added: cut(d.added).map(clipRow),
    removed: cut(d.removed).map(clipRow),
    changed: cut(d.changed).map((r) => ({ ...r, changes: r.changes.map((c) => ({ ...c, before: clip(c.before), after: clip(c.after) })) })),
    moved: cut(d.moved),
    sheet: d.sheet,
    truncated: [d.added, d.removed, d.changed, d.moved].some((xs) => xs.length > limit),
  };
}

/** One line for a list: "added 2 rows · changed 3 rows (Title, Duration)". */
export function summarizeChange(detail: ChangeDetail): string {
  const n = detail.counts;
  const rows = (k: number) => (k === 1 ? "1 row" : `${k} rows`);
  const parts: string[] = [];
  if (n.added) parts.push(`added ${rows(n.added)}`);
  if (n.removed) parts.push(`deleted ${rows(n.removed)}`);
  if (n.changed) {
    const fields = [...new Set(detail.changed.flatMap((r) => r.changes.map((c) => c.field)))];
    const named = fields.slice(0, 3).join(", ") + (fields.length > 3 ? "…" : "");
    parts.push(`changed ${rows(n.changed)}${named ? ` (${named})` : ""}`);
  }
  if (n.moved) parts.push(`moved ${rows(n.moved)}`);
  if (detail.sheet.length) parts.push(`changed the sheet's ${detail.sheet.map((s) => s.field.toLowerCase()).join(", ")}`);
  return parts.join(" · ");
}

export interface RevertResult {
  /** Things put back. */
  undone: number;
  /** Things left alone, with why: somebody has changed them since. */
  skipped: { title: string; what: string; why: string }[];
}

/**
 * Takes back ONE recorded change on the sheet as it is now, keeping every
 * change anybody has made since. Values come from `before` (the version saved
 * just before the change); `detail` says what the change did. A value that
 * has moved on since the change is left alone and reported, never overwritten:
 * an undo must not quietly destroy somebody's later work.
 *
 * Re-timing is not re-run: the fixed times the change moved are themselves
 * in `detail`, and putting them back is what restores the timing.
 */
export function revertChange(current: Y.Doc, before: Y.Doc, detail: ChangeDetail): RevertResult {
  const result: RevertResult = { undone: 0, skipped: [] };
  // Half an undo is worse than none: a change too big to have been recorded
  // whole is not taken back piecemeal.
  if (detail.truncated) {
    result.skipped.push({ title: "This change", what: "everything", why: "it is too large to undo row by row — use Restore to just before it" });
    return result;
  }
  const rows = current.getMap<Y.Map<unknown>>("rows");
  const order = current.getArray<string>("rowOrder");
  const beforeRows = before.getMap<Y.Map<unknown>>("rows");
  const beforeOrder = before.getArray<string>("rowOrder").toArray();
  const now = new Map(projectRundownDoc(current).rows.map((r) => [r.id, r]));
  const colIdByKey = new Map(projectRundownDoc(current).columns.map((c) => [c.key, c.id]));
  const beforeColIdByKey = new Map(projectRundownDoc(before).columns.map((c) => [c.key, c.id]));
  const indexOf = (id: string) => order.toArray().indexOf(id);
  /** Where a row from `before` belongs now: after the nearest earlier row that still exists. */
  const homeOf = (id: string) => {
    for (let i = beforeOrder.indexOf(id) - 1; i >= 0; i--) {
      const at = indexOf(beforeOrder[i]!);
      if (at >= 0) return at + 1;
    }
    return 0;
  };

  current.transact(() => {
    // Rows it created go — unless somebody has worked on them since.
    for (const r of detail.added) {
      const live = now.get(r.id);
      if (!live) continue;
      if (rowHash(live) !== r.hash) {
        const nowTitle = live.title.trim();
        result.skipped.push({
          title: nowTitle && nowTitle !== r.title ? `${r.title} (now “${nowTitle}”)` : r.title,
          what: "added row",
          why: "it has been edited since, so it was kept",
        });
        continue;
      }
      const at = indexOf(r.id);
      if (at >= 0) order.delete(at, 1);
      rows.delete(r.id);
      result.undone++;
    }
    // Rows it deleted come back, where they were.
    for (const r of detail.removed) {
      if (rows.has(r.id)) continue;
      const original = beforeRows.get(r.id);
      if (!original) {
        result.skipped.push({ title: r.title, what: "deleted row", why: "it is not in the saved version" });
        continue;
      }
      rows.set(r.id, original.clone());
      order.insert(homeOf(r.id), [r.id]);
      result.undone++;
    }
    // Fields go back to what they were, where nobody has changed them since.
    for (const r of detail.changed) {
      const live = now.get(r.id);
      const row = rows.get(r.id);
      const old = beforeRows.get(r.id);
      if (!live || !row || !old) {
        if (!live) result.skipped.push({ title: r.title, what: "changes", why: "the row has been deleted since" });
        continue;
      }
      for (const c of r.changes) {
        if (fingerprint(rawValue(live, c.key)) !== c.afterHash) {
          result.skipped.push({ title: r.title, what: c.field, why: "changed again since" });
          continue;
        }
        if (c.key.startsWith("cell:")) {
          const colKey = c.key.slice(5);
          const colId = colIdByKey.get(colKey);
          const oldColId = beforeColIdByKey.get(colKey);
          const oldCells = old.get("cells") as Y.Map<Y.XmlFragment> | undefined;
          let cells = row.get("cells") as Y.Map<Y.XmlFragment> | undefined;
          if (!colId) {
            result.skipped.push({ title: r.title, what: c.field, why: "the column no longer exists" });
            continue;
          }
          if (!cells) {
            cells = new Y.Map<Y.XmlFragment>();
            row.set("cells", cells);
          }
          const was = oldColId ? oldCells?.get(oldColId) : undefined;
          if (was) cells.set(colId, was.clone());
          else cells.delete(colId);
        } else {
          row.set(c.key, old.get(c.key) ?? null);
        }
        result.undone++;
      }
    }
    // Rows it moved go back beside their old neighbours.
    for (const r of detail.moved) {
      const at = indexOf(r.id);
      if (at < 0) continue;
      order.delete(at, 1);
      order.insert(homeOf(r.id), [r.id]);
      result.undone++;
    }
  });
  if (detail.sheet.length) result.skipped.push({ title: "The sheet", what: detail.sheet.map((s) => s.field).join(", "), why: "sheet settings are not undone here — use Restore" });
  return result;
}
