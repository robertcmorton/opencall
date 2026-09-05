/**
 * Ink — the scribbles a showcaller makes on a printed sheet, kept on the
 * screen instead.
 *
 * Every stroke belongs to ONE row. Its x coordinates are fractions of that
 * row's width and its y coordinates are pixels down from the row's top, so a
 * mark drawn beside a cue stays beside that cue when rows above it grow,
 * shrink, move or are struck. Widening the sheet stretches a mark sideways,
 * which keeps it over the same cell; that is the trade chosen over a mark
 * that stays the right shape but drifts off what it was pointing at.
 *
 * Ink is private: it is one person's marks on their own copy, like a pen on
 * their own printout. Nothing here is shared through the doc.
 */

export type InkColour = "ink" | "red" | "blue" | "marker";
export type InkMode = "off" | "pen" | "eraser";

/** One stroke: a colour and a flat point list x0,y0,x1,y1,… */
export interface Stroke {
  c: InkColour;
  p: number[];
  /**
   * The row's height in px when the stroke was drawn. y is in px from the
   * row's top, which a screen can use as it is; anything that lays the row
   * out at another height — the PDF — scales y by its own row height over
   * this one. Absent on strokes from before it was recorded.
   */
  h?: number;
}

/** Every stroke on a sheet, keyed by the id of the row it was drawn on. */
export type InkDoc = Record<string, Stroke[]>;

export const INK_COLOURS: InkColour[] = ["red", "blue", "ink", "marker"];

/** Stroke width in px on screen. The marker is a wide translucent band. */
export const INK_WIDTH: Record<InkColour, number> = { ink: 2.5, red: 2.5, blue: 2.5, marker: 14 };

/** How close (px) a rub of the eraser has to pass to a stroke to lift it. */
export const INK_ERASE_RADIUS = 10;

/** Ceiling on one sheet's ink as JSON. Generous; a busy show is ~50 KB. */
export const INK_MAX_BYTES = 1_000_000;

const MAX_STROKES_PER_ROW = 500;
const MAX_POINTS_PER_STROKE = 4000;

/** SVG path data for a stroke drawn on a row `rowWidth` px wide. */
export function pathFor(stroke: Stroke, rowWidth: number): string {
  const p = stroke.p;
  if (p.length < 2) return "";
  const x0 = p[0]! * rowWidth;
  const y0 = p[1]!;
  // A tap leaves a dot: a zero-length segment draws nothing, but round caps
  // on a hair of a segment draw a full circle.
  if (p.length === 2) return `M${r(x0)} ${r(y0)}l0.01 0`;
  let d = `M${r(x0)} ${r(y0)}`;
  for (let i = 2; i < p.length; i += 2) d += `L${r(p[i]! * rowWidth)} ${r(p[i + 1]!)}`;
  return d;
}

const r = (n: number) => Math.round(n * 100) / 100;

/**
 * Drop points that sit within `minPx` of the last kept one. A pencil reports
 * far more samples than a line needs, and the first and last always stay.
 */
export function simplify(p: number[], rowWidth: number, minPx = 1.5): number[] {
  if (p.length <= 4) return p.slice();
  const out: number[] = [p[0]!, p[1]!];
  let kx = p[0]! * rowWidth;
  let ky = p[1]!;
  for (let i = 2; i < p.length - 2; i += 2) {
    const x = p[i]! * rowWidth;
    const y = p[i + 1]!;
    if (Math.hypot(x - kx, y - ky) < minPx) continue;
    out.push(p[i]!, p[i + 1]!);
    kx = x;
    ky = y;
  }
  out.push(p[p.length - 2]!, p[p.length - 1]!);
  return out;
}

/**
 * The strokes left after the eraser touches (xFrac, yPx) on a row
 * `rowWidth` px wide. A stroke lifts whole — the way a rubber on a pencil
 * line is used in practice, and far easier to hit than chipping bits off —
 * when any segment of it passes within `radiusPx` of the touch.
 */
export function eraseAt(strokes: Stroke[], xFrac: number, yPx: number, radiusPx: number, rowWidth: number): Stroke[] {
  const x = xFrac * rowWidth;
  const kept = strokes.filter((s) => !touches(s, x, yPx, radiusPx + INK_WIDTH[s.c] / 2, rowWidth));
  return kept.length === strokes.length ? strokes : kept;
}

function touches(s: Stroke, x: number, y: number, radius: number, rowWidth: number): boolean {
  const p = s.p;
  if (p.length === 2) return Math.hypot(p[0]! * rowWidth - x, p[1]! - y) <= radius;
  for (let i = 0; i + 3 < p.length; i += 2) {
    if (segmentDistance(x, y, p[i]! * rowWidth, p[i + 1]!, p[i + 2]! * rowWidth, p[i + 3]!) <= radius) return true;
  }
  return false;
}

/** Distance from (x, y) to the segment (ax, ay)–(bx, by). */
export function segmentDistance(x: number, y: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

export function countStrokes(doc: InkDoc): number {
  let n = 0;
  for (const k in doc) n += doc[k]!.length;
  return n;
}

/** True when `v` is ink the server is willing to keep — shape and size. */
export function isInkDoc(v: unknown): v is InkDoc {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  for (const k in v as Record<string, unknown>) {
    const strokes = (v as Record<string, unknown>)[k];
    if (!Array.isArray(strokes) || strokes.length > MAX_STROKES_PER_ROW) return false;
    for (const s of strokes) {
      if (!s || typeof s !== "object") return false;
      const { c, p, h } = s as { c?: unknown; p?: unknown; h?: unknown };
      if (typeof c !== "string" || !(INK_COLOURS as string[]).includes(c)) return false;
      if (h !== undefined && (typeof h !== "number" || !Number.isFinite(h) || h <= 0)) return false;
      if (!Array.isArray(p) || p.length < 2 || p.length % 2 !== 0 || p.length > MAX_POINTS_PER_STROKE) return false;
      for (const n of p) if (typeof n !== "number" || !Number.isFinite(n)) return false;
    }
  }
  return true;
}
