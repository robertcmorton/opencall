"use client";

import Link from "next/link";
import { useLayoutEffect, useRef } from "react";
import { Icon } from "./ui";

/**
 * The crew's tab bar on a phone: Sheet · Timer · Notes (6 Oct).
 *
 * Crew moved between the sheet and the timer through separate links, so the
 * timer — the thing most of them want most of the time — was a menu away. A
 * bar along the bottom, where a thumb rests, is how phone apps do it.
 *
 * Notes are for signed-in crew; somebody on a view-only link cannot read
 * them, so their third tab is Help instead. The bar publishes its height as
 * --tabbar-h, and every other bar pinned to the bottom (the role bar, the
 * docks) sits on top of it rather than under it.
 */
export function CrewTabBar({
  rundownId,
  joinCode,
  current,
  onNotes,
  notesCount = 0,
}: {
  rundownId: string;
  joinCode?: string;
  current: "sheet" | "timer";
  /** On the sheet page: open the notes panel in place rather than navigating. */
  onNotes?: () => void;
  notesCount?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!el) return;
    const set = () => root.style.setProperty("--tabbar-h", `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--tabbar-h");
    };
  }, []);

  const q = joinCode ? `?code=${encodeURIComponent(joinCode)}` : "";
  const sheetHref = joinCode ? `/view/${rundownId}${q}` : `/show/${rundownId}`;
  const notesReadable = !joinCode;

  return (
    <nav ref={ref} className="crew-tabbar no-print" aria-label="Switch view">
      <Link href={sheetHref} className={`crew-tab ${current === "sheet" ? "is-current" : ""}`} aria-current={current === "sheet" ? "page" : undefined}>
        {Icon.sheet}
        <span>Sheet</span>
      </Link>
      <Link href={`/timer/${rundownId}${q}`} className={`crew-tab ${current === "timer" ? "is-current" : ""}`} aria-current={current === "timer" ? "page" : undefined}>
        {Icon.clock}
        <span>Timer</span>
      </Link>
      {notesReadable ? (
        onNotes ? (
          <button type="button" className="crew-tab" onClick={onNotes}>
            {Icon.note}
            <span>Notes{notesCount > 0 ? ` (${notesCount})` : ""}</span>
          </button>
        ) : (
          <Link href={`${sheetHref}#notes`} className="crew-tab">
            {Icon.note}
            <span>Notes</span>
          </Link>
        )
      ) : (
        <Link href="/help" className="crew-tab">
          {Icon.help}
          <span>Help</span>
        </Link>
      )}
    </nav>
  );
}
