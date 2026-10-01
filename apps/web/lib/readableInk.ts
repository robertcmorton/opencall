/**
 * Text colours that stay readable on a light background.
 *
 * The role palette (and anything a person picks for a role) is tuned for the
 * dark sheet: bright yellows, cyans and greens. On a white page the same
 * colour as text measured 1.4–2.4:1 against its own tinted chip — WCAG AA asks
 * for 4.5. So in the light theme each colour is darkened, toward black in its
 * own hue, just far enough to reach the target on the background it will sit
 * on. Darkened only as far as needed: a colour that is already readable keeps
 * its look, and the darkest blue is not turned to mud to match the yellow.
 */

type Rgb = [number, number, number];

const parse = (hex: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const channel = (v: number): number => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
export const luminance = ([r, g, b]: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrast = (a: Rgb, b: Rgb): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** `top` at `alpha` laid over an opaque `under`. */
export const blend = (top: Rgb, alpha: number, under: Rgb): Rgb =>
  [0, 1, 2].map((i) => top[i]! * alpha + under[i]! * (1 - alpha)) as Rgb;

/** The tint behind a role chip in the light theme: the colour at 14% over white. */
export const LIGHT_CHIP_ALPHA = 0.14;
/** A little over AA's 4.5, so rounding and row tints never tip it under. */
const TARGET = 4.8;

const cache = new Map<string, string>();

/**
 * The light-theme surfaces a role chip can sit on: the page, the sunken grey,
 * and the blue tint of the live row. A chip has to read on all of them.
 */
const LIGHT_PAGES: Rgb[] = [
  [255, 255, 255],
  [245, 246, 248],
  [234, 242, 255],
];

/**
 * `hex` darkened just enough to read at TARGET contrast on its own light
 * chip (the colour at LIGHT_CHIP_ALPHA over each surface in LIGHT_PAGES),
 * judged against the worst of them. Returns the input unchanged when it is
 * not a #rrggbb colour.
 */
export function readableInk(hex: string): string {
  const hit = cache.get(hex);
  if (hit) return hit;
  const c = parse(hex);
  if (!c) return hex;
  const chips = LIGHT_PAGES.map((p) => blend(c, LIGHT_CHIP_ALPHA, p));
  const worst = (ink: Rgb) => Math.min(...chips.map((bg) => contrast(ink, bg)));
  let out = c;
  // Mix toward black in small steps; 40 steps of 2.5% reaches black.
  for (let k = 0; k <= 40 && worst(out) < TARGET; k++) out = blend([0, 0, 0], k * 0.025, c);
  const result = toHex(out);
  cache.set(hex, result);
  return result;
}
