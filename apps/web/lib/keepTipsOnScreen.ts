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
/** How far above (or below) the thing being described the bubble sits. */
const OFFSET = 8;

function place(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const after = getComputedStyle(el, "::after");
  const width = parseFloat(after.width);
  const height = parseFloat(after.height);
  if (!Number.isFinite(width) || width <= 0) return;

  // Centred on the element, then pulled back inside the viewport. The nudge is
  // the exact overflow, so a tooltip with room to spare stays centred on the
  // thing it describes rather than drifting for no reason.
  const centre = rect.left + rect.width / 2;
  const left = Math.min(Math.max(MARGIN, centre - width / 2), window.innerWidth - width - MARGIN);

  // Above by default; below when there is no room, which is most of the top
  // bar — its own controls would otherwise explain themselves off the screen.
  const roomAbove = rect.top - OFFSET;
  const top = roomAbove >= height ? rect.top - height - OFFSET : rect.bottom + OFFSET;

  el.style.setProperty("--tip-left", `${Math.round(left)}px`);
  el.style.setProperty("--tip-top", `${Math.round(top)}px`);
}

export function keepTipsOnScreen(): () => void {
  const onOver = (e: Event) => {
    const target = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
    if (target instanceof HTMLElement) place(target);
  };
  // Capture: some tooltip carriers stop bubbling for their own reasons.
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("focusin", onOver, true);
  // A fixed bubble is placed in viewport coordinates, so it has to be replaced
  // when the page moves under it — otherwise it hangs where the button WAS.
  const onMove = () => {
    const hovered = document.querySelector("[data-tip]:hover");
    if (hovered instanceof HTMLElement) place(hovered);
  };
  window.addEventListener("scroll", onMove, true);
  window.addEventListener("resize", onMove);
  return () => {
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("focusin", onOver, true);
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
  };
}
