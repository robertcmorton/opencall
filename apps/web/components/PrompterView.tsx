"use client";

import { useEffect, useRef, useState } from "react";
import { projectRundownDoc } from "@opencall/db/doc";
import {
  absoluteNow,
  clockTargetRow,
  computeTiming,
  secondsUntilShow,
  followRead,
  formatDuration,
  formatTimeOfDay,
  formatTimeOfDayWithDay,
  PROMPTER_TAG,
  secondsUntilRow,
  zoneSecondsOfDay,
  clockLinedUp,
} from "@opencall/core";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";
import { rowNumbering } from "../lib/rowNumbering";
import { useLiveTiming } from "../lib/useLiveTiming";
import { BackLink } from "./BackLink";

/**
 * Prompter: the whole run sheet, scrolled through like the sheet itself, with
 * the words to be read set large and everything else kept small around them —
 * the shape of the show a reader is standing in. Carries the countdown to
 * being on camera, the reads either side, auto-scroll (Space to start/stop,
 * arrows for speed), size controls that touch only the script, mirror mode, a
 * read-position caret, and follow-the-caller with a Sync back to it.
 */

/**
 * Where the read position sits, as a fraction of the scrolling area.
 *
 * One number, used by both the caret and the follow-scroll. They are the same
 * claim about the screen, and two copies of it drift the moment anything above
 * the script changes height.
 */
const CARET_AT = 0.3;

export function PrompterView({ rundownId, joinCode }: { rundownId: string; joinCode?: string }) {
  useWakeLock();
  const { doc, synced } = useRundownDoc(rundownId);
  const { columns, rows, meta } = projectRundownDoc(doc);
  /** One rule for what a row is called — see `rowNumbering`. */
  const numberOf = rowNumbering(rows);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const show = channel.show;

  // Prompter-sized, not document-sized. 42px was a big paragraph on a web
  // page; this is meant to be read off a stand at arm's length or further, and
  // the A−/A+ controls are there for the room you are actually in.
  const [fontSize, setFontSize] = useState(84);
  const [mirror, setMirror] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  // Middle of the slider (10–300), so the first press of play is a usable
  // reading pace and the adjustment goes both ways from there.
  const [speed, setSpeed] = useState(155); // px per second
  // Tracking the show, until the reader scrolls by hand. Same bargain the run
  // sheet strikes: never fight somebody who has taken hold of the script, and
  // give them one button to hand it back.
  const [followScroll, setFollowScroll] = useState(true);
  // Pace the words to the item, rather than to a speed somebody guessed.
  // Touching size or speed by hand turns it off — you have said what you want.
  const [autoPace, setAutoPace] = useState(true);
  /**
   * Hold the script back until it is worth looking at.
   *
   * Opening the prompter used to show a half-built screen: an empty sheet
   * reads as "nothing marked to read yet", which is a claim about the sheet
   * and not about the network, so the first thing a reader saw was a sentence
   * saying their script did not exist. Then the rows landed, the size fitter
   * resized everything, and the follow-scroll jumped it somewhere else.
   *
   * So: settle first, reveal once. It FAILS OPEN on a timer — a screen held
   * blank by a condition that never fired would be far worse than one that
   * appears mid-settle.
   */
  const [ready, setReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<string | null>(null);

  // What to read, in order of how explicit the sheet was:
  //  1. rows marked "prompter" in the sheet's own cue column — set on import
  //     for the passages written to be read aloud, and editable by hand;
  //  2. failing that, a Script column, which some sheets carry outright.
  // The words are the row's own text in case 1 and the Script cell in case 2.
  const scriptKey = columns.find((c) => c.key === "script")?.key ?? "script";
  const tagged = rows.filter((r) => Object.values(r.cells).some((v) => v.trim().toLowerCase() === PROMPTER_TAG));
  const usingTags = tagged.length > 0;
  const cues = usingTags ? tagged : rows.filter((r) => r.type === "cue" && r.cells[scriptKey]?.trim());
  const wordsOf = (r: (typeof rows)[number]): string => (usingTags ? r.title : (r.cells[scriptKey] ?? ""));

  // Every read carries the clock time it is due — the person holding the
  // prompter needs to know how long they have as much as what to say.
  const timing = computeTiming(rows, meta.plannedStartSec);
  const startById = new Map(rows.map((r, i) => [r.id, timing.rows[i]?.startSec ?? null]));
  const use24h = meta.use24h ?? false;

  const wordCount = cues.reduce((n, r) => n + wordsOf(r).split(/\s+/).filter(Boolean).length, 0);
  const estMinutes = Math.max(1, Math.round(wordCount / 150));

  // Live countdowns, recomputed locally from timestamps like every other
  // surface — never from streamed ticks.
  const live = useLiveTiming(channel, timing);

  // Clock-follow, exactly as the run sheet offers it: the SERVER drives the
  // show off the TIME column. "Following clock" says who is driving; "Clock
  // synced" says the show is actually on the row the sheet points at. They are
  // different claims and the second is the one anybody is checking.
  const showLive = show?.state === "running" || show?.state === "paused";
  const clockFollow = show?.clockFollow ?? false;
  /**
   * May this device drive the show at all?
   *
   * The server decides from identity, and it refuses anything below caller. A
   * prompter opened on a crew join code was still being offered the clock and
   * a CUE on every row, and every press came back "caller role required" — a
   * screen full of buttons that cannot work is worse than a screen without
   * them, particularly the one somebody is reading from.
   */
  const mayDrive = channel.role === "caller" || channel.role === "admin";
  const nowAbsSec = absoluteNow(zoneSecondsOfDay(channel.serverNow(), channel.timezone), timing);
  const clockRowId = clockTargetRow(
    rows,
    timing.rows.map((r) => r.startSec),
    nowAbsSec,
  );
  /**
   * How long until the show is due, when it has opened ahead of its first item.
   *
   * A prompter operator is often at the desk long before anything is called,
   * and this screen had nothing to tell them: the status bar said STANDING BY
   * with a dash, which is true and useless. The show page answers this; the
   * screen somebody is actually sitting in front of should too.
   */
  const untilShowSec = secondsUntilShow(
    rows,
    timing.rows.map((r) => r.startSec),
    nowAbsSec,
  );

  // Follow the caller.
  //
  // This screen shows the WHOLE sheet and scrolls through it like the run
  // sheet does, so the caret sits on whatever is happening — not only on the
  // handful of rows there are words for. Showing the reads alone meant the
  // live cue was usually not on the page at all, which is both a screen that
  // never moved and a reader with no idea where the show had got to.
  const rowIndexById = new Map(rows.map((r, i) => [r.id, i]));
  const liveId = show?.state === "running" || show?.state === "paused" ? show.activeRowId : null;
  const liveIndex = liveId != null ? (rowIndexById.get(liveId) ?? -1) : -1;
  // Which READ is on air or coming — still the question the status bar answers,
  // even though the scroll now follows the show itself.
  const { onAirId, followId } = followRead({
    liveIndex,
    reads: cues.map((c) => ({ id: c.id, index: rowIndexById.get(c.id) ?? -1 })),
  });

  /**
   * The scroll follows the SHOW — and, before it starts, the walkthrough.
   *
   * It used to follow only a live cue, so while a showcaller walked the crew
   * through the sheet the prompter sat at the top and the operator had to find
   * every row by hand. The run sheet has followed the walkthrough for a while;
   * the screen somebody actually reads from should too, and it is the same
   * `walkRowId` off the same channel.
   */
  const walkRowId = liveId ? null : (show?.walkRowId ?? null);
  const scrollTargetId = liveId ?? walkRowId;

  /**
   * Which walkthrough row this screen has been shown — see the run sheet, where
   * the rule is written out. In short: scrolling away is not being out of sync,
   * because the highlight is still where you last saw it. It becomes out of
   * sync when the showcaller MOVES while you are reading somewhere else.
   */
  const [seenWalkRowId, setSeenWalkRowId] = useState<string | null>(null);
  useEffect(() => {
    if (followScroll) setSeenWalkRowId(walkRowId);
  }, [followScroll, walkRowId]);
  const walkOutOfSync = !!walkRowId && !liveId && !followScroll && seenWalkRowId !== walkRowId;
  const isRead = (r: (typeof rows)[number]): boolean => cues.some((c) => c.id === r.id);

  // Where the followed read sits among the reads, so the one before and the
  // one after can be named. A reader wants the shape of their own night: what
  // they just said, what they say next, and how long they have.
  const followPos = followId ? cues.findIndex((c) => c.id === followId) : -1;
  const prevRead = (followPos > 0 ? cues[followPos - 1] : null) ?? null;
  const nextRead = (followPos >= 0 ? cues[followPos + 1] : null) ?? null;

  // How long until it is on camera. Measured from where the show ACTUALLY is —
  // what is left of the row on air, then every planned row in between — not
  // from the clock time the sheet plans, which is only ever a plan.
  const secondsUntilOn = secondsUntilRow({
    durationsSec: timing.rows.map((r) => r.effectiveDurationSec),
    liveIndex,
    targetIndex: followId ? (rowIndexById.get(followId) ?? -1) : -1,
    remainingInRowSec: live?.remainingInRowSec ?? null,
  });
  // The same question for the read after, so a reader can see two moves ahead.
  const secondsUntilNext = secondsUntilRow({
    durationsSec: timing.rows.map((r) => r.effectiveDurationSec),
    liveIndex,
    targetIndex: nextRead ? (rowIndexById.get(nextRead.id) ?? -1) : -1,
    remainingInRowSec: live?.remainingInRowSec ?? null,
  });

  useEffect(() => {
    if (!followScroll) return;
    if (!scrollTargetId || scrollTargetId === lastActiveRef.current) return;

    // Getting here is not the same as having moved, and the difference is the
    // whole bug. At first paint the container is not scrollable yet — before
    // the text reflows, every read fits on one screen — so the scroll is a
    // silent no-op. Treating "the element exists" as done meant the right row
    // was marked NEXT and the screen never moved: scrollTop stuck at 0.
    //
    // So: place it by hand, check it took, and re-assert for a few frames
    // until it holds. Only then is it recorded as done.
    // Keep trying until it has ACTUALLY moved. The previous attempt gave up
    // after half a second and then marked the row handled — but the sheet
    // arrives over a websocket and is routinely slower than that, so the
    // retries expired before there was anything to scroll to and nothing ever
    // ran again. Never record this as done on a timer; only on the result.
    let timer: ReturnType<typeof setInterval> | undefined;
    const place = (): boolean => {
      const box = containerRef.current;
      const el = document.getElementById(`prompt-${scrollTargetId}`);
      if (!box || !el || box.clientHeight === 0) return false;
      // Land it on the read-position caret rather than the top edge — that
      // fixed marker is where the reader's eye is.
      const caret = box.clientHeight * CARET_AT;
      const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top - caret;
      if (Math.abs(delta) <= 2) return true;
      box.scrollTop += delta;
      if (Math.abs(el.getBoundingClientRect().top - box.getBoundingClientRect().top - caret) <= 2) return true;
      // A read near the end may not be able to reach the caret. Hitting the
      // bottom of the scroll IS as far as it goes — settled, not failed, or
      // this retries forever.
      return box.scrollTop >= box.scrollHeight - box.clientHeight - 2;
    };

    if (place()) {
      lastActiveRef.current = scrollTargetId;
      setReady(true);
      return;
    }
    timer = setInterval(() => {
      if (!place()) return;
      lastActiveRef.current = scrollTargetId;
      setReady(true);
      if (timer) clearInterval(timer);
    }, 200);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [scrollTargetId, followScroll, rows.length]);

  // A hand on the script wins. Wheel and touch only — not the scroll events
  // our own placement fires, and not the auto-scroll, which IS the reader
  // driving and should never turn following off behind their back.
  useEffect(() => {
    const box = containerRef.current;
    if (!box) return;
    // No guard needed against our own scrolling: `wheel` and `touchmove` are
    // user-input events and are never dispatched by writing scrollTop. A flag
    // here was worse than useless — the pacing loop left it raised, so a hand
    // on the script could not take it off follow and Sync never appeared.
    const letGo = () => setFollowScroll(false);
    box.addEventListener("wheel", letGo, { passive: true });
    box.addEventListener("touchmove", letGo, { passive: true });
    return () => {
      box.removeEventListener("wheel", letGo);
      box.removeEventListener("touchmove", letGo);
    };
  }, []);

  /**
   * Pace the read to the item it belongs to.
   *
   * A prompter set to a fixed speed is a guess: the same slider carries a
   * forty-word welcome and a three-minute address, and one of them runs out
   * of words while the other is still talking. What the reader actually has
   * is a slot — this row's duration — and the words have to land inside it.
   *
   * So the speed is not chosen, it is solved, every frame: the distance still
   * to travel divided by the time still left. That self-corrects for free — a
   * pause, an overrun, a jump — because both halves are re-read from the live
   * clock rather than integrated from a starting guess.
   */
  // Reveal once the sheet is here and has had a moment to settle, and always
  // reveal eventually whatever happens — nothing about a live show should be
  // waiting on a flag of ours.
  useEffect(() => {
    if (!synced || ready) return;
    const t = window.setTimeout(() => setReady(true), 900);
    return () => window.clearTimeout(t);
  }, [synced, ready]);
  // Nothing to place against: no show running means no scroll to wait for.
  useEffect(() => {
    if (synced && !liveId) setReady(true);
  }, [synced, liveId]);

  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => {
    if (!autoPace || !onAirId || !showLive) return;
    let raf = 0;
    let last = performance.now();
    // Sub-pixel movement has to be banked, not written. A slow read is a
    // fraction of a pixel per frame, and `scrollTop += 0.13` reads back
    // rounded — so every frame re-adds the same fraction to the same integer
    // and the script never moves at all. Measured exactly that: 870px to
    // travel over 110s, scrollTop pinned at 85 while the clock ran down.
    let carry = 0;
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const box = containerRef.current;
      const el = document.getElementById(`prompt-${onAirId}`);
      const remain = liveRef.current?.remainingInRowSec ?? null;
      if (box && el && remain != null && remain > 0.5) {
        const room = box.clientHeight * (1 - CARET_AT);
        // How far past the bottom of the screen this read still runs. A read
        // that already fits below the caret needs no movement at all — it is
        // read where it sits, and scrolling would carry it out of view.
        const toGo =
          el.getBoundingClientRect().bottom - box.getBoundingClientRect().top - box.clientHeight * CARET_AT - room;
        if (toGo > 1) {
          carry += (toGo / remain) * dt;
          const px = Math.floor(carry);
          if (px > 0) {
            box.scrollTop += px;
            carry -= px;
          }
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [autoPace, onAirId, showLive]);

  /**
   * Size the read to the slot too.
   *
   * Given a whole item to say forty words in, they should be enormous; given
   * ninety seconds and three hundred words, they have to come down or the
   * screen becomes a blur nobody can read. Height grows roughly with the
   * SQUARE of the font size — fewer characters per line and taller lines —
   * so one proportional step lands close and a second settles it.
   */
  const fontRef = useRef(fontSize);
  fontRef.current = fontSize;
  useEffect(() => {
    if (!autoPace || !onAirId) return;
    let cancelled = false;
    // Settle ONCE per read. Keeping fontSize in the dependencies restarted
    // this on its own output: the pass counter reset every time, it never
    // stopped resizing, and each growth spurt pushed the end of the read
    // further away — so the pacer below was chasing a target it was itself
    // moving, and fell behind instead of converging.
    let pass = 0;
    const fit = () => {
      if (cancelled || pass >= 4) return;
      const box = containerRef.current;
      const words = document.querySelector(`[id="prompt-${onAirId}"] [data-read-body]`) as HTMLElement | null;
      if (!box || !words || box.clientHeight === 0) return;
      // The room a read may occupy: from the caret to the foot of the screen.
      const room = box.clientHeight * (1 - CARET_AT) - 24;
      const have = words.getBoundingClientRect().height;
      if (have <= 0 || room <= 0) return;
      pass++;
      const next = Math.round(Math.max(28, Math.min(160, fontRef.current * Math.sqrt(room / have))));
      if (Math.abs(next - fontRef.current) > 2) {
        setFontSize(next);
        requestAnimationFrame(fit); // measure again once it has painted
      }
    };
    const id = requestAnimationFrame(fit);
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [autoPace, onAirId]);

  // Auto-scroll loop.
  useEffect(() => {
    if (!scrolling) return;
    let raf = 0;
    let last = performance.now();
    let carry = 0;
    const step = (now: number) => {
      const el = containerRef.current;
      if (el) {
        carry += ((now - last) / 1000) * speed;
        const px = Math.floor(carry);
        if (px > 0) {
          el.scrollTop += px;
          carry -= px;
        }
      }
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [scrolling, speed]);

  // Keyboard: Space toggles scroll, arrows adjust speed, +/- font size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        e.preventDefault();
        setScrolling((s) => !s);
      } else if (e.key === "ArrowDown") setSpeed((s) => Math.min(300, s + 10));
      else if (e.key === "ArrowUp") setSpeed((s) => Math.max(10, s - 10));
      else if (e.key === "+" || e.key === "=") setFontSize((f) => Math.min(96, f + 4));
      else if (e.key === "-") setFontSize((f) => Math.max(20, f - 4));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Marked on the page: blue for the read that is ON AIR, and the one coming
  // up called NEXT. They must not look the same — reading the next one early
  // is exactly the mistake this screen exists to prevent.
  const activeId = onAirId;
  const nextId = onAirId ? null : followId;
  // The same rule as the run sheet, from the same place. This screen kept
  // its own — "the live cue is on the clock's row" — which is false for as
  // long as the show waits for its first cue, so the chip sat amber for hours
  // while the sheet's own chip, two tabs over, was green.
  const clockSynced = clockLinedUp({ clockFollow, activeRowId: liveId, clockRowId, untilShowSec });

  // The state of the read being followed, in the words a reader thinks in.
  const onAirNow = onAirId != null;
  // Past an hour a countdown stops being a countdown. "ON IN 6:24:29" is a
  // number nobody reads down; the clock time it lands on is the useful fact,
  // and on a day-long sheet that is most of the day.
  const FAR_OFF_SEC = 3600;
  const farOff = !onAirNow && secondsUntilOn != null && secondsUntilOn > FAR_OFF_SEC;
  const followStartSec = followId ? (startById.get(followId) ?? null) : null;
  const nextStartSec = nextRead ? (startById.get(nextRead.id) ?? null) : null;
  // The wait comes first: before the show is due, "how long have we got" is
  // the only question on this screen, and STAND BY against a dash is not an
  // answer to it.
  const waiting = untilShowSec != null && !onAirNow;
  const cueLabel = waiting
    ? "SHOW STARTS IN"
    : onAirNow
    ? "ON AIR"
    : secondsUntilOn == null
      ? "STANDING BY"
      : secondsUntilOn <= 30
        ? "STAND BY"
        : farOff && followStartSec != null
          ? "ON AT"
          : "ON IN";
  const cueValue = waiting
    ? formatDuration(Math.round(untilShowSec!))
    : onAirNow
    ? live?.remainingInRowSec != null
      ? formatDuration(Math.max(0, Math.round(live.remainingInRowSec)))
      : "—"
    : secondsUntilOn == null
      ? "—"
      : farOff && followStartSec != null
        ? formatTimeOfDayWithDay(followStartSec, use24h)
        : formatDuration(Math.round(secondsUntilOn));
  // Red on air, amber in the last thirty seconds — the same colours the timer
  // and the run sheet use, so they mean one thing across the whole app.
  const cueColour = waiting
    ? "#3fb950"
    : onAirNow
      ? "#f85149"
      : secondsUntilOn != null && secondsUntilOn <= 30
        ? "#d29922"
        : "#3fb950";

  const readTitle = (r: (typeof rows)[number] | null): string => {
    if (!r) return "—";
    const t = wordsOf(r).trim() || r.title;
    return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  };

  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#000" }}>
      {/* What a reader needs without taking their eyes off the words: what
          they just read, how long until they are on, and what follows. Fixed
          at the top because it must never scroll away mid-read. */}
      <div
        className="prompter-status"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "2vw",
          padding: "10px 16px",
          background: "#0d0d0d",
          borderBottom: "1px solid #222",
          fontSize: "0.8rem",
          color: "#8b949e",
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.62rem", letterSpacing: "0.14em", color: "#555" }}>PREVIOUS</div>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6e7681" }}>
            {readTitle(prevRead)}
          </div>
        </div>

        <div style={{ textAlign: "center", flexShrink: 0 }}>
          <div style={{ fontSize: "0.62rem", letterSpacing: "0.14em", color: "#555" }}>{cueLabel}</div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontVariantNumeric: "tabular-nums",
              fontSize: "clamp(1.4rem, 3.4vw, 2.4rem)",
              fontWeight: 700,
              lineHeight: 1.05,
              color: cueColour,
            }}
          >
            {cueValue}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: "0.62rem", letterSpacing: "0.14em", color: "#555" }}>
            NEXT
            {secondsUntilNext == null
              ? ""
              : secondsUntilNext > FAR_OFF_SEC && nextStartSec != null
                ? ` · ${formatTimeOfDayWithDay(nextStartSec, use24h)}`
                : ` · ${formatDuration(Math.round(secondsUntilNext))}`}
          </div>
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#6e7681" }}>
            {readTitle(nextRead)}
          </div>
        </div>
      </div>

      {/* The caret and the follow-scroll have to agree on where "the read
          position" is. The caret used to be fixed to the viewport while the
          scroll measured from the container, which the status bar above would
          now pull apart by its own height. Same box, one percentage, no drift. */}
      {/* clipped: the script does its own scrolling, so nothing overlaid here
          may ever reach the page and raise scrollbars on it. */}
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex", overflow: "hidden" }}>
        {/* Says the sheet is on its way, rather than letting an empty one
            speak for it. */}
        {!ready && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#555",
              fontSize: "1rem",
              letterSpacing: "0.08em",
              pointerEvents: "none",
            }}
          >
            LOADING THE SHEET…
          </div>
        )}
        {/* Top-centre and over the script, exactly where the run sheet puts
            it — the same button in the same place doing the same job, so it
            is found without being looked for. */}
        {(liveId ? !followScroll : walkOutOfSync) && (
          <button
            className={`btn btn-primary sync-cue ${liveId ? "" : "sync-walk"}`}
            // Centred WITHOUT transform. .sync-cue carries `animation:
            // menu-in`, which animates transform to `none` — and a CSS
            // animation beats an inline style, so a translateX(-50%) here was
            // wiped the moment it rendered. The button then sat at left:50%
            // with its whole width hanging off to the right, pushing the page
            // wide enough to raise scrollbars. Auto margins owe nothing to
            // transform, so the animation cannot touch them.
            style={{
              position: "absolute",
              top: 12,
              left: 0,
              right: 0,
              marginInline: "auto",
              width: "fit-content",
              height: "auto",
            }}
            data-tip={
              liveId
                ? "Jump back to the live cue and follow along again"
                : "Jump to the row the showcaller is on and follow along again"
            }
            onClick={() => {
              lastActiveRef.current = null;
              setFollowScroll(true);
            }}
          >
            {liveId ? "⇣ Sync Cue" : "⇣ Follow showcaller"}
          </button>
        )}
        <div
          style={{
            position: "absolute",
            left: 8,
            top: `${CARET_AT * 100}%`,
            width: 0,
            height: 0,
            borderTop: "14px solid transparent",
            borderBottom: "14px solid transparent",
            borderLeft: "20px solid #b91c1c",
            zIndex: 10,
          }}
        />
      <div
        ref={containerRef}
        className="prompter-script"
        style={{
          flex: 1,
          overflowY: "auto",
          // Edge to edge. 8vw of side padding was throwing away a sixth of the
          // screen on a surface whose whole job is fitting words on it; the
          // margin left is only enough to clear the caret.
          padding: "30vh 1rem 60vh 40px",
          transform: mirror ? "scaleX(-1)" : undefined,
          // Sized and placed before it is looked at, then shown in one go.
          opacity: ready ? 1 : 0,
          transition: "opacity 160ms linear",
        }}
      >
        {synced && cues.length === 0 && (
          <div style={{ color: "#777", fontSize: "1.1rem", lineHeight: 1.6, maxWidth: "40ch" }}>
            Nothing marked to read yet. Mark a row <strong style={{ color: "#f2f2f2" }}>{PROMPTER_TAG}</strong> in the
            run sheet&rsquo;s cue column — those words then appear here at full size. The rest of the sheet is listed
            below either way, so the show can still be followed.
          </div>
        )}
        {rows.map((row, i) => {
          const startSec = startById.get(row.id) ?? null;
          const read = isRead(row);
          const words = read ? wordsOf(row) : row.title;
          const isLiveRow = liveId === row.id;
          return (
            <section
              key={row.id}
              id={`prompt-${row.id}`}
              style={{ marginBottom: read ? "1.2em" : "0.35em", opacity: read || isLiveRow ? 1 : 0.55 }}
            >
              <div
                style={{
                  color: isLiveRow ? "#2f81f7" : "#555",
                  fontSize: "0.85rem",
                  letterSpacing: "0.1em",
                  marginBottom: read ? 6 : 2,
                  display: "flex",
                  gap: 12,
                }}
              >
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {startSec != null ? formatTimeOfDay(startSec, use24h) : "—"}
                </span>
                {row.durationSec != null && (
                  <span style={{ color: "#444" }}>
                    {Math.floor(row.durationSec / 60)}:{String(row.durationSec % 60).padStart(2, "0")}
                  </span>
                )}
                <span style={{ color: "#444" }}>{numberOf(i) ? `#${numberOf(i)}` : ""}</span>
                {isLiveRow && <span style={{ color: "#2f81f7", fontWeight: 700 }}>ON AIR</span>}
                {activeId === row.id && !isLiveRow && <span style={{ color: "#2f81f7", fontWeight: 700 }}>ON AIR</span>}
                {nextId === row.id && <span style={{ color: "#d29922", fontWeight: 700 }}>NEXT</span>}
                {/* CUE means the same thing here as on the run sheet: take
                    this row NOW. A button rather than a tappable row, because
                    a stray touch on a page somebody is reading from must never
                    move the show. */}
                {showLive && mayDrive && !isLiveRow && row.type !== "group" && (
                  <button
                    className="prompter-cue"
                    data-tip="Take this row now — the show jumps here"
                    onClick={() => channel.sendCmd("jump", row.id)}
                  >
                    CUE
                  </button>
                )}
              </div>
              {words &&
                (read ? (
                  // The words to say. Only these answer to the size controls —
                  // making the whole sheet this big would bury the script in the
                  // running order it is meant to stand out from.
                  <div data-read-body style={{ fontSize, lineHeight: 1.45, color: "#f2f2f2", fontWeight: 500 }}>
                    {words}
                  </div>
                ) : (
                  // Everything else is the shape of the show around the script:
                  // there to be glanced at, never read aloud.
                  <div style={{ fontSize: "1.05rem", lineHeight: 1.35, color: "#8b949e", fontWeight: 400 }}>
                    {words}
                  </div>
                ))}
            </section>
          );
        })}
      </div>
      </div>

      <footer
        style={{
          display: "flex",
          /**
           * WRAPS, because a prompter is read off a phone as often as a rack
           * screen and this row does not fit one.
           *
           * Measured at 375px: the row laid out 542px wide, so the document
           * scrolled sideways by 167px and "mirror" and "auto pace" — two of
           * the prompter's four controls — sat off the right-hand edge. A
           * reader would have had to scroll the page sideways to reach them,
           * on the one screen whose entire job is to be read without looking
           * away. That is also the black bar down the right-hand side: the
           * page was genuinely wider than the phone.
           *
           * Nothing here has a reason to be on one line. Wrapping costs a
           * second row on a narrow screen and nothing at all on a wide one.
           */
          flexWrap: "wrap",
          gap: 14,
          rowGap: 8,
          alignItems: "center",
          padding: "8px 14px",
          background: "#0d0d0d",
          borderTop: "1px solid #222",
          fontSize: "0.78rem",
          color: "#9a9a9a",
        }}
      >
        {/* First in the bar, because leaving is the one thing you could not
            do from this screen at all. */}
        <BackLink />
        {/* The same offer the run sheet makes: you scrolled away, here is the
            way back to the show. Only shown when it would do something. */}
        {/* Sync to clock — the same control the run sheet carries, driving the
            same server command. Same three labels for the same three states. */}
        {showLive && mayDrive && (
          <button
            className={`btn btn-sm ${clockFollow ? "is-on" : ""}`}
            style={
              clockSynced
                ? { borderColor: "var(--under)", color: "var(--under)", background: "var(--under-soft)" }
                : clockFollow
                  ? { borderColor: "var(--warn)", color: "var(--warn)", background: "var(--warn-soft)" }
                  : undefined
            }
            data-tip={
              clockSynced
                ? "The server is running the show off the TIME column, and the live cue is on the row the sheet says should be on air. Press to take the clock off."
                : clockFollow
                  ? "The server is running the show off the TIME column, but the live cue is not on the row the sheet points at yet — it lines up at the next item. Press to take the clock off."
                  : "Hand the show to the SERVER: every item starts at its scheduled moment, even with every console closed."
            }
            onClick={() => channel.sendCmd(clockFollow ? "clock_off" : "clock_on")}
          >
            ◷ {!channel.connected && clockFollow ? "Reconnecting…" : clockSynced ? "Clock synced" : clockFollow ? "Following clock" : "Follow clock"}
          </button>
        )}
        {/* No play/pause: the show starts the words. Space still toggles a
            hand-driven scroll for a rehearsal with nothing running. */}
        <label>
          speed{" "}
          <input
            type="range"
            min={10}
            max={300}
            value={speed}
            onChange={(e) => {
              setAutoPace(false);
              setSpeed(Number(e.target.value));
            }}
          />
        </label>
        <button className="btn btn-sm" onClick={() => { setAutoPace(false); setFontSize((f) => Math.max(20, f - 4)); }}>
          A−
        </button>
        <button className="btn btn-sm" onClick={() => { setAutoPace(false); setFontSize((f) => Math.min(160, f + 4)); }}>
          A+
        </button>
        <button className="btn btn-sm" onClick={() => setMirror((m) => !m)}>
          {mirror ? "unmirror" : "mirror"}
        </button>
        {/* Says which of the two is driving the words. Turning it back on is
            the way out of whatever you set by hand. */}
        <button
          className={`btn btn-sm ${autoPace ? "is-on" : ""}`}
          style={autoPace ? { borderColor: "var(--under)", color: "var(--under)" } : undefined}
          data-tip={
            autoPace
              ? "The words are paced to the item: sized to the time available and scrolled to finish as it ends. Press to set size and speed by hand."
              : "Size and speed are set by hand. Press to pace the words to the item again."
          }
          onClick={() => setAutoPace((a) => !a)}
        >
          {autoPace ? "auto pace" : "manual"}
        </button>
        {/* A refused command must never look like a broken button. The server
            decides whether this device may drive the show; if it says no, say
            so rather than leaving a press that did nothing. */}
        {channel.lastCmdError && (
          <span style={{ color: "#f85149" }} role="status">
            {channel.lastCmdError.action}: {channel.lastCmdError.msg}{" "}
            <button className="btn btn-sm" onClick={channel.clearCmdError}>
              dismiss
            </button>
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>
          {wordCount} words · ~{estMinutes}m ·{" "}
          {/* "following" used to mean nothing more than "the socket is open",
              so it read as following all through a show it was not tracking.
              It now says which of the three it actually is. */}
          <span style={{ color: !channel.connected ? "#f85149" : followId ? "#3fb950" : "#8b949e" }}>
            {!channel.connected ? "reconnecting…" : followId ? "following" : "show not running"}
          </span>
        </span>
      </footer>
    </main>
  );
}
