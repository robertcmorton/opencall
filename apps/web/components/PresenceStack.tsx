"use client";

import { useEffect, useRef, useState } from "react";
import type { PresencePerson, Role } from "@opencall/protocol";
import { colorFor, initialsOf } from "../lib/usePresence";

/**
 * Who is on this sheet, as faces at the top right (20 Oct, Robert: "identical
 * to the way Google Docs does it").
 *
 * A photo when the person has an account and uploaded one, coloured initials
 * otherwise — crew on a view-only link by the name they typed at "Who's
 * watching?". Up to four overlap, then "+N". Pointing at one says who and
 * where; pressing the stack lists everyone. This screen leaves itself out, as
 * Google does: you know you are here.
 */

const ROLE_WORD: Record<Role, string> = {
  admin: "Administrator",
  caller: "Showcaller",
  editor: "Producer",
  follower: "Crew",
  guest: "Guest",
};

function Face({ person, photoBase, size }: { person: PresencePerson; photoBase: string; size: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size, background: colorFor(person.name), fontSize: Math.round(size * 0.38) };
  return (
    <span className="pf-face" style={style} aria-hidden="true">
      {person.photo && !broken ? <img src={`${photoBase}${person.photo}`} alt="" onError={() => setBroken(true)} /> : initialsOf(person.name)}
    </span>
  );
}

export function PresenceStack({
  people,
  me,
  photoBase,
  whereOf,
  max = 4,
}: {
  people: PresencePerson[];
  me: string | null;
  photoBase: string;
  /** "on row 12" — from the sheet's own cursors, for people editing it. */
  whereOf?: (name: string) => string | null;
  max?: number;
}) {
  // Not you — on this screen or any other of yours (you on a laptop and a
  // phone is one person, with both screens' ids).
  const others = people.filter((p) => p.id !== me && !(me && p.ids?.includes(me)));
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  if (others.length === 0) return null;
  const describe = (p: PresencePerson) => {
    const where = whereOf?.(p.name);
    return [p.name, ROLE_WORD[p.role], p.screens > 1 ? `${p.screens} screens` : null, where].filter(Boolean).join(" · ");
  };
  const shown = others.slice(0, others.length > max ? max - 1 : max);
  const extra = others.length - shown.length;
  return (
    <div className="presence-stack" ref={box}>
      <button
        ref={button}
        type="button"
        className="pf-faces"
        aria-expanded={open}
        aria-label={`Also on this sheet: ${others.map((p) => p.name).join(", ")}. Show everyone.`}
        onClick={() => setOpen((v) => !v)}
      >
        {shown.map((p) => (
          <span key={p.id} className="pf-slot" data-tip={describe(p)}>
            <Face person={p} photoBase={photoBase} size={30} />
          </span>
        ))}
        {extra > 0 && (
          <span className="pf-slot" data-tip={others.slice(shown.length).map((p) => p.name).join(", ")}>
            <span className="pf-face pf-more" style={{ width: 30, height: 30 }}>
              +{extra}
            </span>
          </span>
        )}
      </button>
      {open && (
        <div className="popover pf-list" role="dialog" aria-label="Who is on this sheet" data-popover>
          <strong className="pf-head">
            On this sheet now · {others.length + 1} {others.length === 0 ? "person" : "people"}
          </strong>
          <ul>
            {others.map((p) => (
              <li key={p.id}>
                <Face person={p} photoBase={photoBase} size={32} />
                <span className="pf-who">
                  <span className="pf-name">{p.name}</span>
                  <span className="pf-what">{describe(p).split(" · ").slice(1).join(" · ")}</span>
                </span>
              </li>
            ))}
            <li className="pf-you">
              <span className="pf-face pf-you-face" style={{ width: 32, height: 32 }} aria-hidden="true">
                You
              </span>
              <span className="pf-who">
                <span className="pf-name">You</span>
                <span className="pf-what">This screen</span>
              </span>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
