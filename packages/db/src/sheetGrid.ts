import * as Y from "yjs";
import { ulid } from "ulid";
import { parseDurationShorthand, parseTimeOfDay } from "@opencall/core";
import type { ColumnKind } from "./doc.ts";

/**
 * The sheet as a spreadsheet: paste a block, copy one out, fill down, clear.
 *
 * A block copied from Google Sheets or Excel arrives as tab-separated text —
 * a cell holding a line break or a tab is wrapped in double quotes, with any
 * quote inside it doubled. Each function here works on a live Y.Doc and is
 * meant to run inside ONE transaction of the caller's, so one Undo takes the
 * whole paste (or fill, or clear) back.
 *
 * Locked rows are left alone and counted, as find-and-replace does: an
 * approved row is not changed by a paste somebody aimed a row too high.
 *
 * Browser-safe: the editor imports it directly.
 */

export interface GridColumn {
  id: string;
  kind: ColumnKind;
}

const rowsOf = (doc: Y.Doc) => doc.getMap<Y.Map<unknown>>("rows");
const orderOf = (doc: Y.Doc) => doc.getArray<string>("rowOrder");

/** Tab-separated text → rows of cells. Quoted cells may hold tabs, line breaks and "" quotes. */
export function parseGrid(text: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let atCellStart = true;
  while (i < s.length) {
    const ch = s[i]!;
    if (atCellStart && ch === '"') {
      // A quoted cell runs to the next quote that is not doubled.
      let j = i + 1;
      let quoted = "";
      let closed = false;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            quoted += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        quoted += s[j];
        j++;
      }
      // Only a real quoted cell if the quote closes at the cell's end; a cell
      // that merely STARTS with a quote ("Hello" she said) is taken as typed.
      if (closed && (j >= s.length || s[j] === "\t" || s[j] === "\n")) {
        cell = quoted;
        i = j;
        atCellStart = false;
        continue;
      }
    }
    atCellStart = false;
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (ch === "\n") {
      row.push(cell);
      out.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else cell += ch;
    i++;
  }
  // The copied block's last line ends in a line break; that is not an extra row.
  if (!atCellStart || cell !== "" || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}

/** Rows of cells → tab-separated text that Google Sheets and Excel read back as the same block. */
export function formatGrid(cells: string[][]): string {
  const one = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return cells.map((r) => r.map(one).join("\t")).join("\n");
}

function fragmentOf(row: Y.Map<unknown>, columnId: string, create: boolean): Y.XmlFragment | null {
  let cells = row.get("cells") as Y.Map<Y.XmlFragment> | undefined;
  if (!cells) {
    if (!create) return null;
    cells = new Y.Map<Y.XmlFragment>();
    row.set("cells", cells);
  }
  let fragment = cells.get(columnId);
  if (!fragment && create) {
    fragment = new Y.XmlFragment();
    cells.set(columnId, fragment);
  }
  return fragment ?? null;
}

/** Replaces a cell's content with plain text, one paragraph per line. */
function writeText(fragment: Y.XmlFragment, text: string): void {
  if (fragment.length > 0) fragment.delete(0, fragment.length);
  if (text === "") return;
  fragment.insert(
    0,
    text.split("\n").map((line) => {
      const p = new Y.XmlElement("paragraph");
      const t = new Y.XmlText();
      if (line) t.insert(0, line);
      p.insert(0, [t]);
      return p;
    }),
  );
}

/** A new item at the end of the sheet, with no length invented for it. */
export function appendRow(doc: Y.Doc, afterRowId: string | null = null, durationSec: number | null = null): string {
  const id = ulid();
  const row = new Y.Map<unknown>();
  row.set("id", id);
  row.set("type", "cue");
  row.set("hardStartSec", null);
  row.set("durationSec", durationSec);
  row.set("cells", new Y.Map<Y.XmlFragment>());
  rowsOf(doc).set(id, row);
  const order = orderOf(doc);
  const at = afterRowId ? order.toArray().indexOf(afterRowId) + 1 : order.length;
  order.insert(at > 0 ? at : order.length, [id]);
  return id;
}

export interface PasteResult {
  /** Rows of the sheet written to, new ones included. */
  rows: number;
  columns: number;
  added: string[];
  lockedSkipped: number;
  /** Times and lengths that could not be read, left as they were. */
  unreadable: number;
  /** Pasted columns beyond the sheet's last one. */
  droppedColumns: number;
}

/**
 * Writes `grid` into the sheet with its top-left cell at `rowIds[0]` ×
 * `columns[0]`. `rowIds` are the sheet's rows from there down, in the order
 * shown; `columns` the columns from there to the right. A block taller than
 * what is left of the sheet adds rows at the end.
 */
export function pasteGrid(doc: Y.Doc, rowIds: string[], columns: GridColumn[], grid: string[][]): PasteResult {
  const rows = rowsOf(doc);
  const width = Math.max(0, ...grid.map((r) => r.length));
  const result: PasteResult = { rows: 0, columns: Math.min(width, columns.length), added: [], lockedSkipped: 0, unreadable: 0, droppedColumns: Math.max(0, width - columns.length) };
  let last = rowIds[rowIds.length - 1] ?? orderOf(doc).toArray().at(-1) ?? null;
  grid.forEach((values, r) => {
    let rowId = rowIds[r];
    if (!rowId) {
      rowId = appendRow(doc, last);
      result.added.push(rowId);
    }
    last = rowId;
    const row = rows.get(rowId);
    if (!row) return;
    if (row.get("locked")) {
      result.lockedSkipped++;
      return;
    }
    result.rows++;
    values.slice(0, columns.length).forEach((raw, c) => {
      const col = columns[c]!;
      const value = col.kind === "title" || col.kind === "richtext" ? raw : raw.trim();
      if (col.kind === "startTime") {
        if (value === "") row.set("hardStartSec", null);
        else {
          const sec = parseTimeOfDay(value);
          if (sec == null) result.unreadable++;
          else row.set("hardStartSec", sec);
        }
      } else if (col.kind === "duration") {
        // Headings and fixed moments have no length to set.
        if (row.get("type") !== "cue") return;
        if (value === "") row.set("durationSec", null);
        else {
          const sec = parseDurationShorthand(value);
          if (sec == null) result.unreadable++;
          else row.set("durationSec", sec);
        }
      } else {
        writeText(fragmentOf(row, col.id, true)!, value);
      }
    });
  });
  return result;
}

/**
 * Copies each column's top cell into the cells below it, formatting and all.
 * `rowIds` is the block's rows in order, the source first. Returns how many
 * cells were written.
 */
export function fillDown(doc: Y.Doc, rowIds: string[], columns: GridColumn[]): { filled: number; lockedSkipped: number } {
  const rows = rowsOf(doc);
  const source = rows.get(rowIds[0] ?? "");
  const out = { filled: 0, lockedSkipped: 0 };
  if (!source) return out;
  for (const id of rowIds.slice(1)) {
    const row = rows.get(id);
    if (!row) continue;
    if (row.get("locked")) {
      out.lockedSkipped++;
      continue;
    }
    for (const col of columns) {
      if (col.kind === "startTime") row.set("hardStartSec", (source.get("hardStartSec") as number | null | undefined) ?? null);
      else if (col.kind === "duration") {
        if (row.get("type") !== "cue") continue;
        row.set("durationSec", (source.get("durationSec") as number | null | undefined) ?? null);
      } else {
        const from = fragmentOf(source, col.id, false);
        const to = fragmentOf(row, col.id, true)!;
        if (to.length > 0) to.delete(0, to.length);
        if (from && from.length > 0) to.insert(0, from.toArray().map((n) => (n as Y.XmlElement | Y.XmlText).clone()));
      }
      out.filled++;
    }
  }
  return out;
}

/** Empties a block: text gone, fixed times back to flowing, lengths unset. */
export function clearCells(doc: Y.Doc, rowIds: string[], columns: GridColumn[]): { cleared: number; lockedSkipped: number } {
  const rows = rowsOf(doc);
  const out = { cleared: 0, lockedSkipped: 0 };
  for (const id of rowIds) {
    const row = rows.get(id);
    if (!row) continue;
    if (row.get("locked")) {
      out.lockedSkipped++;
      continue;
    }
    for (const col of columns) {
      if (col.kind === "startTime") row.set("hardStartSec", null);
      else if (col.kind === "duration") {
        if (row.get("type") === "cue") row.set("durationSec", null);
      } else {
        const f = fragmentOf(row, col.id, false);
        if (f && f.length > 0) f.delete(0, f.length);
      }
      out.cleared++;
    }
  }
  return out;
}
