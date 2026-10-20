"use client";

import { useEffect, useRef, useState } from "react";
import { formatDuration, formatTimeOfDay, type TimingGap } from "@opencall/core";
import type { ProjectedRow } from "@opencall/db/doc";

/**
 * The timing check's problem, drawn (20 Oct, Robert: "add a visual … not just
 * text with no context for what it means").
 *
 * The rows from the last fixed time up to the one that disagrees, laid end to
 * end in proportion to their lengths, against the printed start of that row
 * as an upright line. What runs past the line is red; empty time before it is
 * amber. The picture is what the sentence above it says.
 */
export function TimingPicture({ rows, gap, use24h }: { rows: ProjectedRow[]; gap: TimingGap; use24h: boolean }) {
  // Drawn at the box's own width, one unit to a pixel, so the words are the
  // same size on a phone as on a desktop — scaled, they shrank to 4px there.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setW(Math.max(260, Math.round(el.clientWidth - 24)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const from = rows[gap.fromIndex];
  const to = rows[gap.toIndex];
  const start = from?.hardStartSec;
  const printed = to?.hardStartSec;
  if (!from || !to || start == null || printed == null) return null;

  // The items between, as the sheet counts them, end to end.
  const blocks: { title: string; at: number; len: number }[] = [];
  let cursor = start;
  for (let i = gap.fromIndex; i < gap.toIndex; i++) {
    const r = rows[i]!;
    if (r.type === "group" || r.parallel || r.durationMuted || r.skipped) continue;
    const len = r.durationSec ?? 0;
    if (len <= 0) continue;
    blocks.push({ title: (r.title || "untitled").split("\n")[0]!, at: cursor, len });
    cursor += len;
  }
  const expected = cursor;
  const overlap = gap.gapSec < 0;
  const end = Math.max(expected, printed);
  const nextLen = Math.max(60, Math.min(to.durationSec ?? 120, (end - start) * 0.25));
  const span = end + nextLen - start;

  const H = 92;
  const PAD = 8;
  const x = (sec: number) => PAD + ((sec - start) / span) * (W - PAD * 2);
  const BAR_Y = 24;
  const BAR_H = 30;
  const amount = formatDuration(Math.abs(gap.gapSec)).replace(/^0(\d:)/, "$1");
  const short = (t: string, px: number) => {
    const chars = Math.floor((px - 10) / 6.4);
    return chars < 3 ? "" : t.length > chars ? `${t.slice(0, chars - 1)}…` : t;
  };

  return (
    <figure ref={box} className="timing-picture" aria-label={`Picture: ${blocks.length} items add up to ${formatTimeOfDay(expected, use24h)}, the sheet says ${formatTimeOfDay(printed, use24h)}.`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {blocks.map((b, i) => {
          const bx = x(b.at);
          const bw = Math.max(1, x(b.at + b.len) - bx);
          return (
            <g key={i}>
              <rect x={bx} y={BAR_Y} width={bw} height={BAR_H} rx={4} className="tp-block" />
              <text x={bx + 6} y={BAR_Y + 19} className="tp-label">
                {short(b.title, bw)}
              </text>
              <title>
                {b.title} — {formatDuration(b.len)}
              </title>
            </g>
          );
        })}
        {overlap ? (
          <rect x={x(printed)} y={BAR_Y - 3} width={x(expected) - x(printed)} height={BAR_H + 6} rx={4} className="tp-over" />
        ) : (
          <rect x={x(expected)} y={BAR_Y} width={x(printed) - x(expected)} height={BAR_H} rx={4} className="tp-gap" />
        )}
        {/* The row whose printed time disagrees, starting where the sheet says. */}
        <rect x={x(printed)} y={BAR_Y} width={x(printed + nextLen) - x(printed)} height={BAR_H} rx={4} className="tp-next" />
        <text x={x(printed) + 6} y={BAR_Y + 19} className="tp-label tp-next-label">
          {short((to.title || "untitled").split("\n")[0]!, x(printed + nextLen) - x(printed))}
        </text>
        <line x1={x(printed)} x2={x(printed)} y1={18} y2={H - 16} className="tp-line" />
        <text x={x(printed)} y={14} textAnchor="middle" className="tp-time">
          printed {formatTimeOfDay(printed, use24h)}
        </text>
        <text x={(x(Math.min(expected, printed)) + x(Math.max(expected, printed))) / 2} y={H - 4} textAnchor="middle" className={overlap ? "tp-amount tp-amount-over" : "tp-amount tp-amount-gap"}>
          {overlap ? `${amount} too long` : `${amount} nothing planned`}
        </text>
        <text x={PAD} y={H - 4} className="tp-time">
          {formatTimeOfDay(start, use24h)}
        </text>
      </svg>
    </figure>
  );
}
