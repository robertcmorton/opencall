"use client";

import { computeTiming, formatDuration, formatTimeOfDay, nextCueRow, zoneSecondsOfDay } from "@opencall/core";
import { useEffect, useEffectEvent, useState } from "react";
import { projectRundownDoc } from "@opencall/db/doc";
import { useRundownDoc, useWakeLock } from "../lib/useRundownDoc";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { SpeakerBanner } from "./SpeakerMessage";
import { BackLink } from "./BackLink";

const NEXT_COUNT = 3;

/**
 * Backstage display: a screen on the wall of the green room or the tunnel.
 * What is on air and how long it has left, the next three items with their
 * times, and the clock — readable from across a room, nothing to press.
 *
 * Sized from the viewport (vmin) so the same page fills a TV, a monitor or a
 * tablet propped on a desk.
 */
export function DisplayView({ rundownId, joinCode }: { rundownId: string; joinCode?: string }) {
  useWakeLock();
  const { doc } = useRundownDoc(rundownId);
  const { meta, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
  const channel = useShowChannel(rundownId, "companion", joinCode);
  const live = useLiveTiming(channel, timing);
  const show = channel.show;

  // The wall clock, in the event's own time zone, once a second.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const tick = useEffectEvent(() => setNowMs(channel.serverNow()));
  useEffect(() => {
    tick();
    const id = window.setInterval(() => tick(), 1000);
    return () => window.clearInterval(id);
  }, []);
  // Whole seconds: the zone conversion keeps the milliseconds.
  const clock = nowMs != null ? formatTimeOfDay(Math.floor(zoneSecondsOfDay(nowMs, channel.timezone)), meta.use24h) : "";

  const isLive = show?.state === "running" || show?.state === "paused";
  const active = isLive && show?.activeRowId ? rows.find((r) => r.id === show.activeRowId) : null;
  const played = new Set(show?.playedRowIds ?? []);

  // The next items as the transport will take them: from the one on air, or —
  // before the show — from the top of the running order.
  const upcoming: typeof rows = [];
  let cursor: string | null = active?.id ?? null;
  if (!cursor) {
    const first = rows.find((r) => r.type !== "group" && !r.skipped && !r.parallel);
    if (first) upcoming.push(first);
    cursor = first?.id ?? null;
  }
  while (cursor && upcoming.length < NEXT_COUNT) {
    const nextId = nextCueRow(rows, cursor, played);
    const r = nextId ? rows.find((x) => x.id === nextId) : null;
    if (!r || upcoming.includes(r)) break;
    upcoming.push(r);
    cursor = r.id;
  }
  const startOf = (id: string) => {
    const i = rows.findIndex((r) => r.id === id);
    const sec = i >= 0 ? timing.rows[i]?.startSec : null;
    return sec != null ? formatTimeOfDay(sec, meta.use24h) : "";
  };

  const remaining = live?.remainingInRowSec ?? null;
  const over = remaining != null && remaining < 0;
  const planned = active?.durationSec ?? 0;
  const amber = !over && remaining != null && planned > 0 && remaining <= Math.min(60, planned * 0.2);
  const countColor = over ? "var(--over)" : amber ? "var(--warn)" : "var(--under)";
  const status = !channel.connected ? "Reconnecting…" : show?.state === "paused" ? "PAUSED" : isLive ? (active ? "ON AIR" : "LIVE — nothing on air yet") : "Not started";

  return (
    <main className="force-dark display-view">
      <SpeakerBanner message={channel.speaker} />
      <header className="display-top">
        <span className="display-name">{meta.name}</span>
        <span className="display-clock">{clock}</span>
      </header>
      <section className="display-main">
        <div className="display-now">
          <span className={`display-status ${isLive ? "live" : ""}`}>{status}</span>
          <span className="display-title">{active ? active.title.trim() || "(untitled)" : isLive ? "" : "Standing by"}</span>
          {active && remaining != null && (
            <span className="display-count" style={{ color: countColor }}>
              {over ? `+${formatDuration(live!.rowOverSec)}` : formatDuration(remaining)}
            </span>
          )}
        </div>
        <ol className="display-next">
          <li className="display-next-head">{active ? "Next" : "First up"}</li>
          {upcoming
            .filter((r) => r.id !== active?.id)
            .slice(0, NEXT_COUNT)
            .map((r) => (
              <li key={r.id}>
                <span className="display-next-time">{startOf(r.id)}</span>
                <span className="display-next-title">{r.title.trim() || "(untitled)"}</span>
                <span className="display-next-dur">{r.durationSec != null ? formatDuration(r.durationSec) : ""}</span>
              </li>
            ))}
        </ol>
      </section>
      <BackLink className="btn btn-sm display-back" />
    </main>
  );
}
