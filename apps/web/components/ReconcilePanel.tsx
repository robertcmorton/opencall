"use client";

import { useEffect } from "react";
import * as Y from "yjs";
import { findTimingGaps, formatDuration, formatTimeOfDay, type PlanTiming, type TimingGap } from "@opencall/core";

export { findTimingGaps, type TimingGap };
import type { ProjectedRow } from "@opencall/db/doc";

/**
 * Step-by-step reconciliation: for each mismatch the showcaller chooses —
 * absorb the gap into the segment's last duration, clear the disagreeing
 * anchor and let the cascade decide, or accept the gap as intentional
 * (a genuine hold in the original sheet).
 */
export function ReconcilePanel({
  doc,
  rows,
  timing,
  gaps,
  use24h,
  onClose,
  onCurrent,
}: {
  doc: Y.Doc;
  rows: ProjectedRow[];
  timing: PlanTiming;
  gaps: TimingGap[];
  use24h: boolean;
  onClose: () => void;
  /** Reports the rows of the issue on screen so the grid can highlight them. */
  onCurrent?: (focus: { fromId: string; toId: string } | null) => void;
}) {
  const yRows = doc.getMap<Y.Map<unknown>>("rows");

  // Ignored gaps are filtered out in `findTimingGaps` itself, so whatever
  // arrives here is genuinely still open — the panel used to keep a second,
  // private list of what had been accepted, and the two could disagree with
  // the warning line counting gaps elsewhere on the page.
  const open = gaps;
  const current = open[0];
  // Rows carrying an accepted gap, so a decision can be taken back. Without
  // this, ignoring is a one-way door: the check stops mentioning the row, and
  // with it goes the only place that could offer to look again.
  const ignored = rows.filter((r) => r.acceptedGapSec != null);

  /**
   * The holds already called deliberate, and the way back from each.
   *
   * Shown whether or not anything is still open. It lived only on the
   * all-clear screen at first, which meant a decision could not be revisited
   * while any other gap remained — the one moment you are most likely to want
   * it, since you are already looking at the timings and wondering what you
   * waved through earlier.
   */
  const deliberateHolds =
    ignored.length === 0 ? null : (
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
          Gaps you said are on purpose. Press Check it again to have the timing check look at one again:
        </span>
        {ignored.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline", flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--fs-sm)" }}>
              <span className="mono">{formatDuration(Math.abs(r.acceptedGapSec ?? 0))}</span> before “
              {(r.title || "untitled").slice(0, 32)}”
            </span>
            <button className="btn btn-sm btn-ghost" onClick={() => yRows.get(r.id)?.set("acceptedGapSec", null)}>
              Check it again
            </button>
          </div>
        ))}
      </div>
    );
  const fromId = current ? rows[current.fromIndex]?.id : undefined;
  const toId = current ? rows[current.toIndex]?.id : undefined;
  useEffect(() => {
    onCurrent?.(fromId && toId ? { fromId, toId } : null);
  }, [fromId, toId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!current) {
    return (
      <div className="panel" style={{ margin: "0 0 12px", display: "grid", gap: "var(--space-2)" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center" }}>
          <strong>✓ Timings agree</strong>
          <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", flex: 1 }}>
            Every fixed time now matches the lengths of the rows in between
            {ignored.length > 0 && ", apart from the gaps you said are on purpose"}.
          </span>
          <button className="btn btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
        {deliberateHolds}
      </div>
    );
  }

  const from = rows[current.fromIndex]!;
  const to = rows[current.toIndex]!;
  // The row whose duration absorbs the gap: the last row before the anchor
  // that HAS a duration, else the segment opener itself.
  let absorbIndex = current.toIndex - 1;
  while (absorbIndex > current.fromIndex && rows[absorbIndex]!.durationSec == null) absorbIndex--;
  const absorb = rows[absorbIndex]!;
  const absorbNew = Math.max(0, (absorb.durationSec ?? 0) + current.gapSec);

  const overlap = current.gapSec < 0;
  /**
   * Can this row absorb the disagreement at all?
   *
   * `absorbNew` is clamped at zero, so on an overlap larger than the row it
   * lands on 0 and reads like a fix. It is not: emptying a four-minute bell
   * out of a nineteen-minute overlap leaves fifteen minutes of it, while the
   * sentence beside the button promises the durations "meet the printed time
   * exactly". Thirteen of the ninety-five disagreements across the sample
   * sheets were being offered that.
   *
   * Withdrawn rather than reworded: a choice that cannot do what it says is
   * not a choice, and the other two — move the printed time, or accept the
   * gap — still resolve the row.
   */
  const absorbResolves = (absorb.durationSec ?? 0) + current.gapSec >= 0;
  /**
   * The row that OPENS the segment is as long as the whole disagreement.
   *
   * That is not a cue that ran long, it is a row that SPANS the rows beneath
   * it: "HALF TIME (15 mins)" at 8:47, and then the wrap, the review and the
   * ad reel that fill those same fifteen minutes. Charge the block and then
   * its contents and the sheet appears to hold a quarter of an hour more than
   * it has — which is exactly what a fifteen-minute overlap against a
   * fifteen-minute block means.
   *
   * Keyed on the segment's OPENER, not on the last row before the anchor. An
   * earlier attempt tested the last one and fired on nothing real, because the
   * spanning row is by definition the first.
   *
   * Muting rather than zeroing: half time is genuinely fifteen minutes long
   * and somebody calling the show needs to know that. The number stays on the
   * sheet and leaves the sum, which is what muting means.
   */
  const spansContents =
    overlap && (from.durationSec ?? 0) > 0 && Math.abs((from.durationSec ?? 0) + current.gapSec) < 1;

  return (
    <div className="panel" style={{ margin: "0 0 12px", display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
        <strong>Timing check</strong>
        <span className="chip" style={{ color: "var(--warn)", borderColor: "var(--warn)" }}>
          {open.length} of {gaps.length} still to sort out
        </span>
        <span style={{ flex: 1 }} />
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ fontSize: "var(--fs-sm)", lineHeight: 1.6, color: "var(--text-2)" }}>
        The start times and the lengths of the rows don&apos;t add up here. Starting from{" "}
        <strong style={{ color: "var(--text)" }}>{from.title || "untitled"}</strong> at{" "}
        <span className="mono">{from.hardStartSec != null ? formatTimeOfDay(from.hardStartSec, use24h) : "—"}</span> and adding
        up every length in between, <strong style={{ color: "var(--text)" }}>{to.title || "untitled"}</strong> should start at{" "}
        <strong className="mono" style={{ color: "var(--text)" }}>
          {to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec - current.gapSec, use24h) : "—"}
        </strong>{" "}
        — but the sheet says{" "}
        <strong className="mono" style={{ color: "var(--text)" }}>
          {to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec, use24h) : "—"}
        </strong>
        . That's{" "}
        <strong className="mono" style={{ color: overlap ? "var(--over)" : "var(--warn)" }}>
          {formatDuration(Math.abs(current.gapSec))}
        </strong>{" "}
        {overlap
          ? "too much: the rows above it run past the time written on the sheet."
          : "of empty time: nothing is planned before the time written on the sheet."}{" "}
        Pick which number is right:
      </div>

      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        {spansContents && (
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
            <button
              className="btn btn-sm btn-primary"
              style={{ flexShrink: 0 }}
              onClick={() => {
                doc.transact(() => {
                  yRows.get(from.id)?.set("durationMuted", true);
                });
              }}
            >
              “{(from.title || "untitled").slice(0, 24)}” happens during the rows under it
            </button>
            <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
              Its <span className="mono">{formatDuration(from.durationSec ?? 0)}</span> happens at the same time as the
              rows under it, not before them, so it should only be counted once. The length stays on the sheet (half
              time is still fifteen minutes), but it no longer pushes the later rows back.
            </span>
          </div>
        )}
        <div
          style={{ display: absorbResolves && !spansContents ? "flex" : "none", gap: "var(--space-3)", alignItems: "baseline" }}
        >
          <button
            className="btn btn-sm btn-primary"
            style={{ flexShrink: 0 }}
            onClick={() => {
              doc.transact(() => {
                yRows.get(absorb.id)?.set("durationSec", absorbNew);
              });
            }}
          >
            Change “{(absorb.title || "untitled").slice(0, 24)}” length to {formatDuration(absorbNew)}
          </button>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
            The start times are right: “{(absorb.title || "untitled").slice(0, 24)}” changes from{" "}
            <span className="mono">{absorb.durationSec != null ? formatDuration(absorb.durationSec) : "—"}</span> to{" "}
            <span className="mono">{formatDuration(absorbNew)}</span> long, and then everything adds up.
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
          <button
            className="btn btn-sm"
            style={{ flexShrink: 0 }}
            onClick={() => {
              // One fix clears the whole chain: the correction shifts THIS
              // row's fixed time and every fixed time below it by the same
              // amount — no walking the sheet gap by gap.
              doc.transact(() => {
                const delta = -current.gapSec;
                for (let i = current.toIndex; i < rows.length; i++) {
                  const r = rows[i]!;
                  if (r.hardStartSec != null) yRows.get(r.id)?.set("hardStartSec", r.hardStartSec + delta);
                }
              });
            }}
          >
            Move “{(to.title || "untitled").slice(0, 24)}” to{" "}
            {to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec - current.gapSec, use24h) : "—"}, and the rows below with it
          </button>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
            The lengths are right: this row moves to{" "}
            <span className="mono">{to.hardStartSec != null ? formatTimeOfDay(to.hardStartSec - current.gapSec, use24h) : "—"}</span>{" "}
            and <strong>every fixed time below moves with it</strong>. One fix and the whole sheet adds up again. One
            Undo puts it all back.
          </span>
        </div>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "baseline" }}>
          {/* Boxed, like the two above it. Ignoring is a third answer to the
              question, not a lesser one — a deliberate hold is as real a
              resolution as moving a time — and the ghost styling made it read
              as a way out of the panel rather than one of the choices in it. */}
          <button
            className="btn btn-sm"
            style={{ flexShrink: 0 }}
            onClick={() => {
              // Written into the sheet, not into this screen. It used to be
              // React state, so "the check stops flagging it" lasted until the
              // panel closed — the promise in the sentence beside this button
              // was true for about a minute. Now it holds for everyone, and
              // survives a reload, and one undo takes it back.
              yRows.get(to.id)?.set("acceptedGapSec", current.gapSec);
            }}
          >
            Leave it — the gap is on purpose
          </button>
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-2)" }}>
            Both numbers are right. The show really does wait for{" "}
            <span className="mono">{formatDuration(Math.abs(current.gapSec))}</span> here (for doors, walk-in or a
            changeover). Nothing changes or moves. The check stops warning about it, for everyone, until the gap changes
            size. If you change a length above it, it will ask again.
          </span>
        </div>
        {deliberateHolds}
      </div>
    </div>
  );
}
