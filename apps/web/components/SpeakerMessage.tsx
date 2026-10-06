"use client";

import { useEffect, useRef, useState } from "react";
import type { SpeakerMessage } from "@opencall/protocol";

/** One-tap messages a showcaller sends most. */
export const QUICK = ["Wrap up", "30 seconds", "Stretch 2 minutes", "Stand by", "Slow down", "Speed up"];

/**
 * The message, large, across the top of a stage screen (timer, prompter).
 *
 * It pulses when it arrives — the person on stage is looking at their words or
 * the room, not waiting for a banner — then holds still until the caller
 * clears it. Nothing on the screen below moves to make room: it overlays.
 */
export function SpeakerBanner({ message }: { message: SpeakerMessage | null }) {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!message) return;
    setFresh(true);
    const t = window.setTimeout(() => setFresh(false), 3000);
    return () => window.clearTimeout(t);
  }, [message?.atMs]);
  if (!message) return null;
  return (
    <div className={`speaker-banner ${fresh ? "fresh" : ""}`} role="alert" aria-live="assertive">
      {message.text}
    </div>
  );
}

/**
 * The showcaller's side: send a message to the stage screens, or clear it.
 * Shows what is on the screens now, so a message is never left up by
 * accident.
 */
export function SpeakerControl({
  message,
  onSay,
  openSignal = 0,
}: {
  message: SpeakerMessage | null;
  onSay: (text: string | null) => void;
  /** Bumped to open the message box from elsewhere (the row menu's "Type a message…"). */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const [text, setText] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", off, true);
    return () => document.removeEventListener("pointerdown", off, true);
  }, [open]);
  const send = (t: string) => {
    const v = t.trim().slice(0, 120);
    if (!v) return;
    onSay(v);
    setText("");
    setOpen(false);
  };
  return (
    <div className="speaker-control" ref={box}>
      {message ? (
        <span className="speaker-live" data-tip={`On the stage screens since ${new Date(message.atMs).toLocaleTimeString()}`}>
          <span className="speaker-live-label">On stage:</span> {message.text}
          <button type="button" className="btn btn-sm" onClick={() => onSay(null)}>
            Clear
          </button>
        </span>
      ) : (
        <button type="button" className="btn btn-sm" onClick={() => setOpen((v) => !v)} data-tip="Show a short message in big letters on the presenter's timer and prompter screens">
          Message stage
        </button>
      )}
      {open && (
        <div className="popover speaker-pop" data-popover>
          <div className="speaker-quick">
            {QUICK.map((q) => (
              <button key={q} type="button" className="btn btn-sm" onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            style={{ display: "flex", gap: 6 }}
          >
            <input className="input" style={{ flex: 1 }} maxLength={120} placeholder="Or type a message…" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
