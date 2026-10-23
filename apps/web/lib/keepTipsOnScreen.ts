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

/**
 * Wider than this, a tip follows the POINTER rather than the thing it
 * describes (21 Oct, Robert: "mouse over text info in the wrong place"). A
 * sheet row carries a tip ("Runs at the same time as …"), and a row is the
 * width of the screen and can be a dozen lines tall: centred above the whole
 * row, the bubble appeared far from the mouse — on a live show, up by the cue
 * timer — explaining something the eye was nowhere near.
 */
const FOLLOW_POINTER_PX = 480;
/**
 * Where a tip that follows the pointer goes: below it and a little to the
 * right, clear of the arrow — where the system's own tips go (23 Oct, Robert:
 * "tool tip too close to mouse pointer, when adjusting in box, cant see").
 * It used to sit 14px ABOVE the pointer, centred on it, which is exactly where
 * the words being pointed at are: hovering a time to change it put the row's
 * tip over the time.
 */
const POINTER_GAP_X = 12;
const POINTER_GAP_Y = 24;
let pointer: { x: number; y: number } | null = null;

function place(el: HTMLElement): void {
  const rect = el.getBoundingClientRect();
  const after = getComputedStyle(el, "::after");
  const width = parseFloat(after.width);
  const height = parseFloat(after.height);
  if (!Number.isFinite(width) || width <= 0) return;

  // Big things — rows — are described where the pointer is; everything else
  // from its own box.
  const atPointer = pointer != null && (el.tagName === "TR" || rect.width > FOLLOW_POINTER_PX);
  if (atPointer) {
    const { x, y } = pointer!;
    const left = Math.min(Math.max(MARGIN, x + POINTER_GAP_X), window.innerWidth - width - MARGIN);
    // Above only when there is no room below — the bottom of the screen.
    const below = y + POINTER_GAP_Y;
    const top = below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, y - OFFSET - height);
    el.style.setProperty("--tip-left", `${Math.round(left)}px`);
    el.style.setProperty("--tip-top", `${Math.round(top)}px`);
    return;
  }
  const box = rect;

  // Centred on the element, then pulled back inside the viewport. The nudge is
  // the exact overflow, so a tooltip with room to spare stays centred on the
  // thing it describes rather than drifting for no reason.
  const centre = box.left + box.width / 2;
  const left = Math.min(Math.max(MARGIN, centre - width / 2), window.innerWidth - width - MARGIN);

  // Above by default; below when there is no room, which is most of the top
  // bar — its own controls would otherwise explain themselves off the screen.
  const roomAbove = box.top - OFFSET;
  const top = roomAbove >= height ? box.top - height - OFFSET : box.bottom + OFFSET;

  el.style.setProperty("--tip-left", `${Math.round(left)}px`);
  el.style.setProperty("--tip-top", `${Math.round(top)}px`);
}

export function keepTipsOnScreen(): () => void {
  const onOver = (e: Event) => {
    if (e instanceof MouseEvent) pointer = { x: e.clientX, y: e.clientY };
    const target = (e.target as HTMLElement | null)?.closest?.("[data-tip]");
    if (target instanceof HTMLElement) place(target);
  };
  // A tip that follows the pointer moves with it — once a frame at most.
  let frame = 0;
  const onPointerMove = (e: MouseEvent) => {
    pointer = { x: e.clientX, y: e.clientY };
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const hovered = document.querySelector("[data-tip]:hover");
      if (hovered instanceof HTMLElement && (hovered.tagName === "TR" || hovered.getBoundingClientRect().width > FOLLOW_POINTER_PX)) place(hovered);
    });
  };
  document.addEventListener("mousemove", onPointerMove, { passive: true });
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
    document.removeEventListener("mousemove", onPointerMove);
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("scroll", onMove, true);
    window.removeEventListener("resize", onMove);
  };
}
