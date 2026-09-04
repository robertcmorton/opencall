/**
 * The five row highlights.
 *
 * `stored` is what a row carries in the document — the literal colour the
 * swatches wrote from the day they existed, kept so no sheet needs migrating —
 * and `css` is how it is drawn: a token the light palette re-pitches
 * (globals.css, --hl-*). Read as-is on white, 16% of red is not red, it is
 * nothing; that is what the user saw. A stored value that is none of these
 * five is drawn as itself.
 */
export const ROW_HIGHLIGHTS = [
  { stored: "rgba(229,72,77,0.16)", label: "Red", css: "var(--hl-red)" },
  { stored: "rgba(232,176,60,0.16)", label: "Amber", css: "var(--hl-amber)" },
  { stored: "rgba(63,214,143,0.14)", label: "Green", css: "var(--hl-green)" },
  { stored: "rgba(76,141,255,0.15)", label: "Blue", css: "var(--hl-blue)" },
  { stored: "rgba(167,139,250,0.16)", label: "Purple", css: "var(--hl-purple)" },
] as const;

export const highlightCss = (stored: string): string => ROW_HIGHLIGHTS.find((h) => h.stored === stored)?.css ?? stored;
