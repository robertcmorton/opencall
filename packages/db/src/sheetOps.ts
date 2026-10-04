import * as Y from "yjs";
import { ulid } from "ulid";
import {
  computeTiming,
  fixedTimesAfterMove,
  formatDuration,
  formatTimeOfDay,
  startEditRipples,
  strikeShift,
  wrapTimeOfDay,
} from "@opencall/core";
import { projectRundownDoc, type ColumnDef } from "./doc.ts";

/**
 * Changes to a run sheet made from outside the editor — the AI-assistant (MCP)
 * tools — with exactly the editor's rules: a changed duration or start time
 * moves the fixed times below it, a strike gives its time back, a move
 * re-times as a drag does. Every function works on a live Y.Doc inside the
 * caller's transaction, so the change reaches every open screen at once.
 * Undo in the app only takes back that screen's own typing, so the way back
 * from an assistant's change is the snapshot taken before it.
 *
 * Rows are named by id; columns by key, title or id.
 */

export class SheetOpError extends Error {}

const rowsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("rows");
const orderOf = (doc: Y.Doc) => doc.getArray<string>("rowOrder");

function columns(doc: Y.Doc): ColumnDef[] {
  return projectRundownDoc(doc).columns;
}

/** A column by its key, its title (any case) or its id. */
export function findColumn(doc: Y.Doc, ref: string): ColumnDef {
  const want = ref.trim().toLowerCase();
  const cols = columns(doc);
  const col =
    cols.find((c) => c.id === ref) ??
    cols.find((c) => c.key.toLowerCase() === want) ??
    cols.find((c) => c.title.trim().toLowerCase() === want);
  if (!col) throw new SheetOpError(`No column called "${ref}". Columns: ${cols.map((c) => c.title).join(", ")}.`);
  return col;
}

function rowOrThrow(doc: Y.Doc, rowId: string): Y.Map<unknown> {
  const row = rowsOf(doc).get(rowId);
  if (!row) throw new SheetOpError(`No row with id "${rowId}" on this sheet.`);
  return row;
}

/** Replaces a fragment's content with plain text, one paragraph per line. */
function writeFragment(fragment: Y.XmlFragment, text: string): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs = lines.map((line) => {
    const p = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    if (line) t.insert(0, line);
    p.insert(0, [t]);
    return p;
  });
  fragment.insert(0, paragraphs);
}

/** The sheet as a reader needs it: columns, then rows with their computed times. */
export function readSheet(doc: Y.Doc, opts: { activeRowId?: string | null } = {}) {
  const { meta, columns: cols, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const text = cols.filter((c) => c.kind === "richtext" || c.kind === "title");
  return {
    name: meta.name,
    plannedStart: meta.plannedStartSec != null ? formatTimeOfDay(meta.plannedStartSec, meta.use24h) : null,
    columns: cols.map((c) => ({ key: c.key, title: c.title, kind: c.kind })),
    rows: rows.map((r, i) => {
      const t = timing.rows[i];
      const cells: Record<string, string> = {};
      for (const c of text) {
        const v = (r.cells[c.key] ?? "").trim();
        if (v && c.kind !== "title") cells[c.title] = v;
      }
      return {
        number: i + 1,
        id: r.id,
        type: r.type,
        title: r.title,
        start: t?.startSec != null ? formatTimeOfDay(t.startSec, meta.use24h) : null,
        fixedStart: r.hardStartSec != null,
        duration: r.durationSec != null ? formatDuration(r.durationSec) : null,
        struck: Boolean(r.skipped) || undefined,
        onAir: opts.activeRowId === r.id || undefined,
        cells,
      };
    }),
  };
}

/** Sets one cell's text. The title is a cell like any other. */
export function setCellText(doc: Y.Doc, rowId: string, columnRef: string, text: string): void {
  const row = rowOrThrow(doc, rowId);
  const col = findColumn(doc, columnRef);
  if (col.kind === "startTime" || col.kind === "duration") {
    throw new SheetOpError(`"${col.title}" is a time, not text — use set_start_time or set_duration.`);
  }
  let cells = row.get("cells") as Y.Map<Y.XmlFragment> | undefined;
  if (!cells) {
    cells = new Y.Map<Y.XmlFragment>();
    row.set("cells", cells);
  }
  let fragment = cells.get(col.id);
  if (!fragment) {
    fragment = new Y.XmlFragment();
    cells.set(col.id, fragment);
  }
  writeFragment(fragment, text);
}

/**
 * A new duration; every fixed time below moves by the difference, as in the
 * editor — unless the row is muted or struck and so outside the running order.
 */
export function setDuration(doc: Y.Doc, rowId: string, sec: number | null): void {
  const row = rowOrThrow(doc, rowId);
  const oldSec = (row.get("durationSec") as number | null | undefined) ?? null;
  const inTiming = !row.get("durationMuted") && !row.get("skipped");
  row.set("durationSec", sec);
  if (!inTiming || sec == null || oldSec == null || sec === oldSec) return;
  const delta = sec - oldSec;
  const order = orderOf(doc).toArray();
  const idx = order.indexOf(rowId);
  for (let i = idx + 1; i < order.length; i++) {
    const later = rowsOf(doc).get(order[i]!);
    const fixed = later?.get("hardStartSec") as number | null | undefined;
    if (fixed != null) later!.set("hardStartSec", fixed + delta);
  }
}

/** A fixed start time (or none). Ripples below only when the editor's rule says so. */
export function setStartTime(doc: Y.Doc, rowId: string, sec: number | null): void {
  const row = rowOrThrow(doc, rowId);
  const current = (row.get("hardStartSec") as number | null | undefined) ?? null;
  if (sec == null) {
    row.set("hardStartSec", null);
    return;
  }
  if (sec === current) return;
  const order = orderOf(doc).toArray();
  const idx = order.indexOf(rowId);
  const starts = order.map((id) => (rowsOf(doc).get(id)?.get("hardStartSec") as number | null | undefined) ?? null);
  const delta = current != null ? sec - current : 0;
  const ripples = idx >= 0 && delta !== 0 && startEditRipples(starts, idx, current, sec);
  row.set("hardStartSec", sec);
  if (!ripples) return;
  for (let i = idx + 1; i < order.length; i++) {
    const later = rowsOf(doc).get(order[i]!);
    const fixed = later?.get("hardStartSec") as number | null | undefined;
    if (fixed != null) later!.set("hardStartSec", fixed + delta);
  }
}

export interface NewRow {
  type?: "cue" | "group" | "milestone";
  title: string;
  /** Defaults as in the editor: a minute for an item, none for a heading or a fixed moment. */
  durationSec?: number | null;
  /** Column (key or title) → text. */
  cells?: Record<string, string>;
}

/** Adds a row after `afterRowId`, or at the top when that is null. Returns its id. */
export function addRow(doc: Y.Doc, afterRowId: string | null, spec: NewRow): string {
  const type = spec.type ?? "cue";
  const order = orderOf(doc);
  let at = 0;
  if (afterRowId) {
    const idx = order.toArray().indexOf(afterRowId);
    if (idx < 0) throw new SheetOpError(`No row with id "${afterRowId}" on this sheet.`);
    at = idx + 1;
  }
  const id = ulid();
  const row = new Y.Map<unknown>();
  row.set("id", id);
  row.set("type", type);
  row.set("hardStartSec", null);
  row.set("durationSec", spec.durationSec !== undefined ? spec.durationSec : type === "cue" ? 60 : null);
  row.set("cells", new Y.Map<Y.XmlFragment>());
  rowsOf(doc).set(id, row);
  order.insert(at, [id]);
  setCellText(doc, id, findColumn(doc, "title").id, spec.title);
  for (const [ref, text] of Object.entries(spec.cells ?? {})) setCellText(doc, id, ref, text);
  return id;
}

export function deleteRow(doc: Y.Doc, rowId: string): void {
  rowOrThrow(doc, rowId);
  const order = orderOf(doc);
  const idx = order.toArray().indexOf(rowId);
  if (idx >= 0) order.delete(idx, 1);
  rowsOf(doc).delete(rowId);
}

/**
 * Moves a row to just after `afterRowId` (or to the top), re-timing exactly as
 * a drag in the editor does.
 */
export function moveRow(doc: Y.Doc, rowId: string, afterRowId: string | null, liveRowId: string | null = null): void {
  rowOrThrow(doc, rowId);
  const { meta, rows } = projectRundownDoc(doc);
  const order = orderOf(doc).toArray();
  const from = order.indexOf(rowId);
  let to = 0;
  if (afterRowId) {
    const target = order.indexOf(afterRowId);
    if (target < 0) throw new SheetOpError(`No row with id "${afterRowId}" on this sheet.`);
    if (afterRowId === rowId) return;
    to = from < target ? target : target + 1;
  }
  if (from === to) return;
  const liveIdx = liveRowId ? rows.findIndex((r) => r.id === liveRowId) : -1;
  const changes = rows[from]?.id === rowId ? fixedTimesAfterMove(rows, from, to, meta.plannedStartSec, liveIdx) : [];
  const yOrder = orderOf(doc);
  yOrder.delete(from, 1);
  yOrder.insert(to, [rowId]);
  for (const c of changes) rowsOf(doc).get(c.id)?.set("hardStartSec", c.hardStartSec);
}

/** Strikes a row (or puts it back): it stays visible, its time is given back below. */
export function strikeRow(doc: Y.Doc, rowId: string, struck: boolean, liveRowId: string | null = null): void {
  const row = rowOrThrow(doc, rowId);
  if (Boolean(row.get("skipped")) === struck) return;
  const { rows } = projectRundownDoc(doc);
  const idx = rows.findIndex((r) => r.id === rowId);
  const liveIdx = liveRowId ? rows.findIndex((r) => r.id === liveRowId) : -1;
  row.set("skipped", struck);
  const delta = strikeShift(rows, idx, struck, liveIdx);
  if (delta === 0) return;
  for (let i = idx + 1; i < rows.length; i++) {
    const later = rowsOf(doc).get(rows[i]!.id);
    const fixed = later?.get("hardStartSec") as number | null | undefined;
    if (fixed != null) later!.set("hardStartSec", wrapTimeOfDay(fixed + delta));
  }
}
