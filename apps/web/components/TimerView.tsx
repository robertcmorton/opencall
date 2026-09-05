"use client";

import { absoluteNow, computeTiming, firstCueRow, formatDuration, nextCueRow, secondsUntilShow, zoneSecondsOfDay } from "@opencall/core";
import { useEffect, useRef, useState } from "react";
import { projectRundownDoc } from "@opencall/db/doc";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { BackLink } from "./BackLink";

/**
 * Speaker Timer: fullscreen countdown for the active cue. Green while on time,
 * amber inside the final stretch, red counting up on overrun. Meant for
 * confidence monitors and speakers' phones.
 *
 * It counts only while a show is live with an item on air — that is its job.
 * But it used to show "--:--" and NOTHING ELSE in every other state, which
 * on show day read as broken: a show started at two o'clock for a four
 * o'clock first cue sat on dashes for two hours with no caption at all, and
 * a walkthrough got dashes and "standing by" as if nothing were happening.
 * Now each state says what it is: the countdown to the first cue while the
 * show waits for it, the item being walked and its planned length during a
 * walkthrough, and "standing by" only when there is genuinely nothing.
 */
export function TimerView({ rundownId, joinCode }: { rundownId: string; joinCode?: string }) {
  useWakeLock();
  const { doc } = useRundownDoc(rundownId);
  const { meta, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const live = useLiveTiming(channel, timing);
  const show = channel.show;

  const isLive = show?.state === "running" || show?.state === "paused";
  const active = isLive && show?.activeRowId ? rows.find((r) => r.id === show.activeRowId) : null;
  // The row being walked, when nothing is live: the timer follows the
  // walkthrough the way every other screen does.
  const walkRow = !isLive && show?.walkRowId ? rows.find((r) => r.id === show.walkRowId) : null;

  // Live with nothing on air yet: the show is waiting for its first cue, and
  // the wait is worth showing. Ticked once a second, and only in that state.
  // The channel is read through a ref because it is a fresh object every
  // render, and an effect depending on it would never settle.
  const channelRef = useRef(channel);
  channelRef.current = channel;
  const waiting = isLive && !active;
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    if (!waiting) return;
    const tick = () => setNowMs(channelRef.current.serverNow());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [waiting]);
  const starts = timing.rows.map((r) => r.startSec);
  const untilShowSec =
    waiting && nowMs != null ? secondsUntilShow(rows, starts, absoluteNow(zoneSecondsOfDay(nowMs, channel.timezone), timing)) : null;
  const firstCue = waiting ? firstCueRow(rows, starts) : null;
  const firstCueRecord = firstCue ? rows.find((r) => r.id === firstCue.id) : null;

  const planned = active?.durationSec ?? 0;
  const remaining = live?.remainingInRowSec ?? null;
  const over = remaining != null && remaining < 0;
  const amber = !over && remaining != null && planned > 0 && remaining <= Math.min(60, planned * 0.2);
  const countingDown = isLive && !!active && remaining != null;
  const color = !channel.connected
    ? "#777"
    : countingDown
      ? over
        ? "var(--over)"
        : amber
          ? "var(--warn)"
          : "var(--under)"
      : untilShowSec != null && untilShowSec > 0
        ? "var(--under)"
        : "var(--text-2)";

  const display = countingDown
    ? over
      ? `+${formatDuration(live!.rowOverSec)}`
      : formatDuration(remaining!)
    : untilShowSec != null && untilShowSec > 0
      ? formatDuration(Math.round(untilShowSec))
      : walkRow?.durationSec != null
        ? formatDuration(walkRow.durationSec)
        : "--:--";

  const title = active ? active.title : walkRow ? walkRow.title : waiting && firstCueRecord ? firstCueRecord.title : meta.name;
  const caption = !channel.connected
    ? "reconnecting…"
    : countingDown
      ? show?.state === "paused"
        ? "paused"
        : ""
      : waiting
        ? untilShowSec != null && untilShowSec > 0
          ? "until the show starts"
          : "show started — nothing on air yet"
        : walkRow
          ? "walkthrough — planned length, not counting"
          : "standing by";

  // What came before and what is next, around the item on air or the item
  // being walked — the neighbours a speaker actually wants to know about.
  const reference = active ?? walkRow ?? null;
  const steppable = rows.filter((r) => r.type !== "group" && !r.skipped && !r.parallel);
  const at = reference ? steppable.findIndex((r) => r.id === reference.id) : -1;
  const name = (r: { title: string } | undefined): string | null => (r ? r.title.trim() || "(untitled)" : null);
  const before = at > 0 ? name(steppable[at - 1]) : null;
  // Live, "next" is what the transport will actually take: the shared rule,
  // which skips rows already played and goes back for a called ending. In
  // the walkthrough there is no cue and no played list, so it is the row
  // after.
  const next = active
    ? name(rows.find((r) => r.id === nextCueRow(rows, active.id, new Set(channel.show?.playedRowIds ?? []))))
    : at >= 0 && at < steppable.length - 1
      ? name(steppable[at + 1])
      : null;

  return (
    <main
      onDoubleClick={() => void document.documentElement.requestFullscreen?.().catch(() => undefined)}
      style={{
        // Sized to the screen in BOTH axes (min of vw/vh) so nothing ever
        // overflows — wide, tall, phone, or confidence monitor.
        height: "100dvh",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "2vh",
        background: "#000",
        cursor: "default",
        userSelect: "none",
        padding: "0 2vw",
      }}
    >
      {/* Held back to a whisper: this screen is pointed at a speaker or a
          confidence monitor, where a bright button beside the countdown would
          be a distraction. Still there when somebody looks for it. */}
      <BackLink style={{ position: "fixed", top: 12, left: 12, opacity: 0.35, zIndex: 5 }} />
      <div
        style={{
          color: "var(--text-2)",
          fontSize: "min(3.4vw, 5vh)",
          fontWeight: 500,
          maxWidth: "94vw",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      <div
        style={{
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: "1.5vh 4vw",
          maxWidth: "96vw",
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          // Sized to the DIGITS THERE ARE, not to a guess.
          //
          // 22vw fits "02:10". It does not fit "+5:53:45" — an item running an
          // hour over gains three characters and the last of them went off the
          // side of the screen, on the one surface whose entire job is being
          // readable from the back of a room. The cap keeps the familiar size
          // for ordinary times and only ever shrinks.
          fontSize: `min(22vw, ${((96 - 8) / (Math.max(5, display.length) * 0.62)).toFixed(1)}vw, 52vh)`,
          lineHeight: 1.05,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {display}
      </div>
      <div style={{ color: "var(--text-3)", fontSize: "min(1.6vw, 2.6vh)" }}>{caption}</div>
      {(before || next) && (
        <div
          style={{
            display: "flex",
            gap: "4vw",
            color: "var(--text-3)",
            fontSize: "min(1.6vw, 2.6vh)",
            maxWidth: "94vw",
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          {before && (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              before · <span style={{ color: "var(--text-2)" }}>{before}</span>
            </span>
          )}
          {next && (
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              next · <span style={{ color: "var(--text-2)" }}>{next}</span>
            </span>
          )}
        </div>
      )}
    </main>
  );
}
