"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type * as Y from "yjs";
import { appendRow, clearCells, fillDown, formatGrid, parseGrid, pasteGrid, type GridColumn } from "@opencall/db/sheetGrid";

/**
 * The run sheet behaving like a spreadsheet.
 *
 * Click a cell and it is the cursor (a blue box). From there: type and the
 * cell opens with what was typed; Enter or F2 opens it as it is; arrows, Tab
 * and Shift+Tab move; Shift+arrow or Shift+click grows a block; Delete
 * empties it; Cmd+C / Cmd+X copy or cut it as a block Google Sheets and Excel
 * read; Cmd+V pastes a block copied from them; Cmd+D fills the top of the
 * block down (or, on one row, copies the cell above). Every change is one
 * transaction, so one Undo takes it back.
 *
 * None of it fires while something else has the keyboard — a cell editor, a
 * search box, a dialog — and none of it is offered where the sheet cannot be
 * edited. The grid's double click still works exactly as before.
 */

export interface GridCell {
  rowId: string;
  columnId: string;
}

export function useSheetGrid(opts: {
  enabled: boolean;
  doc: Y.Doc;
  gridEl: HTMLElement | null;
  /** The rows a cursor can stand on, in the order shown. */
  rowIds: string[];
  /** The columns shown, left to right. */
  columns: GridColumn[];
  /** A cell editor, time box or length box is open. */
  editorOpen: boolean;
  /** Space starts typing only when it is not the show's Next. */
  spaceTypes: boolean;
  /** The text a cell shows, for copying. */
  textOf: (rowId: string, column: GridColumn) => string;
  /** Opens the cell's own editor; `seed` replaces what is there with what was typed. */
  open: (cell: GridCell, seed?: string) => void;
  /** Keys typed after `open` but before its editor had the keyboard. */
  typeAhead: (cell: GridCell, text: string) => void;
  /** Brings a row that is not drawn yet (the sheet draws a window of rows) into view. */
  scrollToIndex: (index: number) => void;
  /** Default length for a row added by Enter on the last row. */
  newRowSec: number | null;
}) {
  const [cursor, setCursor] = useState<GridCell | null>(null);
  const [anchor, setAnchor] = useState<GridCell | null>(null);
  /** The note after a change; `undo` puts an Undo button on it (a phone has no ⌘Z). */
  const [note, setNoteState] = useState<{ text: string; undo: boolean; at: number } | null>(null);
  const setNote = (text: string | null, undo = false) => setNoteState(text == null ? null : { text, undo, at: Date.now() });
  /** Opened by typing, and when: keys that beat the editor to the keyboard are passed on. */
  const typing = useRef<{ cell: GridCell; at: number } | null>(null);

  const { enabled, doc, gridEl, rowIds, columns } = opts;
  // A cursor on a row that has gone (deleted, or hidden by an ending) is no cursor.
  const live = cursor && enabled && rowIds.includes(cursor.rowId) && columns.some((c) => c.id === cursor.columnId) ? cursor : null;
  const liveAnchor = live && anchor && rowIds.includes(anchor.rowId) && columns.some((c) => c.id === anchor.columnId) ? anchor : null;

  useEffect(() => {
    if (!note) return;
    // Longer when there is a button to reach: a finger needs the time.
    const t = window.setTimeout(() => setNoteState(null), note.undo ? 9000 : 4500);
    return () => window.clearTimeout(t);
  }, [note]);

  /** The block: from anchor to cursor, as row and column index ranges. */
  const block = () => {
    if (!live) return null;
    const a = liveAnchor ?? live;
    const r = [rowIds.indexOf(a.rowId), rowIds.indexOf(live.rowId)].sort((x, y) => x - y) as [number, number];
    const c = [columns.findIndex((x) => x.id === a.columnId), columns.findIndex((x) => x.id === live.columnId)].sort((x, y) => x - y) as [number, number];
    return { rows: rowIds.slice(r[0], r[1] + 1), cols: columns.slice(c[0], c[1] + 1), r, c };
  };
  const b = block();
  const multi = !!b && (b.rows.length > 1 || b.cols.length > 1);

  /**
   * Into view WITHIN THE SHEET only. scrollIntoView scrolls every ancestor
   * that can scroll — including the page's frame, which it shifted 14px
   * sideways (6 Oct) — so the sheet's own scroller is moved by hand. The
   * header row is sticky, so its height is kept clear at the top.
   */
  const scrollWithin = (td: HTMLElement) => {
    if (!gridEl) return;
    const box = gridEl.getBoundingClientRect();
    const r = td.getBoundingClientRect();
    const head = gridEl.querySelector("thead")?.getBoundingClientRect().height ?? 0;
    if (r.top < box.top + head) gridEl.scrollTop -= box.top + head - r.top;
    else if (r.bottom > box.bottom) gridEl.scrollTop += r.bottom - box.bottom;
    if (r.left < box.left) gridEl.scrollLeft -= box.left - r.left;
    else if (r.right > box.right) gridEl.scrollLeft += r.right - box.right;
  };
  const reveal = (cell: GridCell) => {
    const td = gridEl?.querySelector<HTMLElement>(`tr[data-rowid="${cell.rowId}"] td[data-colid="${cell.columnId}"]`);
    if (td) scrollWithin(td);
    else opts.scrollToIndex(rowIds.indexOf(cell.rowId));
  };

  const go = (cell: GridCell, extend = false) => {
    if (extend) setAnchor((a) => a ?? live);
    else setAnchor(null);
    setCursor(cell);
    // After the render that draws it.
    window.requestAnimationFrame(() => reveal(cell));
  };

  const step = (dRow: number, dCol: number, extend = false, toEdge = false) => {
    if (!live) return;
    let r = rowIds.indexOf(live.rowId);
    let c = columns.findIndex((x) => x.id === live.columnId);
    if (toEdge) {
      // As a spreadsheet does: inside a run of filled cells, to the end of the
      // run; otherwise on to the next filled cell; failing both, the edge.
      const filled = (ri: number, ci: number) => opts.textOf(rowIds[ri]!, columns[ci]!).trim() !== "";
      const n = dRow ? rowIds.length : columns.length;
      const at = (i: number) => (dRow ? filled(i, c) : filled(r, i));
      const d = dRow || dCol;
      let i = dRow ? r : c;
      if (at(i) && i + d >= 0 && i + d < n && at(i + d)) {
        while (i + d >= 0 && i + d < n && at(i + d)) i += d;
      } else {
        i += d;
        while (i >= 0 && i < n && !at(i)) i += d;
        if (i < 0 || i >= n) i = d < 0 ? 0 : n - 1;
      }
      if (dRow) r = i;
      else c = i;
    } else {
      r = Math.max(0, Math.min(rowIds.length - 1, r + dRow));
      c = Math.max(0, Math.min(columns.length - 1, c + dCol));
    }
    go({ rowId: rowIds[r]!, columnId: columns[c]!.id }, extend);
  };

  /** Tab: along the row, then on to the start of the next one. */
  const tab = (back: boolean) => {
    if (!live) return;
    let r = rowIds.indexOf(live.rowId);
    let c = columns.findIndex((x) => x.id === live.columnId) + (back ? -1 : 1);
    if (c >= columns.length) {
      if (r >= rowIds.length - 1) return;
      r++;
      c = 0;
    } else if (c < 0) {
      if (r <= 0) return;
      r--;
      c = columns.length - 1;
    }
    go({ rowId: rowIds[r]!, columnId: columns[c]!.id });
  };

  /** After an edit is committed with Enter, Tab or Shift+Tab. Enter on the last row adds one. */
  const afterCommit = (how: "down" | "up" | "right" | "left") => {
    if (!live) return;
    typing.current = null;
    if (how === "right" || how === "left") return tab(how === "left");
    if (how === "down" && rowIds.indexOf(live.rowId) === rowIds.length - 1) {
      let id = "";
      doc.transact(() => {
        id = appendRow(doc, live.rowId, opts.newRowSec);
      });
      go({ rowId: id, columnId: live.columnId });
      return;
    }
    step(how === "down" ? 1 : -1, 0);
  };

  const report = (what: string, lockedSkipped: number, extra = "") =>
    setNote(`${what}${lockedSkipped ? ` Skipped ${lockedSkipped} locked row${lockedSkipped === 1 ? "" : "s"}.` : ""}${extra}`, true);

  const busyTarget = (t: EventTarget | null) =>
    // A menu with the keyboard (the row menu) keeps its keys: Escape closing
    // it was also putting the cursor away, and its arrows moved the cursor.
    !!(t as HTMLElement | null)?.closest?.("input, textarea, select, [contenteditable=true], [role=dialog], [role=menu]");

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (!live || e.defaultPrevented || e.isComposing) return;
    const printable = e.key.length === 1 && !e.metaKey && !e.ctrlKey && (e.key !== " " || opts.spaceTypes);
    if (opts.editorOpen) {
      // The editor is on its way but does not have the keyboard yet: keep the key.
      const t = typing.current;
      if (printable && t && Date.now() - t.at < 1500 && !busyTarget(e.target)) {
        e.preventDefault();
        opts.typeAhead(t.cell, e.key);
      }
      return;
    }
    if (busyTarget(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    switch (e.key) {
      case "ArrowUp":
      case "ArrowDown":
      case "ArrowLeft":
      case "ArrowRight": {
        if (e.altKey) return;
        e.preventDefault();
        const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key] as [number, number];
        step(d[0], d[1], e.shiftKey, mod);
        return;
      }
      case "Tab":
        if (mod || e.altKey) return;
        e.preventDefault();
        tab(e.shiftKey);
        return;
      case "Enter":
      case "F2":
        if (mod || e.altKey) return;
        e.preventDefault();
        if (e.key === "Enter" && e.shiftKey) return step(-1, 0);
        setAnchor(null);
        opts.open(live);
        return;
      case "Escape":
        setCursor(null);
        setAnchor(null);
        return;
      case "ContextMenu":
      case "F10": {
        // The keyboard's way to the row menu (the Menu key, or Shift+F10):
        // the menu a right-click opens, at the cell with the blue box.
        if (e.key === "F10" && !e.shiftKey) return;
        const td = gridEl?.querySelector<HTMLElement>(`tr[data-rowid="${live.rowId}"] td[data-colid="${live.columnId}"]`);
        if (!td) return;
        e.preventDefault();
        const r = td.getBoundingClientRect();
        td.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.bottom - 4 }));
        return;
      }
      case "Backspace":
      case "Delete": {
        if (mod || !b) return;
        e.preventDefault();
        let r = { cleared: 0, lockedSkipped: 0 };
        doc.transact(() => {
          r = clearCells(doc, b.rows, b.cols);
        });
        if (multi || r.lockedSkipped) report(`Emptied ${r.cleared} cell${r.cleared === 1 ? "" : "s"}.`, r.lockedSkipped);
        return;
      }
    }
    if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d" && b) {
      e.preventDefault();
      // One row: copy the cell above, as a spreadsheet does.
      const r0 = b.r[0];
      const rows = b.rows.length > 1 ? b.rows : r0 > 0 ? [rowIds[r0 - 1]!, ...b.rows] : null;
      if (!rows) return;
      let r = { filled: 0, lockedSkipped: 0 };
      doc.transact(() => {
        r = fillDown(doc, rows, b.cols);
      });
      report(`Copied the top row into ${r.filled} cell${r.filled === 1 ? "" : "s"} below it.`, r.lockedSkipped);
      return;
    }
    if (printable && !e.altKey) {
      e.preventDefault();
      setAnchor(null);
      typing.current = { cell: live, at: Date.now() };
      opts.open(live, e.key);
    }
  });

  const onCopy = useEffectEvent((e: ClipboardEvent, cut: boolean) => {
    if (!live || !b || opts.editorOpen || busyTarget(e.target) || !e.clipboardData) return;
    // Text somebody has selected with the mouse copies as text, as always.
    if ((window.getSelection()?.toString() ?? "") !== "") return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", formatGrid(b.rows.map((id) => b.cols.map((c) => opts.textOf(id, c)))));
    if (cut) {
      let r = { cleared: 0, lockedSkipped: 0 };
      doc.transact(() => {
        r = clearCells(doc, b.rows, b.cols);
      });
      report(`Cut ${r.cleared} cell${r.cleared === 1 ? "" : "s"}. Paste them where you want them.`, r.lockedSkipped);
    } else if (multi)
      setNote(`Copied ${b.rows.length} row${b.rows.length === 1 ? "" : "s"} and ${b.cols.length} column${b.cols.length === 1 ? "" : "s"}. You can paste them here or into Google Sheets.`);
  });

  const onPaste = useEffectEvent((e: ClipboardEvent) => {
    if (!live || !b || opts.editorOpen || busyTarget(e.target) || !e.clipboardData) return;
    let grid = gridFromHtml(e.clipboardData.getData("text/html")) ?? parseGrid(e.clipboardData.getData("text/plain"));
    if (grid.length === 0) return;
    e.preventDefault();
    // One value into a block fills the block, as a spreadsheet does.
    if (grid.length === 1 && grid[0]!.length === 1 && multi) grid = b.rows.map(() => b.cols.map(() => grid[0]![0]!));
    const startRow = b.r[0];
    const startCol = b.c[0];
    let r: ReturnType<typeof pasteGrid> | null = null;
    doc.transact(() => {
      r = pasteGrid(doc, rowIds.slice(startRow), columns.slice(startCol), grid);
    });
    const res = r as ReturnType<typeof pasteGrid> | null;
    if (!res) return;
    const extra =
      (res.added.length ? ` Added ${res.added.length} new row${res.added.length === 1 ? "" : "s"} at the end.` : "") +
      (res.unreadable ? ` ${res.unreadable} time${res.unreadable === 1 ? "" : "s"} or length${res.unreadable === 1 ? "" : "s"} didn't make sense, so ${res.unreadable === 1 ? "that cell was" : "those cells were"} not changed.` : "") +
      (res.droppedColumns ? ` ${res.droppedColumns} column${res.droppedColumns === 1 ? " didn't" : "s didn't"} fit, so ${res.droppedColumns === 1 ? "it was" : "they were"} left out.` : "");
    const height = grid.length;
    if (height > 1 || res.columns > 1 || extra || res.lockedSkipped)
      report(`Pasted ${height} row${height === 1 ? "" : "s"} and ${res.columns} column${res.columns === 1 ? "" : "s"}.`, res.lockedSkipped, extra);
    // The pasted block becomes the selection.
    const lastRow = [...rowIds.slice(startRow), ...res.added][height - 1];
    const lastCol = columns[Math.min(columns.length - 1, startCol + res.columns - 1)];
    setAnchor({ rowId: rowIds[startRow]!, columnId: columns[startCol]!.id });
    if (lastRow && lastCol) {
      const end = { rowId: lastRow, columnId: lastCol.id };
      setCursor(end);
      // New rows are drawn a render later; the end of the block is where the eye goes.
      window.setTimeout(() => {
        const td = gridEl?.querySelector<HTMLElement>(`tr[data-rowid="${end.rowId}"] td[data-colid="${end.columnId}"]`);
        if (td) scrollWithin(td);
      }, 60);
    }
  });

  useEffect(() => {
    if (!enabled) return;
    const key = (e: KeyboardEvent) => onKey(e);
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    const paste = (e: ClipboardEvent) => onPaste(e);
    document.addEventListener("keydown", key);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", paste);
    return () => {
      document.removeEventListener("keydown", key);
      document.removeEventListener("copy", copy);
      document.removeEventListener("cut", cut);
      document.removeEventListener("paste", paste);
    };
  }, [enabled]);

  // A click on a cell puts the cursor there; Shift+click grows the block.
  // Anything inside the cell that is its own control keeps its click.
  const cellAt = (t: Element | null): GridCell | null => {
    const td = t?.closest<HTMLElement>("td[data-colid]");
    const rowId = td?.closest<HTMLElement>("tr[data-rowid]")?.dataset.rowid;
    return td && rowId && gridEl?.contains(td) ? { rowId, columnId: td.dataset.colid! } : null;
  };
  /**
   * Drag to pick a block. A mouse drags from any cell. A finger drags from
   * the cell that already has the blue box (tap first, then drag) — a finger
   * dragging anywhere else is scrolling the sheet, and must keep doing that.
   * The box's cell is `touch-action: none` (see the CSS) so the browser hands
   * that drag to us instead of scrolling.
   */
  const drag = useRef<{ start: GridCell; moved: boolean; id: number } | null>(null);
  const draggedAt = useRef(0);
  const onDragStart = useEffectEvent((e: PointerEvent) => {
    if (!e.isPrimary || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, select, [contenteditable=true], .popover, [data-popover]")) return;
    const cell = cellAt(t);
    if (!cell) return;
    if (e.pointerType !== "mouse" && !(live && live.rowId === cell.rowId && live.columnId === cell.columnId)) return;
    drag.current = { start: cell, moved: false, id: e.pointerId };
  });
  const onDragMove = useEffectEvent((e: PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const cell = cellAt(document.elementFromPoint(e.clientX, e.clientY));
    if (!cell) return;
    if (!d.moved && cell.rowId === d.start.rowId && cell.columnId === d.start.columnId) return;
    if (!d.moved) {
      d.moved = true;
      gridEl?.classList.add("grid-dragging");
    }
    window.getSelection()?.removeAllRanges();
    setAnchor(d.start);
    setCursor(cell);
    // Near the top or bottom edge, keep going: the sheet scrolls under the drag.
    if (gridEl) {
      const box = gridEl.getBoundingClientRect();
      if (e.clientY > box.bottom - 40) gridEl.scrollTop += 24;
      else if (e.clientY < box.top + 60) gridEl.scrollTop -= 24;
    }
  });
  const onDragEnd = useEffectEvent(() => {
    if (drag.current?.moved) draggedAt.current = Date.now();
    drag.current = null;
    gridEl?.classList.remove("grid-dragging");
  });
  const onClick = useEffectEvent((e: MouseEvent) => {
    // The click a drag ends with is not a click on one cell.
    if (Date.now() - draggedAt.current < 300) return;
    const t = e.target as HTMLElement;
    if (t.closest("button, a, input, textarea, select, [contenteditable=true], .popover, [data-popover], .format-bar, .chip-row")) return;
    const td = t.closest<HTMLElement>("td[data-colid]");
    const rowId = td?.closest<HTMLElement>("tr[data-rowid]")?.dataset.rowid;
    if (!td || !rowId) return;
    const cell = { rowId, columnId: td.dataset.colid! };
    if (e.shiftKey && live) {
      setAnchor((a) => a ?? live);
      setCursor(cell);
      // Shift+click would otherwise select the text between the two clicks.
      window.getSelection()?.removeAllRanges();
    } else {
      setAnchor(null);
      setCursor(cell);
    }
  });
  // Clicking anywhere outside the grid puts the cursor away, so keys typed
  // into the rest of the page never land in a cell.
  const onOutside = useEffectEvent((e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (gridEl?.contains(t) || t.closest?.(".popover, [data-popover], .format-bar, .grid-note, .row-menu, .app-dialog, .app-notes")) return;
    setCursor(null);
    setAnchor(null);
  });
  useEffect(() => {
    if (!enabled || !gridEl) return;
    const click = (e: MouseEvent) => onClick(e);
    const down = (e: MouseEvent) => onOutside(e);
    const pdown = (e: PointerEvent) => onDragStart(e);
    const pmove = (e: PointerEvent) => onDragMove(e);
    const pend = () => onDragEnd();
    gridEl.addEventListener("click", click);
    gridEl.addEventListener("pointerdown", pdown);
    document.addEventListener("pointermove", pmove);
    document.addEventListener("pointerup", pend);
    document.addEventListener("pointercancel", pend);
    document.addEventListener("mousedown", down);
    return () => {
      gridEl.removeEventListener("click", click);
      gridEl.removeEventListener("pointerdown", pdown);
      document.removeEventListener("pointermove", pmove);
      document.removeEventListener("pointerup", pend);
      document.removeEventListener("pointercancel", pend);
      document.removeEventListener("mousedown", down);
    };
  }, [enabled, gridEl]);

  /** What a cell needs to be found and to show the cursor and block. */
  const cellProps = (rowId: string, columnId: string) => {
    const at = live?.rowId === rowId && live.columnId === columnId;
    const inBlock = multi && !!b && b.rows.includes(rowId) && b.cols.some((c) => c.id === columnId);
    return {
      "data-colid": columnId,
      "data-cursor": at ? "" : undefined,
      "data-inblock": inBlock ? "" : undefined,
    };
  };

  return {
    cursor: live,
    cellProps,
    afterCommit,
    /** Put the cursor somewhere (a double click that opened an editor). */
    place: (cell: GridCell) => {
      setAnchor(null);
      setCursor(cell);
    },
    note,
    /** Show a note; `undo` adds the Undo button. Used by the row menu too. */
    say: (text: string, undo = false) => setNote(text, undo),
    dismissNote: () => setNoteState(null),
  };
}

/** A table copied from Google Sheets or Excel, read from its HTML so line breaks inside cells survive. */
function gridFromHtml(html: string): string[][] | null {
  if (!html || !/<table/i.test(html)) return null;
  const table = new DOMParser().parseFromString(html, "text/html").querySelector("table");
  if (!table) return null;
  const grid = [...table.rows].map((tr) =>
    [...tr.cells].map((td) => {
      const cell = td.cloneNode(true) as HTMLElement;
      for (const br of cell.querySelectorAll("br")) br.replaceWith("\n");
      return (cell.textContent ?? "").replace(/ /g, " ").replace(/\n+$/, "");
    }),
  );
  return grid.length > 0 ? grid : null;
}
