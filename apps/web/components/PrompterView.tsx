"use client";

import { useEffect, useRef, useState } from "react";
import { projectRundownDoc } from "@opencall/db/doc";
import {
  computeTiming,
  followRead,
  formatDuration,
  formatTimeOfDay,
  PROMPTER_TAG,
  secondsUntilRow,
} from "@opencall/core";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";
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
  const { doc } = useRundownDoc(rundownId);
  const { columns, rows, meta } = projectRundownDoc(doc);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const show = channel.show;

  const [fontSize, setFontSize] = useState(42);
  const [mirror, setMirror] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(60); // px per second
  // Tracking the show, until the reader scrolls by hand. Same bargain the run
  // sheet strikes: never fight somebody who has taken hold of the script, and
  // give them one button to hand it back.
  const [followScroll, setFollowScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastActiveRef = useRef<string | null>(null);
  const programmaticScroll = useRef(false);

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

  // The scroll follows the SHOW. Before it starts there is nothing to follow,
  // so the script simply sits at the top where a reader can look ahead.
  const scrollTargetId = liveId;
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

    // Our own scrolling must not read as the reader taking hold of the script.
    programmaticScroll.current = true;
    const release = () => {
      window.setTimeout(() => {
        programmaticScroll.current = false;
      }, 400);
    };

    if (place()) {
      lastActiveRef.current = scrollTargetId;
      release();
      return;
    }
    timer = setInterval(() => {
      if (!place()) return;
      lastActiveRef.current = scrollTargetId;
      release();
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
    const letGo = () => {
      if (!programmaticScroll.current) setFollowScroll(false);
    };
    box.addEventListener("wheel", letGo, { passive: true });
    box.addEventListener("touchmove", letGo, { passive: true });
    return () => {
      box.removeEventListener("wheel", letGo);
      box.removeEventListener("touchmove", letGo);
    };
  }, []);

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

  // The state of the read being followed, in the words a reader thinks in.
  const onAirNow = onAirId != null;
  const cueLabel = onAirNow
    ? "ON AIR"
    : secondsUntilOn == null
      ? "STANDING BY"
      : secondsUntilOn <= 30
        ? "STAND BY"
        : "ON IN";
  const cueValue = onAirNow
    ? live?.remainingInRowSec != null
      ? formatDuration(Math.max(0, Math.round(live.remainingInRowSec)))
      : "—"
    : secondsUntilOn != null
      ? formatDuration(Math.round(secondsUntilOn))
      : "—";
  // Red on air, amber in the last thirty seconds — the same colours the timer
  // and the run sheet use, so they mean one thing across the whole app.
  const cueColour = onAirNow ? "#f85149" : secondsUntilOn != null && secondsUntilOn <= 30 ? "#d29922" : "#3fb950";

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
            NEXT{secondsUntilNext != null ? ` · ${formatDuration(Math.round(secondsUntilNext))}` : ""}
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
      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
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
        }}
      >
        {cues.length === 0 && (
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
                <span style={{ color: "#444" }}>{row.sourceNumber ? `#${row.sourceNumber}` : `${i + 1}`}</span>
                {isLiveRow && <span style={{ color: "#2f81f7", fontWeight: 700 }}>ON AIR</span>}
                {activeId === row.id && !isLiveRow && <span style={{ color: "#2f81f7", fontWeight: 700 }}>ON AIR</span>}
                {nextId === row.id && <span style={{ color: "#d29922", fontWeight: 700 }}>NEXT</span>}
              </div>
              {words &&
                (read ? (
                  // The words to say. Only these answer to the size controls —
                  // making the whole sheet this big would bury the script in the
                  // running order it is meant to stand out from.
                  <div style={{ fontSize, lineHeight: 1.45, color: "#f2f2f2", fontWeight: 500 }}>{words}</div>
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
          gap: 14,
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
        {liveId && !followScroll && (
          <button
            className="btn btn-sm btn-primary"
            data-tip="Jump back to the live cue and follow along again"
            onClick={() => {
              lastActiveRef.current = null;
              setFollowScroll(true);
            }}
          >
            ⇣ Sync
          </button>
        )}
        <button className="btn btn-sm" onClick={() => setScrolling((s) => !s)}>
          {scrolling ? "⏸" : "▶"}
        </button>
        <label>
          speed{" "}
          <input
            type="range"
            min={10}
            max={300}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
        </label>
        <button className="btn btn-sm" onClick={() => setFontSize((f) => Math.max(20, f - 4))}>
          A−
        </button>
        <button className="btn btn-sm" onClick={() => setFontSize((f) => Math.min(96, f + 4))}>
          A+
        </button>
        <button className="btn btn-sm" onClick={() => setMirror((m) => !m)}>
          {mirror ? "unmirror" : "mirror"}
        </button>
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
