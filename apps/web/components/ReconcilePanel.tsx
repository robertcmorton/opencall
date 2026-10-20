"use client";

import { useEffect } from "react";
import * as Y from "yjs";
import { findTimingGaps, fixAllRecommended, fixChanges, fixChoices, formatDuration, formatTimeOfDay, type PlanTiming, type TimingFix, type TimingGap } from "@opencall/core";
import { say } from "../lib/dialogs";
import { TimingPicture } from "./TimingPicture";

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
  plannedStartSec,
  onClose,
  onCurrent,
}: {
  doc: Y.Doc;
  rows: ProjectedRow[];
  timing: PlanTiming;
  gaps: TimingGap[];
  use24h: boolean;
  /** The sheet's planned start, for working through every fix at once. */
  plannedStartSec: number | null;
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

  const to = rows[current.toIndex]!;
  const choices = fixChoices(rows, current);
  const name = (i: number) => `“${(rows[i]?.title || "untitled").split("\n")[0]!.slice(0, 32)}”`;
  const amount = formatDuration(Math.abs(current.gapSec)).replace(/^0(\d:)/, "$1");
  const at = (sec: number | null | undefined) => (sec != null ? formatTimeOfDay(sec, use24h) : "—");

  /**
   * One sentence, not a paragraph of arithmetic (20 Oct, Robert: "very
   * complicated and wordy"). What is wrong, in the sheet's own names; the
   * workings are in the buttons, which each say what they change.
   */
  const problem =
    choices.recommended.kind === "count-once" ? (
      <>
        {name(current.fromIndex)} is counted twice: its {formatDuration(rows[current.fromIndex]?.durationSec ?? 0)} happens during the rows under it.
      </>
    ) : current.gapSec < 0 ? (
      <>
        The rows before {name(current.toIndex)} run <strong className="mono rc-over">{amount}</strong> past its {at(to.hardStartSec)} start.
      </>
    ) : (
      <>
        Nothing is planned for <strong className="mono rc-gap">{amount}</strong> before {name(current.toIndex)} at {at(to.hardStartSec)}.
      </>
    );

  const label = (f: TimingFix): string => {
    switch (f.kind) {
      case "count-once":
        return `Count ${name(f.index)} once`;
      case "resize": {
        const by = formatDuration(Math.abs(f.toSec - f.fromSec)).replace(/^0(\d:)/, "$1");
        return `Make ${name(f.index)} ${by} ${f.toSec < f.fromSec ? "shorter" : "longer"}`;
      }
      case "move":
        return `Move ${name(f.index)} to ${at((rows[f.index]?.hardStartSec ?? 0) + f.deltaSec)}, and the rows below`;
      case "accept":
        return "Leave the gap — it’s on purpose";
    }
  };
  const why = (f: TimingFix): string => {
    switch (f.kind) {
      case "count-once":
        return "Its length stays on the sheet; it just stops pushing the rows below back.";
      case "resize":
        return "Keeps every printed time as it is.";
      case "move":
        return "Keeps every length as it is; every fixed time below moves by the same amount.";
      case "accept":
        return "Nothing changes; the check stops asking about this gap.";
    }
  };
  const apply = (f: TimingFix) =>
    doc.transact(() => {
      for (const c of fixChanges(rows, f)) yRows.get(rows[c.index]!.id)?.set(c.field, c.value);
    });

  return (
    <div className="panel reconcile" style={{ margin: "0 0 12px" }}>
      <div className="rc-head">
        <strong>Timing check</strong>
        <span className="chip rc-count">{open.length} to sort out</span>
        <span style={{ flex: 1 }} />
        {open.length > 1 && (
          <button
            className="btn btn-sm"
            data-tip="Fix every one the recommended way. One Undo takes them all back."
            onClick={() => {
              const { changes, fixed } = fixAllRecommended(rows, plannedStartSec);
              doc.transact(() => {
                for (const c of changes) yRows.get(rows[c.index]!.id)?.set(c.field, c.value);
              });
              say(`Fixed ${fixed} the recommended way. One Undo takes them all back.`, "success");
            }}
          >
            Fix all {open.length} the recommended way
          </button>
        )}
        <button className="btn btn-sm btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>

      <p className="rc-problem">{problem}</p>
      <TimingPicture rows={rows} gap={current} use24h={use24h} />

      <div className="rc-recommended">
        <button className="btn btn-primary" onClick={() => apply(choices.recommended)}>
          {label(choices.recommended)}
        </button>
        <span className="rc-badge">Recommended</span>
        <span className="rc-why">{why(choices.recommended)}</span>
      </div>

      {choices.others.length > 0 && (
        <details className="rc-others">
          <summary>Other ways to fix it</summary>
          <div className="rc-other-list">
            {choices.others.map((f) => (
              <div key={f.kind} className="rc-other">
                <button className="btn btn-sm" onClick={() => apply(f)}>
                  {label(f)}
                </button>
                <span className="rc-why">{why(f)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
      {deliberateHolds}
    </div>
  );
}
