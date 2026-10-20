/**
 * Which pictures on an imported run sheet are the two team logos (20 Oct).
 *
 * Measured on the run sheets we have: about a dozen of 27 PDFs carry a PAIR
 * of small, roughly square pictures on the first page — the home and away
 * logos — often repeated in the header of each page. Around them sit things
 * that are not logos: a wide sponsor banner on every page, and small icons
 * repeated on every row (fifty of the same 71px square on one sheet). So:
 *
 *  · roughly square (between 1:2 and 2:1) — banners are out;
 *  · placed logo-sized: at least 16 pt, at most a third of the page across;
 *  · drawn at most once per page — row icons are out;
 *  · two of them, side by side on page one, of similar size: the pair whose
 *    tops are closest together, nearest the top of the page, wins.
 *
 * Left is home, right is away — how a fixture is written ("HOME v AWAY"). The
 * import screen shows the pair and lets the person swap or skip, so a wrong
 * guess costs a tap, never a wrong logo nobody saw.
 */

export interface PlacedImage {
  /** The PDF's own name for the picture; the same picture drawn twice has the same id. */
  id: string;
  /** 0-based page. */
  page: number;
  /** Where it is drawn, in page units (y up, from the bottom). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LogoPair {
  home: PlacedImage;
  away: PlacedImage;
}

export function pickTeamLogos(images: readonly PlacedImage[], pageCount: number, pageWidth: number): LogoPair | null {
  const drawn = new Map<string, number>();
  for (const im of images) drawn.set(im.id, (drawn.get(im.id) ?? 0) + 1);
  const candidates = images.filter((im) => {
    if (im.page !== 0) return false;
    const ratio = im.w / im.h;
    if (!(ratio >= 0.5 && ratio <= 2)) return false;
    if (Math.min(im.w, im.h) < 16 || im.w > pageWidth / 3) return false;
    return (drawn.get(im.id) ?? 0) <= Math.max(1, pageCount);
  });
  // One placement per picture on page one (a header can draw it twice).
  const unique = [...new Map(candidates.map((im) => [im.id, im])).values()];
  let best: { pair: LogoPair; score: number } | null = null;
  for (let i = 0; i < unique.length; i++)
    for (let j = i + 1; j < unique.length; j++) {
      const a = unique[i]!;
      const b = unique[j]!;
      const sizeRatio = Math.max(a.h, b.h) / Math.min(a.h, b.h);
      if (sizeRatio > 1.6) continue;
      const topA = a.y + a.h;
      const topB = b.y + b.h;
      // Side by side: their vertical spans overlap.
      if (Math.min(topA, topB) < Math.max(a.y, b.y)) continue;
      const left = a.x <= b.x ? a : b;
      const right = left === a ? b : a;
      if (right.x < left.x + left.w * 0.5) continue; // stacked on each other, not beside
      // Closer tops and nearer the top of the page score better.
      const score = Math.abs(topA - topB) - Math.max(topA, topB) * 0.01;
      if (!best || score < best.score) best = { pair: { home: left, away: right }, score };
    }
  return best?.pair ?? null;
}
