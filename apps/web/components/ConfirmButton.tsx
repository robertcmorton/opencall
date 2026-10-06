"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes } from "react";

/**
 * A button that asks once before doing something that cannot be taken back.
 *
 * The first press turns it into "Press again to …" for three seconds; only a
 * second press in that time acts. Moving on (a press anywhere else, or
 * Escape) disarms it. No pop-up dialog: the question appears on the button
 * itself, where the finger or pointer already is. Added 6 Oct for the five
 * actions that went on one press — deleting an account, clearing the error
 * log, turning off a view-only link, cancelling an invitation and removing a
 * kind of show.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = "",
  ...rest
}: {
  label: string;
  /** What the button says while armed — "Press again to delete". */
  confirmLabel: string;
  onConfirm: () => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick" | "children">) {
  const [armed, setArmed] = useState(false);
  const self = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3000);
    const off = (e: PointerEvent) => {
      if (!self.current?.contains(e.target as Node)) setArmed(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setArmed(false);
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", key);
    };
  }, [armed]);
  return (
    <button
      {...rest}
      ref={self}
      type="button"
      className={`${className} ${armed ? "is-armed" : ""}`}
      aria-live="polite"
      onClick={() => {
        if (!armed) return setArmed(true);
        setArmed(false);
        onConfirm();
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}
