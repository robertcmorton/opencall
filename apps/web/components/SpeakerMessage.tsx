"use client";

import { useEffect, useRef, useState } from "react";
import { forCrew, forStage, type MessageTo, type SpeakerMessage } from "@opencall/protocol";

/**
 * The messages this screen sent last, newest first — the one-tap buttons
 * (21 Oct, Robert: the fixed six "need changing or removing"; he chose his
 * own recent words over any list). Per browser, like any convenience: it
 * learns what this showcaller actually says.
 */
const RECENT_KEY = "oc:recentmessages";
const RECENT_MAX = 5;
const readRecent = (): string[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
};
const remember = (text: string): string[] => {
  const next = [text, ...readRecent().filter((t) => t.toLowerCase() !== text.toLowerCase())].slice(0, RECENT_MAX);
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private window: the list just isn't kept */
  }
  return next;
};
const TO_KEY = "oc:messageto";

/** Who a message is for, in the words the box uses. */
export const TO_LABEL: Record<MessageTo, string> = { stage: "Stage", crew: "Crew", all: "Everyone" };
const TO_TIP: Record<MessageTo, string> = {
  stage: "The presenter's timer and prompter",
  crew: "A banner on everyone's sheet",
  all: "Stage screens and everyone's sheet",
};

/**
 * The message, large, across the top of a stage screen (timer, prompter).
 *
 * It pulses when it arrives — the person on stage is looking at their words or
 * the room, not waiting for a banner — then holds still until the caller
 * clears it. Nothing on the screen below moves to make room: it overlays.
 */
export function SpeakerBanner({ message: any, everyone = false }: { message: SpeakerMessage | null; everyone?: boolean }) {
  // A message for the crew only is not for the person on stage — but the
  // backstage wall display (`everyone`) is read by both.
  const message = everyone || forStage(any) ? any : null;
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
 * A message for the crew, across the top of their sheet (21 Oct). Pulses when
 * it arrives, then stays until the showcaller takes it down — or until this
 * person closes it on their own screen, which closes it for them only.
 */
export function CrewMessage({ message }: { message: SpeakerMessage | null }) {
  const [closed, setClosed] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!forCrew(message)) return;
    setFresh(true);
    const t = window.setTimeout(() => setFresh(false), 3000);
    return () => window.clearTimeout(t);
  }, [message?.atMs]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!message || !forCrew(message) || closed === message.atMs) return null;
  return (
    <div className={`crew-message no-print ${fresh ? "fresh" : ""}`} role="alert" aria-live="assertive">
      <span className="crew-message-from">From {message.from}</span>
      <strong className="crew-message-text">{message.text}</strong>
      <button type="button" className="btn btn-sm btn-ghost" aria-label="Close this message on my screen" data-tip="Close it on your screen — it stays up for everyone else" onClick={() => setClosed(message.atMs)}>
        ✕
      </button>
    </div>
  );
}

/**
 * The showcaller's side: send a message, or take it down (21 Oct: one
 * "Message" button; who it is for is chosen in the box — the stage, the crew
 * or everyone).
 *
 * The button keeps ONE width whether or not a message is up. It used to turn
 * into "On stage: Stretch 2 minutes · Clear", which widened the box it sits in
 * and pushed the show controls onto a second line (measured 438×40 → 530×80).
 * Now it shows a dot and as much of the message as fits; the box carries the
 * whole message, who it went to, and Take down.
 */
export function SpeakerControl({
  message,
  onSay,
  openSignal = 0,
}: {
  message: SpeakerMessage | null;
  onSay: (text: string | null, to?: MessageTo) => void;
  /** Bumped to open the message box from elsewhere (the row menu's "Message…"). */
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const [text, setText] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const [to, setTo] = useState<MessageTo>("stage");
  // Read after mount: browser storage, so the server render and the first
  // client render agree.
  useEffect(() => {
    setRecent(readRecent());
    try {
      const v = window.localStorage.getItem(TO_KEY);
      if (v === "stage" || v === "crew" || v === "all") setTo(v);
    } catch {
      /* keep Stage */
    }
  }, []);
  const chooseTo = (v: MessageTo) => {
    setTo(v);
    try {
      window.localStorage.setItem(TO_KEY, v);
    } catch {
      /* not kept */
    }
  };
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  // Closes on a press anywhere else, and on Escape (6 Oct: it had no key, so
  // a keyboard user — or a stray open on a phone, where it covers Stop — had
  // to find somewhere else to tap). Escape hands focus back to the button.
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);
  const send = (t: string) => {
    const v = t.trim().slice(0, 120);
    if (!v) return;
    onSay(v, to);
    setRecent(remember(v));
    setText("");
    setOpen(false);
  };
  const upTo: MessageTo = message?.to ?? "stage";
  return (
    <div className="speaker-control" ref={box}>
      <button
        ref={toggle}
        type="button"
        className={`btn btn-sm speaker-toggle ${message ? "is-up" : ""}`}
        aria-expanded={open}
        aria-label={message ? `Message up for ${TO_LABEL[upTo].toLowerCase()}: ${message.text}. Open to change or take it down.` : "Message"}
        data-tip={message ? `Up for ${TO_LABEL[upTo].toLowerCase()} since ${new Date(message.atMs).toLocaleTimeString()}: “${message.text}”` : "Big words on the stage screens, a banner on the crew's sheets, or both"}
        onClick={() => setOpen((v) => !v)}
      >
        {message ? (
          <>
            <span className="speaker-dot" aria-hidden />
            <span className="speaker-toggle-text">{message.text}</span>
          </>
        ) : (
          "Message"
        )}
      </button>
      {open && (
        <div className="popover speaker-pop" data-popover>
          {message && (
            <div className="speaker-up">
              <span>
                <span className="speaker-live-label">Up for {TO_LABEL[upTo].toLowerCase()}:</span> {message.text}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  onSay(null);
                  setOpen(false);
                }}
              >
                Take down
              </button>
            </div>
          )}
          <div className="speaker-to" role="radiogroup" aria-label="Who it's for">
            {(["stage", "crew", "all"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={to === v} className={`btn btn-sm ${to === v ? "is-on" : ""}`} data-tip={TO_TIP[v]} onClick={() => chooseTo(v)}>
                {TO_LABEL[v]}
              </button>
            ))}
          </div>
          {recent.length > 0 && (
            <div className="speaker-quick" aria-label="Your recent messages">
              {recent.map((q) => (
                <button key={q} type="button" className="btn btn-sm" onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
            style={{ display: "flex", gap: "var(--space-2)" }}
          >
            <input className="input" style={{ flex: 1 }} maxLength={120} placeholder={recent.length ? "Or type a message…" : "Type a message…"} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
              Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
