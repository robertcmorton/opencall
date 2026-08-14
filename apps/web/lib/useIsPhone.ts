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
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 760px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}
