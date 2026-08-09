/**
 * Keeps a tooltip on the screen.
 *
 * The bubbles are CSS pseudo-elements centred on whatever they describe, which
 * is right until the thing being described is near an edge — then half the
 * sentence is off the side of the screen, and the controls most likely to need
 * explaining are the ones in the corners. CSS cannot see the edge; this can.
 *
 * One delegated listener for the whole app rather than a wrapper round every
 * tooltip: `data-tip` is used on buttons, table cells, chips and rows, and
 * anything per-component would have been missed somewhere.
 *
 * The bubble's real width is readable through getComputedStyle on the
 * pseudo-element, so the nudge is exactly the overflow — no guessing at a
 * worst case and pushing short tooltips off-centre for no reason.
 */
const MARGIN = 8;

function place(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const after = getComputedStyle(el, "::after");
  const width = parseFloat(after.width);
  const height = parseFloat(after.height);
  if (!Number.isFinite(width) || width <= 0) return;

  // Horizontal: the bubble is centred on the element, so it runs from
  // centre − half to centre + half. Shift it back by however much of that
  // falls outside the viewport.
  const centre = rect.left + rect.width / 2;
  const half = width / 2;
  const overRight = centre + half - (window.innerWidth - MARGIN);
  const overLeft = MARGIN - (centre - half);
  const shift = overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0;
  el.style.setProperty("--tip-shift", `${Math.round(shift)}px`);

  // Vertical: above by default, below when there is no room above — the top
  // bar's own controls would otherwise explain themselves off the top.
  const roomAbove = rect.top;
  el.classList.toggle("tip-below", Number.isFinite(height) && roomAbove < height + 16);
}

export function keepTipsOnScreen(): () => void {
  const onOver = (e: Event) => {
    const target = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
    if (target instanceof HTMLElement) place(target);
  };
  // Capture: some tooltip carriers stop bubbling for their own reasons.
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("focusin", onOver, true);
  return () => {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("focusin", onOver, true);
  };
}
