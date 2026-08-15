"use client";

import { useEffect, useState } from "react";

/**
 * Is this a phone-width screen?
 *
 * Matches the breakpoint the stylesheet uses, so a control cannot be hidden by
 * CSS while its behaviour still belongs to the wide layout — which is how the
 * back arrow came to sit underneath the menu button.
 *
 * Starts false and corrects on mount: the server has no window, and guessing
 * would render one layout and then swap it.
 */
function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

export function useIsPhone(): boolean {
  return useMedia("(max-width: 760px)");
}

/**
 * Narrow enough that the header cannot afford ornament — phones AND tablets.
 *
 * A separate, wider breakpoint from `useIsPhone` on purpose: dropping the back
 * arrow and letting the sheet's name carry the way back is right on a tablet,
 * while the phone's other simplifications (no Cue button, no row popover) are
 * not. One breakpoint for both would have traded one cramped screen for
 * another.
 */
export function useIsNarrow(): boolean {
  return useMedia("(max-width: 1024px)");
}
