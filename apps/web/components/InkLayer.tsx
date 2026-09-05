"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { INK_WIDTH, pathFor, simplify, type InkColour, type InkDoc, type InkMode, type Stroke } from "@opencall/core";

/**
 * The sheet of tracing paper over the run sheet.
 *
 * One SVG, laid over the table's body inside the scroll box so it scrolls
 * with the rows. Each row's strokes sit in a group translated to where that
 * row is right now; the rows are re-measured whenever one changes size or
 * the body's children change, so the ink follows the row it was drawn on
 * through edits, strikes, moves and the row window.
 *
 * Who draws: a pencil or a mouse, once Ink is on. A finger always scrolls —
 * on an iPad in a hurry the hand that steadies the screen must not leave
 * marks, and pinch-zoom has to keep working. Ink off means the layer is not
 * there at all as far as pointers are concerned; every click reaches the
 * sheet beneath.
 */

interface RowBox {
  id: string;
  top: number;
  left: number;
  w: number;
  h: number;
}

interface Geometry {
  left: number;
  top: number;
  width: number;
  height: number;
  rows: RowBox[];
}

interface Props {
  /** The `.grid-scroll` box the table lives in. */
  container: HTMLDivElement | null;
  tbody: RefObject<HTMLTableSectionElement | null>;
  doc: InkDoc;
  mode: InkMode;
  colour: InkColour;
  /** Marks kept but not shown — a clean sheet for a moment, nothing lost. */
  hidden?: boolean;
  onStroke: (rowId: string, stroke: Stroke) => void;
  onErase: (rowId: string, xFrac: number, yPx: number, rowWidth: number) => void;
}

const EMPTY: Geometry = { left: 0, top: 0, width: 0, height: 0, rows: [] };

export function InkLayer({ container, tbody, doc, mode, colour, hidden = false, onStroke, onErase }: Props) {
  const [geo, setGeo] = useState<Geometry>(EMPTY);
  const svgRef = useRef<SVGSVGElement>(null);
  const active = useRef<{ row: RowBox; pointerId: number; p: number[] } | null>(null);
  const [live, setLive] = useState<{ rowId: string; stroke: Stroke } | null>(null);
  const geoRef = useRef(geo);
  geoRef.current = geo;

  const measure = useCallback(() => {
    const tb = tbody.current;
    if (!container || !tb) return;
    const cRect = container.getBoundingClientRect();
    const bRect = tb.getBoundingClientRect();
    const rows: RowBox[] = [];
    tb.querySelectorAll<HTMLTableRowElement>("tr[data-rowid]").forEach((tr) => {
      const r = tr.getBoundingClientRect();
      if (r.height === 0) return;
      rows.push({ id: tr.dataset.rowid!, top: r.top - bRect.top, left: r.left - bRect.left, w: r.width, h: r.height });
    });
    const next: Geometry = {
      left: bRect.left - cRect.left + container.scrollLeft,
      top: bRect.top - cRect.top + container.scrollTop,
      width: bRect.width,
      height: bRect.height,
      rows,
    };
    setGeo((prev) => (sameGeometry(prev, next) ? prev : next));
  }, [container, tbody]);

  // Measure after every paint the rows could have changed in, then keep
  // watching: a row that grows, a row struck, the window scrolling new rows
  // in. Observing the rows themselves catches a height change two rows share
  // in opposite directions, which the body's own size would hide.
  useLayoutEffect(() => {
    const tb = tbody.current;
    if (!container || !tb) return;
    // The first measure is synchronous: a frame never comes to a hidden tab,
    // and a sheet opened in the background must have its ink placed by the
    // time the tab is shown. Later ones wait for a frame so a burst of
    // observer callbacks costs one layout read.
    measure();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const ro = new ResizeObserver(schedule);
    ro.observe(tb);
    const watchRows = () => {
      ro.disconnect();
      ro.observe(tb);
      tb.querySelectorAll("tr[data-rowid]").forEach((tr) => ro.observe(tr));
    };
    watchRows();
    // Rows arriving or moving are measured at once rather than on the next
    // frame: the doc often syncs into a tab that is not yet visible, and
    // frames do not come to those.
    const mo = new MutationObserver(() => {
      watchRows();
      measure();
    });
    mo.observe(tb, { childList: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [container, tbody, measure]);

  useEffect(() => {
    if (mode === "off" || hidden) {
      active.current = null;
      setLive(null);
    }
  }, [mode, hidden]);

  const locate = (e: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const row = geoRef.current.rows.find((b) => y >= b.top && y < b.top + b.h);
    return row ? { row, x, y } : null;
  };

  const inRow = (row: RowBox, x: number, y: number): [number, number] => [(x - row.left) / row.w, y - row.top];

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (mode === "off" || hidden || e.pointerType === "touch") return;
    const hit = locate(e);
    if (!hit) return;
    e.preventDefault();
    const [xf, yp] = inRow(hit.row, hit.x, hit.y);
    if (mode === "eraser") {
      onErase(hit.row.id, xf, yp, hit.row.w);
      active.current = { row: hit.row, pointerId: e.pointerId, p: [] };
      return;
    }
    active.current = { row: hit.row, pointerId: e.pointerId, p: [xf, yp] };
    setLive({ rowId: hit.row.id, stroke: { c: colour, p: [xf, yp] } });
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a synthetic pointer has nothing to capture */
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const a = active.current;
    if (!a || a.pointerId !== e.pointerId) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const samples: { clientX: number; clientY: number }[] =
      typeof e.nativeEvent.getCoalescedEvents === "function" && e.nativeEvent.getCoalescedEvents().length
        ? e.nativeEvent.getCoalescedEvents()
        : [e];
    if (mode === "eraser") {
      for (const s of samples) {
        const x = s.clientX - rect.left;
        const y = s.clientY - rect.top;
        const row = geoRef.current.rows.find((b) => y >= b.top && y < b.top + b.h);
        if (!row) continue;
        const [xf, yp] = inRow(row, x, y);
        onErase(row.id, xf, yp, row.w);
      }
      return;
    }
    for (const s of samples) {
      const [xf, yp] = inRow(a.row, s.clientX - rect.left, s.clientY - rect.top);
      a.p.push(xf, yp);
    }
    setLive({ rowId: a.row.id, stroke: { c: colour, p: a.p.slice() } });
  };

  const finish = (e: ReactPointerEvent<SVGSVGElement>) => {
    const a = active.current;
    if (!a || a.pointerId !== e.pointerId) return;
    active.current = null;
    setLive(null);
    if (mode === "eraser" || a.p.length < 2) return;
    onStroke(a.row.id, { c: colour, p: simplify(a.p, a.row.w) });
  };

  if (!container || geo.width === 0) return null;
  return (
    <svg
      ref={svgRef}
      className={`ink-layer ${mode === "off" || hidden ? "ink-off" : `ink-${mode}`}${hidden ? " ink-hidden" : ""}`}
      style={{ left: geo.left, top: geo.top, width: geo.width, height: geo.height }}
      width={geo.width}
      height={geo.height}
      aria-hidden="true"
      data-ink-mode={hidden ? "hidden" : mode}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      {!hidden && geo.rows.map((b) => {
        const strokes = doc[b.id];
        const drawing = live && live.rowId === b.id ? live.stroke : null;
        if (!strokes?.length && !drawing) return null;
        return (
          <g key={b.id} transform={`translate(${b.left} ${b.top})`} data-ink-row={b.id}>
            {strokes?.map((s, i) => (
              <path key={i} className={`ink-${s.c}`} d={pathFor(s, b.w)} strokeWidth={INK_WIDTH[s.c]} />
            ))}
            {drawing && <path className={`ink-${drawing.c} ink-live`} d={pathFor(drawing, b.w)} strokeWidth={INK_WIDTH[drawing.c]} />}
          </g>
        );
      })}
    </svg>
  );
}

function sameGeometry(a: Geometry, b: Geometry): boolean {
  if (a.left !== b.left || a.top !== b.top || a.width !== b.width || a.height !== b.height || a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) {
    const x = a.rows[i]!;
    const y = b.rows[i]!;
    if (x.id !== y.id || x.top !== y.top || x.left !== y.left || x.w !== y.w || x.h !== y.h) return false;
  }
  return true;
}
