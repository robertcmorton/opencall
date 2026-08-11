"use client";

import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

/**
 * The way out of a companion screen.
 *
 * These used to open in a tab of their own, so closing the tab WAS the way
 * back and none of them needed a door. They open in place now, which means
 * every one of them needs one — a prompter with no exit is a screen you have
 * to know a URL to leave.
 *
 * Browser history when there is any, because that returns you to the sheet you
 * came from. The dashboard when there is not: a link opened cold — a phone
 * handed to a crew member, a bookmark, a pasted URL — has nothing behind it,
 * and `router.back()` on an empty history does nothing at all.
 */
export function BackLink({
  label = "Back",
  style,
  className = "btn btn-sm",
}: {
  label?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={className}
      style={style}
      data-tip="Back to where you came from"
      onClick={() => {
        if (typeof window !== "undefined" && window.history.length > 1) router.back();
        else router.push("/admin");
      }}
    >
      ← {label}
    </button>
  );
}
