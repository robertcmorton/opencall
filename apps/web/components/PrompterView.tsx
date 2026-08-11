"use client";

import { useEffect, useRef, useState } from "react";
import { projectRundownDoc } from "@opencall/db/doc";
import { computeTiming, followRead, formatTimeOfDay, PROMPTER_TAG } from "@opencall/core";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";

/**
 * Prompter: renders the script column full-screen with auto-scroll (Space to
 * start/stop, arrows for speed), font-size controls, mirror mode, a fixed
 * read-position caret, and follow-the-caller (jumps to the active cue).
 */
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

  // Follow the caller.
  //
  // The live cue is almost never one of these rows — this screen shows only
  // what is to be READ, a handful out of a whole sheet — so looking the active
  // row up by id found nothing and scrolled nowhere for the entire show, while
  // the corner said "following". What the person holding the prompter needs is
  // not "the show is on a row you cannot see", it is WHAT THEY READ NEXT: the
  // first read at or after wherever the show has got to.
  const rowIndexById = new Map(rows.map((r, i) => [r.id, i]));
  const liveId = show?.state === "running" || show?.state === "paused" ? show.activeRowId : null;
  const { onAirId, followId } = followRead({
    liveIndex: liveId != null ? (rowIndexById.get(liveId) ?? -1) : -1,
    reads: cues.map((c) => ({ id: c.id, index: rowIndexById.get(c.id) ?? -1 })),
  });

  useEffect(() => {
    if (!followId || followId === lastActiveRef.current) return;

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
      const el = document.getElementById(`prompt-${followId}`);
      if (!box || !el || box.clientHeight === 0) return false;
      // Land it on the read-position caret rather than the top edge — that
      // fixed marker is where the reader's eye is.
      const caret = box.clientHeight * 0.3;
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
      lastActiveRef.current = followId;
      return;
    }
    timer = setInterval(() => {
      if (!place()) return;
      lastActiveRef.current = followId;
      if (timer) clearInterval(timer);
    }, 200);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [followId, cues.length]);

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

  return (
    <main style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#000" }}>
      {/* Read-position caret */}
      <div
        style={{
          position: "fixed",
          left: 8,
          top: "30vh",
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
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "30vh 8vw 60vh",
          transform: mirror ? "scaleX(-1)" : undefined,
        }}
      >
        {cues.length === 0 && (
          <div style={{ color: "#777", fontSize: "1.1rem", lineHeight: 1.6, maxWidth: "40ch" }}>
            Nothing to read yet. Mark a row <strong style={{ color: "#f2f2f2" }}>{PROMPTER_TAG}</strong> in the run
            sheet&rsquo;s cue column — the words in that row then appear here, with the time they are due.
          </div>
        )}
        {cues.map((row, i) => {
          const startSec = startById.get(row.id) ?? null;
          const words = wordsOf(row);
          return (
            <section key={row.id} id={`prompt-${row.id}`} style={{ marginBottom: "1.2em" }}>
              <div
                style={{
                  color: activeId === row.id ? "#2f81f7" : "#555",
                  fontSize: "0.85rem",
                  letterSpacing: "0.1em",
                  marginBottom: 6,
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
                {activeId === row.id && <span style={{ color: "#2f81f7", fontWeight: 700 }}>ON AIR</span>}
                {nextId === row.id && <span style={{ color: "#d29922", fontWeight: 700 }}>NEXT</span>}
              </div>
              {words && (
                <div style={{ fontSize, lineHeight: 1.45, color: "#f2f2f2", fontWeight: 500 }}>{words}</div>
              )}
            </section>
          );
        })}
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
