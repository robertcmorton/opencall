"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import { useCallback, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { useIsNarrow, useIsPhone } from "../lib/useIsPhone";
import { useRowWindow } from "../lib/useRowWindow";
import { Stopwatch } from "./Stopwatch";
import { ulid } from "ulid";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  absoluteNow,
  checkStartTimes,
  clockTargetRow,
  firstCueRow,
  secondsUntilShow,
  findConcurrentRows,
  rowsOnAt,
  computeTiming,
  defaultViewColumns,
  resolveEventType,
  resultDueNow,
  outcomesFor,
  formatDuration,
  formatTimeOfDay,
  formatTimeOfDayWithDay,
  parseDurationShorthand,
  parseTimeOfDay,
  serializeCsv,
  startEditRipples,
  zoneSecondsOfDay,
} from "@opencall/core";
import { describeDevice, viewerName } from "../lib/viewerIdentity";
import { api, setActiveJoinCode } from "../lib/api";
import { exportRundownPdf } from "../lib/exportPdf";
import { projectRundownDoc, type ColumnDef, type ProjectedRow } from "@opencall/db/doc";
import { CuePool } from "./CuePool";
import { ReconcilePanel, findTimingGaps } from "./ReconcilePanel";
import { KeyTimesEditor } from "./KeyTimes";
/**
 * The cell editor arrives only if somebody edits a cell.
 *
 * It carries the rich-text engine, which is 349 kB of the 1.1 MB this route
 * downloads before it can even open its socket — and it mounts on one path
 * only: a double-click on a cell (`renderRichCell`, below). A read-only viewer
 * on a phone at the side of a pitch could never reach it, and was paying for
 * it on every load anyway.
 *
 * Splitting it out would ordinarily trade boot time for a stall on the first
 * double-click, which on a show night is the worse bargain. So it is fetched
 * during the first idle moment after the sheet is up, and only for people who
 * can actually edit — by the time anyone reaches for a cell it is already
 * there, and the boot no longer waits for it.
 */
const CellEditor = dynamic(() => import("./CellEditor").then((m) => m.CellEditor), {
  ssr: false,
  loading: () => <span className="cell-standin" aria-hidden="true" />,
});
import { HistoryPanel, JoinCodesPanel } from "./SharePanels";
import { LiveReadouts, ShowStateControls, TransportBar, describeShowDrift } from "./TransportBar";
import { Dropdown, HeaderClock, Icon } from "./ui";
import { SideNavSection, WithSideNav } from "./SideNav";
import { RoleBar, RolePicker, highlightRoles, matchingRole } from "./RoleBar";
import { RichCellText } from "./RichCellText";
import { useColWidths } from "../lib/useColWidths";
import { useEditLock } from "../lib/useEditLock";
import { DiagnosticsBar } from "./DiagnosticsBar";
import { DocBlockedPanel } from "./DocBlockedPanel";
import { useShowChannel } from "../lib/showChannel";
import { useLiveTiming } from "../lib/useLiveTiming";
import { useRundownDoc } from "../lib/useRundownDoc";
import { rowNumbering } from "../lib/rowNumbering";

type ActiveCell = { rowId: string; columnId: string } | null;

/** Default cue-type vocabulary from real production sheets. Free text always works too. */
const CUE_TYPE_CHIPS = ["AUDIO", "GFX", "VTR", "LED", "PA", "MC", "GA", "DJ", "CREW", "PYRO", "LIGHTING", "LIVE VSN", "CAM", "SUPER", "TAKEOVER", "SCORE", "NOTE"];

/**
 * A row's place in a stack of alternate endings. `opens`/`closes` bound one
 * ending; `blockOpens`/`blockCloses` bound the whole set of them.
 */
interface BranchMark {
  outcome: string;
  opens: boolean;
  closes: boolean;
  blockOpens: boolean;
  blockCloses: boolean;
  /** A result has been called and it was not this one. */
  dim: boolean;
  /**
   * Which layer of the ending this row is on.
   *
   * 0 is what can happen at full time — win, lose, or the extra period. 1 is
   * what can happen on the far side of the extra period. A drawn match is only
   * ever on layer 1; a win is on layer 0 and reachable again from layer 1,
   * which is why the endings are a diamond rather than a list.
   */
  layer: 0 | 1;
  /** First row of its layer within this block — the layer header goes above it. */
  layerOpens: boolean;
}

/**
 * How the alternate endings are laid out on the sheet.
 *
 * `layers` keeps every branch on the page under a header that carries the
 * layer's one start time. `fork` collapses the whole block to a single row
 * until a result is called, and lets the chooser at the foot of the screen do
 * the calling. Both are being tried against real sheets before one wins.
 */
type OutcomeLayout = "layers" | "fork";
const OUTCOME_LAYOUT_KEY = "oc:outcomelayout";

/**
 * How long before the end of the half the result chooser appears.
 *
 * A decision buffer, not a warning. The showcaller needs long enough to read
 * three buttons and press the right one while the siren is going and a
 * producer is talking in their ear — but the chooser is a bar across the foot
 * of a live screen, and up for the whole second half it is just something
 * covering rows.
 */
const RESULT_BUFFER_SEC = 30;

function SortableRow({
  row,
  branch,
  displayNumber,
  children,
  selected,
  active,
  next,
  walk,
  gapMark,
  paused,
  mine,
  mineColor,
  clockMark,
  runsWith,
  onNow,
  disabled,
  onSelect,
}: {
  row: ProjectedRow;
  /** Set when this row is one of a game's alternate endings — see `branchAt`. */
  branch?: BranchMark | null;
  /** Mirrors the source sheet's numbering on imports; sequential otherwise; blank when the sheet had none. */
  displayNumber: string;
  children: React.ReactNode;
  selected: boolean;
  active: boolean;
  next: boolean;
  /** Pre-show walkthrough cursor sits on this row. */
  walk: boolean;
  /** This row is part of the timing-check issue on screen. */
  gapMark?: "from" | "to" | null;
  paused: boolean;
  mine: boolean;
  mineColor: string;
  /** Event-local "now" sits at this row per the TIME column. */
  clockMark: boolean;
  /** Titles of the rows this one shares its window with, if any. */
  runsWith?: string[];
  /** This row's window contains the event clock right now. */
  onNow: boolean;
  disabled: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled });
  return (
    <tr
      ref={setNodeRef}
      className={`${row.type === "group" ? "group-row" : ""} ${row.type === "milestone" ? "milestone-row" : ""} ${selected ? "selected" : ""} ${active ? "active-row" : ""} ${next ? "next-row" : ""} ${walk ? "walk-row" : ""} ${gapMark ? `gap-row gap-row-${gapMark}` : ""} ${active && paused ? "paused" : ""} ${mine ? "my-role-row" : ""} ${row.skipped ? "skipped-row" : ""} ${row.parallel ? "parallel-row" : ""} ${runsWith?.length ? "concurrent-row" : ""} ${onNow && !active ? "on-now" : ""} ${clockMark ? "clock-row" : ""} ${
        branch
          ? `branch-row oc-rail-${branch.outcome} ${branch.opens ? "branch-open" : ""} ${branch.closes ? "branch-close" : ""} ${branch.blockOpens ? "branch-block-open" : ""} ${branch.blockCloses ? "branch-block-close" : ""} ${branch.dim ? "branch-dim" : ""}`
          : ""
      }`}
      data-rowid={row.id}
      data-tip={
        walk
          ? "Walkthrough position — synced to every screen"
          : runsWith?.length
            ? `Runs at the same time as ${runsWith.slice(0, 3).join(", ")}${runsWith.length > 3 ? ` and ${runsWith.length - 3} more` : ""}`
            : row.parallel
              ? "Pre-record — runs alongside the show, takes no time in the running order"
              : clockMark
              ? "Event time is here per the TIME column"
              : undefined
      }
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
        background: mine ? `${mineColor}14` : row.type !== "group" && row.color ? row.color : undefined,
        boxShadow: mine ? `inset 3px 0 0 ${mineColor}` : undefined,
      }}
    >
      {/* useSortable makes this cell a role="button", and its only text is the
          row number — so on a sheet that came in unnumbered, or on a group
          heading, it is a button called nothing at all. The label goes AFTER
          the spread so it wins, and names the row by whatever the row has:
          its number, else its title. */}
      <td
        className="row-number mono"
        onClick={onSelect}
        {...attributes}
        {...listeners}
        aria-label={`Select or drag ${displayNumber ? `row ${displayNumber}` : row.title ? `row: ${row.title}` : "this row"}`}
      >
        <span className="rn-num">{displayNumber}</span>
        {active && <span className="cue-badge">CUE</span>}
        {!active && row.outcome && (branch?.opens ?? true) && (
          <span
            className={`outcome-chip oc-${row.outcome}`}
            data-tip="One of several alternate endings, stacked here because only one of them will be called. They all start at the same moment; picking a result plays this branch and skips the rest."
          >
            {row.outcome === "win" ? "WIN" : row.outcome === "lose" ? "LOSE" : row.outcome === "golden" ? "GP" : row.outcome === "draw" ? "DRAW" : row.outcome}
          </span>
        )}
      </td>
      {children}
    </tr>
  );
}

/** Deep-copies the cell fragments of a row into a fresh Y.Map. */
function cloneRow(source: Y.Map<unknown>, newId: string): Y.Map<unknown> {
  const copy = new Y.Map();
  copy.set("id", newId);
  for (const field of ["type", "hardStartSec", "durationSec", "durationMuted", "durationHidden", "backtime", "color", "outcome", "parallel", "spans"]) {
    const v = source.get(field);
    if (v !== undefined) copy.set(field, v);
  }
  const cells = new Y.Map<Y.XmlFragment>();
  const sourceCells = source.get("cells") as Y.Map<Y.XmlFragment> | undefined;
  sourceCells?.forEach((fragment, columnId) => {
    const target = new Y.XmlFragment();
    try {
      target.insert(0, fragment.toArray().map((node) => node.clone() as Y.XmlElement | Y.XmlText));
    } catch {
      // Fall back to plain text if a node type refuses to clone.
    }
    cells.set(columnId, target);
  });
  copy.set("cells", cells);
  return copy;
}

/** The ad-hoc cue pool is parked (kept in code, hidden in the UI). */
const CUE_POOL_ENABLED = false;

const HIDDEN_COLS_KEY = (rundownId: string) => `oc:hiddencols:${rundownId}`;
const COL_WIDTHS_KEY = (rundownId: string) => `oc:colwidths:${rundownId}`;

/** What the fixed columns cost, for working out how many others still fit. */
/**
 * The fixed columns, including the cell padding a value has to live inside.
 *
 * Two sets, because a width that fits "12:00:00 AM" comfortably on a laptop
 * is most of a phone. On the narrow set the number reads downwards and the
 * type is a size smaller, so the same values still fit.
 */
const COL_W_WIDE = { rownum: 46, time: 120, dur: 78, extra: 118 } as const;
const COL_W_NARROW = { rownum: 26, time: 88, dur: 58, extra: 96 } as const;
/** Below this the sheet is on a phone, whichever way up it is held. */
const NARROW_GRID = 560;

/**
 * Where the cue sits in the sheet — one place, and a row's height gets no vote.
 *
 * The old sum centred the row's MIDDLE: it subtracted half of the row's OWN
 * height, so the row's TOP landed somewhere different for every row. Measured
 * on a real sheet in an 803px viewport, rows run 32px to 95px tall and the
 * cue's top landed anywhere between 386px and 354px — it walked up and down the
 * screen as the show advanced through short cues and three-line notes. The eye
 * tracks the top edge of the highlighted row, so that reads as a sheet that
 * never settles.
 *
 * Centring a NOMINAL row instead of the real one pins the position while
 * keeping "middle" true: an ordinary row still lands centred, and a tall one
 * extends further down from the same starting line — which is the right way
 * round, because a long row is read from its top.
 *
 * Every path that moves the sheet to the cue goes through this: the exact
 * centring, and the approximate jump the row window makes when the live row is
 * not drawn yet. Those two used to disagree — the jump aimed at half the
 * viewport, 401px here, against 354-386 for the centring — so the sheet landed
 * in one place and then shifted up to 47px to its final one. One anchor now,
 * so there is nothing to settle.
 */
const NOMINAL_ROW_PX = 44;
/**
 * `obscuredBottom` is the part of the sheet something is sitting on top of.
 *
 * "You're on" and the timing nudges are docked to the bottom of the SCREEN, so
 * they cover the last stretch of the sheet without shortening it — the
 * scroller's height does not change, but what you can see does. Centring in the
 * full height therefore parked the cue below the middle of the part still
 * visible, and it appeared to drop the moment the bar arrived. Centre in what
 * is left.
 */
const cueAnchorTop = (viewportH: number, obscuredBottom = 0): number =>
  Math.max(0, (viewportH - obscuredBottom - NOMINAL_ROW_PX) / 2);

/**
 * A position inside the sheet, held clear of the pinned column headers.
 *
 * Things that ride a row — the hover nudge strip — are absolutely positioned
 * inside `.grid-scroll`, so they are laid out in the sheet's CONTENT
 * coordinates and travel with the row they point at. `tr.offsetTop` knows
 * nothing about how far the sheet has been scrolled, so the moment its row
 * slides up under the pinned header the thing goes with it — and the nudge
 * strip carries a higher z-index than the header (7 against 5), so it paints
 * ON TOP of the column titles rather than disappearing behind them. One notch
 * of the wheel with the pointer parked on a row does it, and so does
 * clock-follow scrolling the sheet by itself.
 *
 * The header's bottom edge is MEASURED, never named: its height is whatever
 * its cell padding and font come to, and the phone breakpoint changes that
 * padding. A constant would be right on one screen and wrong on the next.
 *
 * Measured against the scroller's PADDING edge — `clientTop` is the top border,
 * which `getBoundingClientRect` includes and `offsetTop`, `scrollTop` and an
 * absolute `top` all exclude. `.grid-scroll` carries no border today, so this
 * term is zero; it is here so that adding one later cannot quietly shift the
 * strip by the border's width.
 */
const clampBelowHeader = (scroller: HTMLElement, rowTop: number): number => {
  /**
   * The STICKY cell, not the row that contains it.
   *
   * This measured `thead`, which looks like the header and is not the thing
   * that stays put: `position: sticky` is on the `th` cells, and the `thead`
   * around them is static, so it scrolls away with the rest of the table.
   * Measured on a real sheet at scrollTop 300: the `thead` box had already
   * left the viewport (bottom −81) while the pinned cells sat at 218. The
   * clamp therefore computed a header height of 0 the instant the sheet
   * moved, went inert, and let the strip ride up over the column titles it
   * exists to stay clear of — 38px of overlap on a 40px header, painted on
   * top of it because the strip outranks it (z-index 7 against 5).
   *
   * Correct at rest, wrong the moment anybody scrolled: which is why reading
   * the code convinced two people it worked.
   */
  const cell = scroller.querySelector("thead th");
  const paddingTop = scroller.getBoundingClientRect().top + scroller.clientTop;
  const headerBottom = cell ? Math.max(0, cell.getBoundingClientRect().bottom - paddingTop) : 0;
  return Math.max(rowTop, scroller.scrollTop + headerBottom);
};

/**
 * Progress-bar fill that only ever animates forwards. Chrome will start the
 * CSS width transition from the previous fill's value even across a remount,
 * so on a row change the bar visibly receded instead of snapping to zero —
 * the transition is disabled inline whenever the fraction shrinks (and on
 * first paint), which prevents any width transition from starting.
 */
function BarFill({ frac, className }: { frac: number; className?: string }) {
  const prevRef = useRef<number | null>(null);
  const snap = prevRef.current == null || frac < prevRef.current;
  useLayoutEffect(() => {
    prevRef.current = frac;
  });
  return <div className={className} style={{ width: `${frac * 100}%`, transition: snap ? "none" : undefined }} />;
}

/**
 * The unmissable clock: fixed centre-top while the show runs. Counts down the
 * active item (green → amber in the final stretch → red counting up on
 * overrun), dims amber while paused.
 */
function BigTimer({
  live,
  paused,
  title,
  plannedSec,
  nextTitle,
}: {
  live: import("@opencall/core").LiveShowTiming;
  paused: boolean;
  title: string;
  plannedSec: number | null;
  /** What is coming — see the note by the markup. */
  nextTitle?: string | null;
}) {
  const remaining = live.remainingInRowSec;
  const over = remaining != null && remaining < 0;
  // The red state waits a full second past zero so a cue handing over to the
  // next row (follow-clock advances within a second) never flashes red.
  const overLate = remaining != null && remaining < -1;
  const amber =
    !over && remaining != null && plannedSec != null && plannedSec > 0 && remaining <= Math.min(60, plannedSec * 0.2);
  const display =
    remaining == null
      ? formatDuration(Math.round(live.elapsedInRowSec))
      : over
        ? `+${formatDuration(live.rowOverSec)}`
        : formatDuration(remaining);
  const stateClass = paused ? "paused-state" : overLate ? "over" : amber || over ? "amber" : "under";
  const frac =
    plannedSec != null && plannedSec > 0 ? Math.min(1, Math.max(0, live.elapsedInRowSec / plannedSec)) : 0;
  return (
    <div className={`big-timer no-print ${stateClass}`}>
      {/* What comes next, under what is on air.
          "What's after this?" is the question a showcaller is actually asked,
          and the answer used to be somewhere in a table they had to find their
          place in. The item just FINISHED was here too for a while, above the
          line, and it earned its space less than it cost: nobody asks what has
          already happened, and on the biggest readout on the page a third line
          of text is a third thing to read past. Dimmer than the item on air,
          deliberately — it is context, and the eye must not be pulled off the
          thing being called. */}
      <div className="bt-label">
        {paused ? "PAUSED · " : ""}
        {title || "—"}
      </div>
      <div className="bt-time">{display}</div>
      <div className="bt-bar">
        <BarFill frac={frac} />
      </div>
      {nextTitle && <div className="bt-neighbour bt-then">{nextTitle}</div>}
    </div>
  );
}

/**
 * The wait, in the same place the item timer lives.
 *
 * A show can be live before its first item is due — the doors are open, the
 * crew are on comms, and the opener is still hours away. The biggest readout
 * on the page should answer the question actually being asked then, which is
 * "how long have we got", not "how is the current item going" about an item
 * nobody has called.
 *
 * Deliberately the same shape and position as the item timer rather than a
 * notice somewhere else: it is the same slot answering the same question at a
 * different moment, and moving it would make the page rearrange itself at the
 * exact second the show begins.
 */
function ShowCountdown({ waitSec, title }: { waitSec: number; title: string }) {
  return (
    <div className="big-timer no-print under">
      <div className="bt-label">TILL SHOW STARTS</div>
      <div className="bt-time">{formatDuration(Math.round(waitSec))}</div>
      <div className="bt-sub">{title}</div>
    </div>
  );
}

/**
 * Timing nudges for one row: take seconds out or put them in when the show
 * runs ahead or behind, or pin the row to the clock with CUE. Seconds, not
 * minutes — these are live corrections.
 */
function TimingNudge({
  onNudge,
  onCue,
  disabled,
  /** Rows a cue here would drop. 0 = this is the live row, so nothing changes on air. */
  skips = 0,
}: {
  onNudge: (deltaSec: number) => void;
  onCue: () => void;
  disabled?: boolean;
  skips?: number;
}) {
  // Taking an item early changes what is on air and drops what it passes, so
  // it asks once. Re-timing the live row changes nothing on air and does not.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 6000);
    return () => window.clearTimeout(t);
  }, [armed]);
  return (
    <div className="timing-nudge" onPointerDown={(e) => e.stopPropagation()}>
      {[-30, -15, -5].map((d) => (
        <button
          key={d}
          type="button"
          className="tn-btn"
          disabled={disabled}
          data-tip={`Take ${-d} seconds out of this item`}
          onClick={() => onNudge(d)}
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        className={`tn-btn tn-cue ${armed ? "armed" : ""}`}
        disabled={disabled}
        data-tip={
          skips > 0
            ? `Take this item NOW — the show jumps here, the ${skips} item${skips === 1 ? "" : "s"} in between are marked as not run, and everything below re-times`
            : "This item is happening NOW — pin it to the clock and re-time everything below it"
        }
        onClick={() => {
          if (skips > 0 && !armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          onCue();
        }}
      >
        {armed ? `Skip ${skips}?` : "CUE"}
      </button>
      {[5, 15, 30].map((d) => (
        <button
          key={d}
          type="button"
          className="tn-btn"
          disabled={disabled}
          data-tip={`Give this item ${d} more seconds`}
          onClick={() => onNudge(d)}
        >
          +{d}
        </button>
      ))}
    </div>
  );
}

export type EditorMode = "show" | "edit" | "view";

export function RundownEditor({
  rundownId,
  mode = "show",
  joinCode,
  initialEpoch,
  initialViewingClosed,
}: {
  rundownId: string;
  mode?: EditorMode;
  joinCode?: string;
  /** Both answered by the server render where it can be — see the show page. */
  initialEpoch?: number;
  initialViewingClosed?: boolean;
}) {
  const isShow = mode === "show";
  /**
   * One editor at a time — on the EDITING surface only.
   *
   * The showcaller console is deliberately outside this. I first took the lock
   * on every surface that can change a sheet, console included, and it cost
   * the console its CUE buttons, its timing nudges, its Undo and its "Edit
   * sheet" toggle the moment somebody else held the lock. A live console that
   * cannot cue is a far worse fault than two people editing a sheet, which is
   * the whole reason the transport was never supposed to be locked.
   *
   * So: /edit takes the lock and honours it. /show never does — whoever is
   * calling the show keeps every control they had.
   */
  const mayEditSheet = mode === "edit";
  const lock = useEditLock(rundownId, mayEditSheet);
  const canEditContent = mode === "show" ? true : mayEditSheet ? lock.mine : false;
  const { doc, revision, connected, synced, status: docStatus } = useRundownDoc(rundownId, joinCode, initialEpoch);
  /**
   * Read the whole document once per CHANGE, not once per render.
   *
   * These two lines used to run bare in the render body, on the reasoning that
   * the hook re-renders on every update so projecting during render stays
   * fresh. It does stay fresh — and it also re-walks all 3,321 rows every time
   * anything at all re-renders this component, which on this screen is often:
   * a clock tick, a hover, a panel opening, a measurement settling.
   *
   * `revision` is the key, not `doc`. A `Y.Doc` is the same object before and
   * after an edit, so memoising on `doc` would never recompute and would be
   * silently, dangerously wrong.
   *
   * This also repairs the memo below it. `rowNumFloor` is a `useMemo` on
   * `[rows]` that could never once have hit, because `rows` was a brand-new
   * array on every render — it read as memoised and was not. Anything else
   * keyed on `rows` was in the same position. Making `rows` stable between
   * changes is what actually makes those caches work.
   */
  const { meta, keyTimes, roles, columns, rows } = useMemo(
    () => projectRundownDoc(doc),
    [doc, revision],
  );
  const timing = useMemo(() => computeTiming(rows, meta.plannedStartSec), [rows, meta.plannedStartSec]);
  const channel = useShowChannel(rundownId, "console", joinCode);
  // Panel API calls (join codes, snapshots…) inherit this page's code.
  useEffect(() => {
    setActiveJoinCode(joinCode ?? null);
    return () => setActiveJoinCode(null);
  }, [joinCode]);
  /**
   * What kind of show THIS sheet is, resolved once for the whole screen.
   *
   * A kind a company added for itself arrives whole over the channel, because
   * this client has no list to look it up in. Resolving here rather than at
   * each use means a custom type reaches the result chooser, the extra-period
   * label and the blurb by the same path a built-in one does — there is no
   * second code path to forget about.
   */
  const customTypes = useMemo(
    () => (channel.eventTypeSpec ? [channel.eventTypeSpec] : []),
    [channel.eventTypeSpec],
  );
  const showType = useMemo(
    () => resolveEventType(channel.sport, customTypes),
    [channel.sport, customTypes],
  );
  const live = useLiveTiming(channel, timing);
  const showIsLive = channel.show?.state === "running" || channel.show?.state === "paused";
  const activeRowId = showIsLive ? channel.show!.activeRowId : null;
  // Pre-show walkthrough cursor — shared across every connected device.
  const walkRowId = !activeRowId ? (channel.show?.walkRowId ?? null) : null;
  const [activeCell, setActiveCell] = useState<ActiveCell>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [lastSelected, setLastSelected] = useState<string | null>(null);
  const [editingTime, setEditingTime] = useState<string | null>(null); // rowId
  /**
   * Which of the two ending layouts this device is using.
   *
   * Per device rather than per sheet, and deliberately not synced: the point is
   * to run the same sheet both ways and compare, which needs two screens
   * disagreeing. Read after mount so the server render and the first client
   * render match.
   */
  const [outcomeLayout, setOutcomeLayout] = useState<OutcomeLayout>("layers");
  useEffect(() => {
    const saved = window.localStorage.getItem(OUTCOME_LAYOUT_KEY);
    if (saved === "fork" || saved === "layers") setOutcomeLayout(saved);
  }, []);
  const chooseOutcomeLayout = (v: OutcomeLayout): void => {
    setOutcomeLayout(v);
    window.localStorage.setItem(OUTCOME_LAYOUT_KEY, v);
  };
  const [durationPopover, setDurationPopover] = useState<string | null>(null); // rowId
  const [panel, setPanel] = useState<"history" | "join" | "info" | null>(null);
  const [reconciling, setReconciling] = useState(false);
  // The timing-check issue currently on screen: its rows are highlighted in
  // the grid and the disagreeing row is scrolled into view.
  const [gapFocus, setGapFocus] = useState<{ fromId: string; toId: string } | null>(null);
  // Someone may be mid-reconcile when the show is called. Close it for them.
  const liveNow = channel.show?.state === "running" || channel.show?.state === "paused";
  useEffect(() => {
    if (!liveNow) return;
    setReconciling(false);
    setGapFocus(null);
  }, [liveNow]);
  // Row the timing nudges act on when hovering (pointer devices). `top` is the
  // row's own offset inside the scroller; where the strip is DRAWN is
  // `nudgeTop` below, which holds that offset clear of the pinned header.
  const [nudgeRowAt, setNudgeRowAt] = useState<{ id: string; top: number } | null>(null);
  // The selection bar floats just BELOW the last selected row — never on top
  // of the rows being acted on — inside the scroller so it moves with them.
  const [selBarTop, setSelBarTop] = useState(36);
  useEffect(() => {
    if (selected.size === 0) return;
    const trs = document.querySelectorAll(".rundown-grid tbody tr.selected");
    const last = trs[trs.length - 1] as HTMLElement | undefined;
    if (last) setSelBarTop(last.offsetTop + last.offsetHeight + 4);
  }, [selected, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!gapFocus) return;
    const gapRow = document.querySelector("tr.gap-row-to");
    if (gapRow) centreInSheet(gapRow);
  }, [gapFocus?.toId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [hiddenCols, setHiddenCols] = useState<ReadonlySet<string>>(new Set());
  /**
   * A view-only link decides what it may show.
   *
   * The list on the link is what to SHOW, so everything else is hidden — and
   * when the link says nothing, the phone-shaped default applies, because a
   * link is opened on a phone at the side of a pitch far more often than on a
   * desk. Whoever shared it can add columns; nobody holding it can.
   */
  /**
   * What this link may show, asked for here rather than handed down.
   *
   * The view page is a server component, and a server component cannot pass a
   * function across the boundary to fetch it — the editor already holds the
   * code, so it is the right place to ask.
   */
  const [viewColumns, setViewColumns] = useState<string[] | null>(null);
  useEffect(() => {
    if (mode !== "view" || !joinCode) return;
    void api
      .resolveCode(joinCode)
      .then((r) => setViewColumns(r.columns ? Object.keys(r.columns) : null))
      .catch(() => setViewColumns(null));
  }, [mode, joinCode]);



  useEffect(() => {
    if (mode !== "view" || columns.length === 0) return;
    const show = new Set(
      viewColumns && viewColumns.length > 0
        ? viewColumns
        : defaultViewColumns(
            columns.map((c) => ({ key: c.key, kind: c.kind })),
            meta.roleColumnKeys,
          ),
    );
    setHiddenCols(new Set(columns.filter((c) => !show.has(c.key)).map((c) => c.key)));
    // Columns arrive with the document; the link's list never changes after.
  }, [mode, columns.length, viewColumns?.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // Per-user column width overrides (drag the header edges); imported sheets
  // still provide the starting widths.
  const { widths: colWidths, handle: resizeHandle, tableStyle } = useColWidths(COL_WIDTHS_KEY(rundownId));
  const [showZero, setShowZero] = useState(false);
  const [followScroll, setFollowScroll] = useState(true);
  // A user can hold several roles at once (Camera 1 AND PA). Stored per browser.
  const [myRoles, setMyRoles] = useState<string[]>([]);

  /**
   * Tell the showcaller what this viewer says they are covering.
   *
   * The role picker was per-browser and went no further, so a showcaller could
   * see that eight people had the sheet open and not which of them was on
   * camera. Sent whenever it changes, and only from a link — someone signed in
   * is already on the crew list by name.
   */
  useEffect(() => {
    if (mode !== "view" || !joinCode) return;
    const known = viewerName();
    if (!known) return; // the gate has not been answered yet
    void api.recordViewer(joinCode, { ...describeDevice(known), roles: myRoles }).catch(() => {
      // Never worth interrupting someone reading a run sheet over.
    });
  }, [mode, joinCode, myRoles.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  // Touch devices have no hover, so the nudges dock at the bottom instead —
  // clear of the role bar, which is also fixed to the bottom.
  // Sheet-building controls are tucked away while the show is live.
  const [editTools, setEditTools] = useState(false);
  const [dockBottom, setDockBottom] = useState(0);
  /**
   * Publishes a fixed bar's height as a CSS variable.
   *
   * Three things are pinned to the bottom of this screen — the role bar, the
   * cue-point dock and the result chooser — and each has to know how tall the
   * ones below it are, or they stack on top of each other and the sheet ends
   * underneath them. A row hidden behind a bar is a row not read.
   */
  const publishHeight = (name: string) => (el: HTMLDivElement | null) => {
    const root = document.documentElement;
    if (!el) {
      root.style.removeProperty(name);
      return;
    }
    const measure = () => root.style.setProperty(name, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    measure();
    new ResizeObserver(measure).observe(el);
  };
  const publishNudgeHeight = useCallback(publishHeight("--nudgedock-h"), []);
  const publishOutcomeHeight = useCallback(publishHeight("--outcomedock-h"), []);
  useEffect(() => {
    const measure = () => {
      const bar = document.querySelector(".role-bar") as HTMLElement | null;
      setDockBottom(bar ? Math.ceil(bar.getBoundingClientRect().height) : 0);
    };
    measure();
    const bar = document.querySelector(".role-bar");
    if (!bar) return;
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [myRoles.length, activeRowId]);
  /**
   * The event clock, held as state instead of read during render.
   *
   * `channel.serverNow()` is `Date.now()` plus the measured offset to the sync
   * host. Calling it in the render body means the server's render and the
   * browser's first render compute different numbers from the same code, and
   * every readout below that derives from it — the clock cursor in the TIME
   * column, the countdown to the first cue, the "on now" marks — renders
   * different text on each side. That is a hydration mismatch (React #418),
   * and it is only latent because the document is empty when the page is
   * server-rendered: with no rows, none of those readouts appear. The moment
   * the sheet arrives with the HTML it would fire on every load.
   *
   * So: `null` until mounted, exactly the way the side nav starts closed
   * before reading localStorage, and everything derived from it treats null as
   * "not known yet" rather than inventing a time. The interval then keeps it
   * moving — reading once on mount and stopping would freeze the clock cursor
   * where the page happened to open, which is worse than the mismatch.
   *
   * The 15-second cadence is the one this has always run at, unchanged here.
   * Once a row is on air `useLiveTiming` re-renders the sheet whenever a
   * displayed second changes, so this interval only governs the stretches when
   * nothing is live.
   */
  const [nowMs, setNowMs] = useState<number | null>(null);
  // Read through a ref: `channel` is a fresh object every render, so an
  // interval that depended on it would be torn down and rebuilt constantly.
  const serverNowRef = useRef(channel.serverNow);
  serverNowRef.current = channel.serverNow;
  useEffect(() => {
    const read = () => setNowMs(serverNowRef.current());
    read();
    const id = window.setInterval(read, 15000);
    return () => window.clearInterval(id);
  }, []);
  // Phones show only the essentials (title/start/duration + the role column);
  // this opts back into the full sheet.
  /**
   * The grid's own width, watched so the column folding can react to a window
   * resize or a phone turning sideways without a reload.
   */
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const measureGrid = useCallback((el: HTMLDivElement | null) => {
    setGridEl(el);
    if (!el) return;
    const read = () => setGridWidth(el.clientWidth);
    read();
    new ResizeObserver(read).observe(el);
  }, []);

  /**
   * Where the hover nudge strip is actually drawn (see `clampBelowHeader`).
   *
   * This has to be state, not a render-body calculation, because it follows
   * the SCROLL and a scroll is not a render. Storing the already-clamped
   * position rather than the scroll offset is what keeps that cheap: while the
   * row is below the header the clamp is not biting, the value does not
   * change, and React bails out of the update — so scrolling with the pointer
   * resting on a row costs no renders at all until the strip reaches the
   * header. Set on hover as well, in the same event as `nudgeRowAt`, so the
   * strip is never painted once at the previous row's position first.
   *
   * Lives here rather than beside `nudgeRowAt` because it needs `gridEl`,
   * which is declared just above.
   */
  const [nudgeTop, setNudgeTop] = useState(0);
  useEffect(() => {
    if (!nudgeRowAt || !gridEl) return;
    const clamp = () => setNudgeTop(clampBelowHeader(gridEl, nudgeRowAt.top));
    clamp();
    gridEl.addEventListener("scroll", clamp, { passive: true });
    return () => gridEl.removeEventListener("scroll", clamp);
    // `nudgeRowAt` is replaced only when the hovered ROW changes (the handler
    // checks the id first), so depending on the object does not re-subscribe
    // on every render.
  }, [nudgeRowAt, gridEl]);

  /**
   * Render only the rows near the viewport. ON.
   *
   * Measured on a real 3,321-row sheet in production, same page and network,
   * this flag the only difference:
   *
   *                        all rows      windowed
   *     main thread busy   15,894 ms       67 ms
   *     blocking time       5,894 ms       17 ms
   *     long tasks              200           1
   *
   * Sixteen seconds of a console that will not answer a click, every time
   * somebody opens a big sheet, against sixty-seven milliseconds.
   *
   * It was opt-in until now for one honest reason: the browser's own find
   * cannot match rows that are not in the page, and it fails silently. That is
   * fixed rather than tolerated — `useRowWindow` watches for the find key and
   * renders the whole sheet before the find bar opens, so Ctrl-F searches
   * everything, as it always did. Printing already worked the same way.
   *
   * The switch stays, pointing the other way, because a flag you can turn OFF
   * mid-event is worth keeping on a live tool:
   *
   *     localStorage.setItem("oc:virtualrows", "0")   // render every row
   *     localStorage.removeItem("oc:virtualrows")     // back to the default
   */
  const [virtualRows, setVirtualRows] = useState(true);
  useEffect(() => {
    setVirtualRows(localStorage.getItem("oc:virtualrows") !== "0");
  }, []);
  const rowWindow = useRowWindow({ count: rows.length, scrollEl: gridEl, enabled: virtualRows });
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  /**
   * Always the LATEST window, for code that runs after its render.
   *
   * `offsetOf` is only as good as the heights measured so far, and on first
   * load none are: every row is the 34px guess against a real average nearer
   * 44, which on row 2,400 is ten thousand pixels of error. That corrects
   * itself as rows render and report — but a retry that closed over the FIRST
   * window kept re-using the first guess, so the follow scrolled to the same
   * wrong place twenty times and gave up. Read through a ref and each attempt
   * gets the heights learned by the one before it, which converges in two or
   * three goes instead of never.
   */
  const rowWindowRef = useRef(rowWindow);
  rowWindowRef.current = rowWindow;

  /**
   * Tell the window how tall the rows it drew actually are.
   *
   * A row can render as two `<tr>`s — an alternate-ending banner sits above the
   * row it introduces — and both belong to the same row's height, or the
   * spacers come up short and the scrollbar drifts.
   */
  useEffect(() => {
    const tb = tbodyRef.current;
    if (!tb || !rowWindow.active) return;
    const indexOf = new Map(rows.map((r, i) => [r.id, i]));
    const seen = new Map<number, number>();
    for (const tr of tb.querySelectorAll<HTMLTableRowElement>("tr[data-rowid]")) {
      const i = indexOf.get(tr.dataset.rowid ?? "");
      if (i == null) continue;
      let h = tr.getBoundingClientRect().height;
      const prev = tr.previousElementSibling;
      if (prev?.classList.contains("layer-row")) h += prev.getBoundingClientRect().height;
      seen.set(i, h);
    }
    if (seen.size > 0) rowWindow.report(seen);
  });
  // Set after mount: locale-formatted dates differ between server and client,
  // and rendering one during SSR causes a hydration mismatch.
  const [printedAt, setPrintedAt] = useState("");
  useEffect(() => {
    setPrintedAt(new Date().toLocaleString());
  }, []);
  const timeInputRef = useRef<HTMLInputElement>(null);

  // Per-user column visibility, loaded after mount to avoid hydration mismatch.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HIDDEN_COLS_KEY(rundownId));
      if (raw) setHiddenCols(new Set(JSON.parse(raw) as string[]));
      setShowZero(localStorage.getItem(`oc:zerocol:${rundownId}`) === "1");
      const storedRoles = localStorage.getItem(`oc:myrole:${rundownId}`);
      if (storedRoles) {
        try {
          const parsed = JSON.parse(storedRoles) as unknown;
          setMyRoles(Array.isArray(parsed) ? (parsed as string[]) : [storedRoles]);
        } catch {
          setMyRoles([storedRoles]); // pre-multi-role value: a bare string
        }
      }
    } catch {
      /* ignore */
    }
  }, [rundownId]);

  const toggleColumn = (key: string): void => {
    const next = new Set(hiddenCols);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHiddenCols(next);
    localStorage.setItem(HIDDEN_COLS_KEY(rundownId), JSON.stringify([...next]));
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  /**
   * Centre a row WITHIN THE SHEET, never by scrolling the page.
   *
   * scrollIntoView walks up and scrolls every scrollable ancestor it finds, so
   * on a phone — where the document can still shift by a few hundred pixels —
   * syncing to the cue also dragged the clock and the transport off the top of
   * the screen. The sheet has its own scroller; that is the only thing that
   * should move.
   */
  const centreInSheet = (el: Element): void => {
    const scroller = el.closest(".grid-scroll") as HTMLElement | null;
    if (!scroller) return;
    const row = el.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    const target = scroller.scrollTop + (row.top - box.top) - cueAnchorTop(box.height, dockBottom);
    /**
     * Instantly, NOT smoothly — because the sheet is windowed.
     *
     * Only a slice of the rows is really in the DOM; everything above is a
     * spacer whose height comes from the AVERAGE of the rows measured so far
     * (see useRowWindow). A smooth scroll animates towards a pixel offset over
     * several hundred milliseconds, and during that time new rows enter the
     * slice, get measured, and move that average — so every offset above the
     * target shifts while the browser is still travelling to the old one. It
     * arrives in the wrong place, the follow effect notices and corrects, and
     * the row appears to hop about on every cue change.
     *
     * A jump gives that no window in which to happen: one move, then the slice
     * settles. There is nothing to soften anyway — the cue changing IS the
     * event, and a showcaller wants the row where they are already looking
     * rather than a half-second of travel.
     */
    scroller.scrollTo({ top: Math.max(0, target), behavior: "auto" });
  };

  // Auto-scroll keeps the active row centered while following. A manual
  // scroll (wheel/touch) disengages following instead of fighting the user;
  // the floating "Sync Cue" button re-engages it.
  const programmaticScroll = useRef(false);

  /**
   * Put this screen back on the cue — and check what the cue IS on the way.
   *
   * There were two buttons here. "Sync Cue" scrolled back to the row this
   * screen already believed was live; "Sync my screen" dropped the socket and
   * asked the server. Both finished by centring the active row, so whenever
   * the screen was RIGHT — which is nearly always — they did visibly the same
   * thing. The difference only appeared on the night the screen was wrong,
   * which is the worst imaginable night to be choosing between two similar
   * buttons.
   *
   * So: one action. Ask the server, then take me there. The reconnect costs a
   * moment and is invisible when nothing is wrong, which is a fair price for
   * never having to know which button was the one that actually fixed it.
   *
   * Still this screen only. A button that pushed one laptop's idea of the cue
   * to everybody would let a confused laptop move a live show.
   */
  const syncToCue = () => {
    channel.resync();
    setFollowScroll(true);
    programmaticScroll.current = true;
    window.setTimeout(() => {
      const live = document.querySelector("tr.active-row");
      if (live) {
        centreInSheet(live);
      } else {
        // Same as the follow: under a window the live row may not be drawn, so
        // go to where it will be and let the follow effect centre it.
        const i = rows.findIndex((r) => r.id === activeRowId);
        const win = rowWindowRef.current;
        if (i >= 0 && gridEl)
          gridEl.scrollTo({ top: Math.max(0, win.offsetOf(i) - cueAnchorTop(gridEl.clientHeight, dockBottom)) });
      }
      programmaticScroll.current = false;
    }, 400);
  };
  const focusRowId = activeRowId ?? walkRowId;
  /**
   * BEFORE the browser paints, not 150ms after it.
   *
   * This was a `useEffect` whose retry ran on a timer, and `rows.length` was
   * not among its dependencies. So opening a live sheet went: rows commit, the
   * browser PAINTS them at scroll position zero, and a tenth of a second later
   * the loop noticed and moved. That painted frame at the top is the "starts at
   * the top, then syncs, then travels down" — the scroll was never slow, it was
   * simply too late.
   *
   * A layout effect runs after the DOM is committed and before the paint, so
   * with `rows.length` in the dependencies the position is set in the same
   * frame the rows appear in. The first thing drawn is the cue, already in
   * place. The retry underneath is unchanged and still earns its keep for the
   * case it was written for: the row arriving outside the rendered window.
   */
  useLayoutEffect(() => {
    if (!focusRowId || !followScroll) return;
    // Opening a rundown that is ALREADY live: the show state often arrives
    // before the document's rows have rendered, so retry until the live row
    // exists — first thing on screen is the current cue, centred.
    let cancelled = false;
    let settle: number | undefined;
    let refine: number | undefined;
    const attempt = (left: number) => {
      if (cancelled) return;
      const el = document.querySelector("tr.active-row, tr.walk-row");
      if (el) {
        programmaticScroll.current = true;
        centreInSheet(el);
        /**
         * Then again, once the rows have actually been measured.
         *
         * Placing before the paint is what stops the sheet being drawn at the
         * top — but it also means placing while the windowed list is still
         * using ESTIMATED row heights for everything above the cue. The first
         * placement is therefore approximately right and can be a long way out
         * on a sheet of tall rows: measured here at 734px down an 857px
         * viewport, when the cue belongs near the middle.
         *
         * So: place early so nothing is drawn in the wrong place, and refine
         * once the real heights are in. Both passes are inside the
         * `programmaticScroll` window, so neither is mistaken for the reader
         * scrolling and neither disengages the follow.
         */
        refine = requestAnimationFrame(() => {
          const settled = document.querySelector("tr.active-row, tr.walk-row");
          if (settled) centreInSheet(settled);
        });
        settle = window.setTimeout(() => {
          const settledLate = document.querySelector("tr.active-row, tr.walk-row");
          if (settledLate) centreInSheet(settledLate);
          programmaticScroll.current = false;
        }, 400);
        return;
      }
      /**
       * The row is not rendered — so go to where it WILL be.
       *
       * Under a window the cue can move outside the rendered slice, and then
       * there is no element to centre: this retried twenty times, found
       * nothing, and stopped. The sheet kept perfect time and simply stopped
       * showing where it was, which reads exactly like the sync having died.
       *
       * The window knows every row's offset whether it is drawn or not, so
       * scroll there first. That brings the row into the slice, the next
       * attempt finds a real element, and it gets centred properly — an
       * approximate jump followed by an exact one.
       */
      const win = rowWindowRef.current;
      const i = rows.findIndex((r) => r.id === focusRowId);
      if (win.active && i >= 0 && gridEl) {
        programmaticScroll.current = true;
        const rowTop = win.offsetOf(i);
        gridEl.scrollTo({ top: Math.max(0, rowTop - cueAnchorTop(gridEl.clientHeight, dockBottom)), behavior: "auto" });
      }
      if (left > 0) settle = window.setTimeout(() => attempt(left - 1), 150);
      else programmaticScroll.current = false;
    };
    attempt(40);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
      if (refine != null) cancelAnimationFrame(refine);
    };
    // `dockBottom` is in here so the cue re-centres the moment "You're on"
    // arrives or leaves. That bar covers the bottom of the sheet without
    // shortening it, so the middle of what you can SEE moves — and a cue that
    // was centred a second ago is suddenly sitting low, at the exact moment
    // the screen is telling somebody they are on.
    // `rows.length` so this re-runs the instant the sheet has rows to scroll
    // through — without it the only thing that noticed was the timer above.
  }, [focusRowId, followScroll, rowWindow.active, gridEl, dockBottom, rows.length]);
  useEffect(() => {
    if (!activeRowId) return;
    const disengage = () => {
      if (!programmaticScroll.current) setFollowScroll(false);
    };
    window.addEventListener("wheel", disengage, { passive: true });
    window.addEventListener("touchmove", disengage, { passive: true });
    return () => {
      window.removeEventListener("wheel", disengage);
      window.removeEventListener("touchmove", disengage);
    };
  }, [activeRowId]);

  // Next cue after the active row gets a subtle tint on every surface.
  const nextRowId = (() => {
    if (!activeRowId) return null;
    const at = rows.findIndex((r) => r.id === activeRowId);
    if (at < 0) return null;
    return rows.slice(at + 1).find((r) => r.type === "cue")?.id ?? null;
  })();
  const isPaused = channel.show?.state === "paused";
  const showLive = channel.show?.state === "running" || channel.show?.state === "paused";
  /**
   * Do we actually KNOW what the show is doing yet?
   *
   * `channel.show` is null until the server has welcomed us, and `showLive`
   * quietly reads that as "not live" — so a sheet that IS on air draws its
   * whole not-on-air face first: Start show, the walkthrough controls, the
   * timing check. Then the welcome lands and it all changes. Coming back to a
   * running show on a phone that has been in a pocket, you watch the screen
   * pass through two states that were never true before it settles on the one
   * that is.
   *
   * The clock counts too. `serverNow()` returns this device's own time until
   * the first pong measures the difference, so readings drawn before that are
   * not early, they are WRONG — and they correct themselves in front of
   * somebody with no way to know which figure to believe.
   *
   * So: nothing that depends on the state of the show is drawn until both are
   * in. It costs a moment on a cold open and it never shows a false one.
   */
  const showKnown = channel.show != null && channel.clockReady;
  /**
   * The timing check belongs to preparation, not to the show.
   *
   * It reports where the sheet's own TIME and DURATION columns disagree — a
   * question for whoever is building the sheet, answered before anyone goes on
   * air. Once the show is running the disagreements are the POINT: a game runs
   * long, an item is cut, the cue is dragged back to now. A live screen that
   * counts those as faults is crying wolf at the one person who cannot afford
   * to look away, so the check runs on import and in the walkthrough only.
   */
  // Not before the show's state is known either: this runs only when the show
  // is NOT live, so an unknown state briefly reported a live sheet's timing as
  // something to fix.
  const timingGaps = showLive || !showKnown ? [] : findTimingGaps(rows, timing);
  const roleColorFor = (name: string): string =>
    roles.find((r) => r.name.toLowerCase() === name.toLowerCase())?.color ?? "#2dd4bf";
  // rowId → the colour of MY role this row involves (rows can match different roles).
  const myRowColors = new Map<string, string>();
  if (myRoles.length > 0)
    for (const r of rows) {
      const match = matchingRole(r, myRoles, meta.roleColumnKeys);
      if (match) myRowColors.set(r.id, roleColorFor(match));
    }

  // The event-local clock's position along the TIME column: the last row whose
  // (anchored or cascaded) start has passed. Marked in the grid; clock-follow
  // drives the live show to it.
  //
  // Counted past midnight, like the sheet — a wall clock resets at 00:00 and a
  // show running into the small hours does not.
  //
  // Shared with the sync server rather than reimplemented here. There were
  // THREE copies of this rule: the server's, the prompter's and this one. Two
  // were unified when a sheet with an "am" typed for a "pm" parked the show
  // twelve hours out of place; this one was missed, so the grid went on
  // marking the wrong row while the show no longer followed it.
  //
  // Null until the browser has told us the time (see `nowMs`): before then
  // there is no clock, so nothing claims to know where it stands.
  const nowAbsSec = nowMs == null ? null : absoluteNow(zoneSecondsOfDay(nowMs, channel.timezone), timing);
  const clockRowId =
    nowAbsSec == null
      ? null
      : clockTargetRow(
          rows,
          timing.rows.map((r) => r.startSec),
          nowAbsSec,
        );
  /**
   * How long until the first item is due, when the show has opened ahead of it.
   *
   * Recomputed each render from the same clock as everything else on this bar,
   * so it ticks with them rather than on a timer of its own.
   */
  const firstCue = firstCueRow(
    rows,
    timing.rows.map((r) => r.startSec),
  );
  const untilShowSec =
    nowAbsSec == null
      ? null
      : secondsUntilShow(
          rows,
          timing.rows.map((r) => r.startSec),
          nowAbsSec,
        );
  const firstCueRowRecord = firstCue ? rows.find((r) => r.id === firstCue.id) : undefined;

  /**
   * What runs WITH what, and what is on right now.
   *
   * A run sheet is not a queue: a pre-record is shot while the game is on, an
   * announcer reads over a music bed, a block spans the cues that fill it. The
   * grid used to have one word for two rows sharing a moment — the live cue —
   * so everything else in that moment was invisible.
   */
  const concurrentGroups = findConcurrentRows(rows, timing);
  const runsWith = new Map<string, string[]>();
  for (const g of concurrentGroups) {
    for (const i of g.indexes) {
      const id = rows[i]?.id;
      if (!id) continue;
      runsWith.set(
        id,
        g.indexes.filter((j) => j !== i).map((j) => rows[j]?.title?.split("\n")[0]?.trim() || "untitled"),
      );
    }
  }
  const onNowIds = new Set(nowAbsSec == null ? [] : rowsOnAt(rows, timing, nowAbsSec));

  /**
   * What to look at before going live.
   *
   * The same two checks the sheet already runs, said out loud at the one
   * moment they are cheap to act on. A time that contradicts the sheet's own
   * order is the dangerous one: it reads as a perfectly good clock time, it
   * survives every parse, and it only shows itself when the show is running
   * and the readouts have gone strange.
   *
   * Short lines, because this is read standing up with a headset on.
   */
  const preflight = (() => {
    const out: string[] = [];
    for (const w of checkStartTimes(rows.map((r) => ({ startSec: r.hardStartSec ?? null, skipped: r.skipped })))) {
      const title = rows[w.index]?.title?.split("\n")[0]?.trim() || "untitled";
      const at = formatTimeOfDay(w.startSec, meta.use24h);
      out.push(
        w.kind === "meridiem"
          ? `${at} on “${title.slice(0, 28)}” looks like am for pm — probably ${formatTimeOfDay(w.suggestSec ?? 0, meta.use24h)}`
          : w.kind === "offset"
            ? `${at} on “${title.slice(0, 28)}” looks like time INTO a segment, not a time of day`
            : `${at} on “${title.slice(0, 28)}” is out of order with the rows around it`,
      );
    }
    if (timingGaps.length > 0) {
      out.push(
        `${timingGaps.length} place${timingGaps.length === 1 ? "" : "s"} where the times don’t add up — see the timing check`,
      );
    }
    return out;
  })();
  /** How far through a row the clock is — for rows running alongside the cue. */
  const clockFrac = (id: string): number | null => {
    if (nowAbsSec == null) return null;
    const i = rows.findIndex((r) => r.id === id);
    const t = i >= 0 ? timing.rows[i] : null;
    if (!t?.startSec || t.endSec == null || t.endSec <= t.startSec) return null;
    return Math.min(1, Math.max(0, (nowAbsSec - t.startSec) / (t.endSec - t.startSec)));
  };

  // Clock-follow runs on the SERVER (live fail-safe: no console needs to stay
  // open). This toggle just flips the session mode; show_state carries it to
  // every screen.
  const clockFollow = channel.show?.clockFollow ?? false;
  /**
   * How far the live cue has fallen behind the clock, in rows.
   *
   * A show driven by hand advances only when someone presses Next. Left alone
   * — a console closed, an operator pulled away — it sits on the row it was
   * last given while the clock runs on, and every readout reports a show
   * hours over. That is indistinguishable from a broken clock unless the
   * screen says plainly which row the sheet thinks should be on air.
   */
  /**
   * The clock is driving AND the cue is where the sheet says it should be.
   *
   * "Following clock" only says the server is in charge. It says nothing about
   * whether the show is actually on time, which is the thing anyone looking at
   * that button wants to know — and the two came apart in exactly the way you
   * would least want: a bug had the show reporting +1:19 while the button sat
   * there claiming it was following the clock. This is the claim that can be
   * checked: the live cue IS the row the clock points at.
   */
  const clockSynced = clockFollow && !!activeRowId && !!clockRowId && activeRowId === clockRowId;

  const cueDriftRows = (() => {
    if (!showLive || clockFollow || !activeRowId || !clockRowId || activeRowId === clockRowId) return 0;
    const at = rows.findIndex((r) => r.id === activeRowId);
    const want = rows.findIndex((r) => r.id === clockRowId);
    return at >= 0 && want > at ? want - at : 0;
  })();
  const cueDriftSec = (() => {
    if (cueDriftRows === 0) return 0;
    const at = rows.findIndex((r) => r.id === activeRowId);
    const want = rows.findIndex((r) => r.id === clockRowId);
    const a = timing.rows[at]?.startSec;
    const b = timing.rows[want]?.startSec;
    return a != null && b != null ? b - a : 0;
  })();


  const yRows = doc.getMap<Y.Map<unknown>>("rows");
  const yOrder = doc.getArray<string>("rowOrder");

  // Undo/redo over structural row edits — delete a row (live or not), then
  // take it back. Scoped to rows + order; cell text has its own history.
  const undoMgr = useMemo(() => new Y.UndoManager([yRows, yOrder], { captureTimeout: 400 }), [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, undoTick] = useState(0);
  useEffect(() => {
    const bump = () => undoTick((n) => n + 1);
    undoMgr.on("stack-item-added", bump);
    undoMgr.on("stack-item-popped", bump);
    undoMgr.on("stack-cleared", bump);
    return () => {
      undoMgr.off("stack-item-added", bump);
      undoMgr.off("stack-item-popped", bump);
      undoMgr.off("stack-cleared", bump);
      undoMgr.destroy();
    };
  }, [undoMgr]);
  useEffect(() => {
    if (!canEditContent) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable=true]")) return; // cell/text editing keeps native undo
      e.preventDefault();
      if (e.shiftKey) undoMgr.redo();
      else undoMgr.undo();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [undoMgr, canEditContent]);

  /**
   * Fetch the cell editor once the sheet has stopped being busy.
   *
   * It is no longer in the boot bundle (see the CellEditor import), which is
   * the point — but a double-click that then waits on a download is a worse
   * fault than the one being fixed. An idle callback lands it after the sheet
   * has finished arriving and rendering, so the first edit is as immediate as
   * it ever was, and nothing competes with the load to get there.
   *
   * Only for people who can edit. A view-only screen never downloads it at
   * all, which is most of the screens a run sheet is opened on.
   */
  useEffect(() => {
    if (!canEditContent) return;
    const warm = () => void import("./CellEditor");
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (ric) {
      const id = ric(warm, { timeout: 8000 });
      return () => (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(id);
    }
    // Safari has no requestIdleCallback; a timer is close enough for a warm-up.
    const t = window.setTimeout(warm, 3000);
    return () => window.clearTimeout(t);
  }, [canEditContent]);

  const getFragment = (rowId: string, columnId: string): Y.XmlFragment | null => {
    const yRow = yRows.get(rowId);
    if (!yRow) return null;
    const cells = yRow.get("cells") as Y.Map<Y.XmlFragment>;
    let fragment = cells.get(columnId);
    if (!fragment) {
      fragment = new Y.XmlFragment();
      cells.set(columnId, fragment);
    }
    return fragment;
  };

  const setRowField = (rowId: string, field: string, value: unknown): void => {
    doc.transact(() => {
      yRows.get(rowId)?.set(field, value);
    });
  };

  // Outcome branches (win / lose / draw / golden point): picking one plays
  // its rows and skips the other endings — in one undoable transaction,
  // synced to every screen, and the transport jumps to the branch when live.
  const outcomeRows = rows.filter((r) => r.outcome);
  /**
   * A day can hold several games, each with its own endings. Every pick is
   * scoped to ONE of them: choosing a result for the first game must not skip
   * the third game's branches, which is what a single sheet-wide choice did.
   */
  const outcomeGames = [...new Set(outcomeRows.map((r) => r.outcomeGame ?? 1))].sort((a, b) => a - b);
  const rowsOfGame = (g: number) => outcomeRows.filter((r) => (r.outcomeGame ?? 1) === g);
  const outcomesOfGame = (g: number) =>
    (["golden", "win", "lose", "draw"] as const).filter((o) => rowsOfGame(g).some((r) => r.outcome === o));
  /** Is this ending playing — its rows in the running order? */
  const playing = (g: number, o: string): boolean => {
    const mine = rowsOfGame(g).filter((r) => r.outcome === o);
    return mine.length > 0 && mine.every((r) => !r.skipped);
  };
  /**
   * Extra time is being played (or was). It is not a RESULT — golden point is a
   * period of football, and the match still has to end in a win, a loss or a
   * draw afterwards.
   */
  const goldenPlaying = (g: number): boolean => {
    if (!outcomesOfGame(g).includes("golden") || !playing(g, "golden")) return false;
    // Before anything is called NOTHING is skipped, so every ending is
    // technically "playing" — including golden. Extra time is only under way
    // once it has been chosen, which is to say once the results are skipped.
    const results = rowsOfGame(g).filter((r) => r.outcome !== "golden");
    return results.length > 0 && results.every((r) => r.skipped);
  };
  /**
   * The result that has been called, or null while it is still open.
   *
   * Golden point is skipped over deliberately: once extra time is playing the
   * question is still open, and once a result is called after it the golden
   * block STAYS in the running order — it happened. Reading it as the answer
   * left the chooser saying "golden point" after the match had been won.
   */
  const chosenOf = (g: number): string | null => {
    const results = outcomesOfGame(g).filter((o) => o !== "golden");
    for (const o of results) {
      const others = rowsOfGame(g).filter((r) => r.outcome !== o && r.outcome !== "golden");
      if (playing(g, o) && others.length > 0 && others.every((r) => r.skipped)) return o;
    }
    return null;
  };
  /** What the chooser is asking about right now. */
  /**
   * Is the result worth asking about yet?
   *
   * A match is eighty minutes and the chooser is a bar across the foot of the
   * sheet — up all afternoon it is just something covering rows. In the NRL
   * nothing can be called before the second half, so that is when it appears:
   * once the live cue reaches this game's second half, and until the result
   * has been called and the sheet has moved past the endings.
   *
   * Without a recognisable second half (another sport, a sheet that words it
   * differently) it falls back to proximity — within a few cues of the
   * endings — which is what the pulse already used.
   */
  /**
   * Is the result worth asking about yet?
   *
   * The rule itself lives in core and is tested there — it turns on a
   * thirty-second boundary, and the only way to check that from here is to sit
   * and watch a clock. This gathers what the rule needs from the sheet.
   */
  const resultDue = (g: number): boolean => {
    if (!showLive) return false;
    const liveIndex = activeRowId ? rows.findIndex((r) => r.id === activeRowId) : -1;
    const firstEndingIndex = rows.findIndex((r) => r.outcome && (r.outcomeGame ?? 1) === g);

    let lastExtraIndex = -1;
    for (let i = 0; i < rows.length; i++)
      if ((rows[i]!.outcomeGame ?? 1) === g && rows[i]!.outcome === "golden") lastExtraIndex = i;

    // The far edge of this game's endings, across every branch — where the
    // decision stops being live and becomes something that already happened.
    let lastEndingIndex = -1;
    for (let i = 0; i < rows.length; i++)
      if (rows[i]!.outcome && (rows[i]!.outcomeGame ?? 1) === g) lastEndingIndex = i;

    // The period before which a result cannot be asked for. Read off the
    // sheet's own wording, stopping at the kick-off so a later game's second
    // half is never mistaken for this one's.
    let notBeforeIndex = -1;
    const dueAfter = showType?.resultDueAfter;
    if (dueAfter && firstEndingIndex > 0) {
      for (let i = firstEndingIndex - 1; i >= 0; i--) {
        if (dueAfter.test(rows[i]!.title)) {
          notBeforeIndex = i;
          break;
        }
        if (/\bkick\s?off\b/i.test(rows[i]!.title)) break;
      }
    }

    return resultDueNow({
      liveIndex,
      firstEndingIndex,
      lastExtraIndex,
      extraPlaying: goldenPlaying(g),
      remainingInRowSec: live?.remainingInRowSec ?? null,
      notBeforeIndex,
      called: chosenOf(g) != null,
      lastEndingIndex,
      bufferSec: RESULT_BUFFER_SEC,
    });
  };

  /**
   * Which layer an ending sits on.
   *
   * A drawn match cannot happen at full time in a competition that has an
   * extra period — a level score is the REASON there is one. So a draw is on
   * the far side of it, and everything else is offered the moment the siren
   * goes. Where there is no extra period on the sheet, a draw is an ordinary
   * full-time result and this is a no-op, which is what Australian rules and
   * league football need.
   */
  const layerOf = (g: number, outcome: string): 0 | 1 =>
    outcome === "draw" && outcomesOfGame(g).includes("golden") ? 1 : 0;

  /** What the layer header says, and when it begins. */
  const layerLabel = (g: number, layer: 0 | 1): string =>
    layer === 1
      ? `After ${(showType?.extraLabel ?? "extra time").toLowerCase()}`
      : outcomesOfGame(g).includes("golden")
        ? "At full time"
        : "How it ends";

  const outcomeStage = (g: number): "full-time" | "extra-time" | "settled" =>
    chosenOf(g) != null ? "settled" : goldenPlaying(g) && outcomesOfGame(g).includes("golden") ? "extra-time" : "full-time";

  /**
   * In `fork` layout, is this row one the sheet is currently hiding?
   *
   * The whole block collapses to a single line until somebody calls something.
   * Once the extra period is under way its rows are back — they are being
   * played — and once a result is called that branch is back too. Nothing is
   * deleted; the rows are simply not drawn, so un-calling puts them straight
   * back and the sheet the crew shares is unchanged.
   */
  const forkHides = (i: number): boolean => {
    if (outcomeLayout !== "fork") return false;
    const r = rows[i];
    if (!r?.outcome) return false;
    const g = r.outcomeGame ?? 1;
    // Still entirely hypothetical — nothing called, no extra period under way
    // — so the block collapses to its one fork line.
    if (chosenOf(g) == null && !goldenPlaying(g)) return true;
    // After that the RUNNING ORDER decides, which is the only honest test.
    // Asking "is this the branch that was chosen" instead threw away the extra
    // period the moment a result was called after it — twenty minutes of
    // football everybody had just watched, gone off the sheet.
    return Boolean(r.skipped);
  };
  /** The game whose full time is nearest the live cue — the one being called. */
  const activeGame = (() => {
    if (outcomeGames.length === 0) return null;
    if (outcomeGames.length === 1) return outcomeGames[0]!;
    const liveIdx = activeRowId ? rows.findIndex((r) => r.id === activeRowId) : -1;
    if (liveIdx < 0) return outcomeGames.find((g) => chosenOf(g) == null) ?? outcomeGames[0]!;
    // The first game whose branch rows still lie ahead of the live cue.
    for (const g of outcomeGames) {
      const last = rows.reduce((acc, r, i) => ((r.outcomeGame ?? 1) === g && r.outcome ? i : acc), -1);
      if (last >= liveIdx) return g;
    }
    return outcomeGames[outcomeGames.length - 1]!;
  })();
  const pickOutcome = (o: string, game: number): void => {
    // Extra time that has already been played stays played. Picking the result
    // AFTER golden point used to skip the golden block, so the twenty minutes
    // of football everyone just watched vanished out of the running order and
    // every time below it jumped back.
    const keepGolden = o !== "golden" && goldenPlaying(game) && outcomesOfGame(game).includes("golden");
    doc.transact(() => {
      for (const r of rowsOfGame(game)) {
        const keep = r.outcome === o || (keepGolden && r.outcome === "golden");
        yRows.get(r.id)?.set("skipped", !keep);
      }
    });
    // Deliberately NOT a jump. Calling the result says which ending WILL be
    // played, not that it starts now — the siren has gone but the second half
    // is still on air, and taking the show off it the instant somebody presses
    // Win cuts the thing that is actually happening. The chosen branch is the
    // next unskipped row, so the show reaches it when the current item ends,
    // by Next or by the clock, exactly as it would have anyway.
  };
  const clearOutcomeOf = (game: number): void => {
    doc.transact(() => {
      for (const r of rowsOfGame(game)) yRows.get(r.id)?.set("skipped", false);
    });
  };

  /**
   * Where a row sits inside a block of alternate endings, so the grid can show
   * the endings STACKED — each in its own lane, one directly above the next,
   * all starting at the same moment.
   *
   * Read down the page they look like a sequence: win, then lose, then draw, as
   * though the show played all three. They are alternatives; only one is ever
   * called. The lanes say so, and the timing behind them now gives every branch
   * the same start.
   */
  const branchAt = (i: number): BranchMark | null => {
    const r = rows[i];
    if (!r?.outcome) return null;
    const game = r.outcomeGame ?? 1;
    const gameAt = (j: number): number | null => (rows[j]?.outcome ? rows[j]!.outcomeGame ?? 1 : null);
    const keyAt = (j: number): string | null => (rows[j]?.outcome ? `${rows[j]!.outcomeGame ?? 1}:${rows[j]!.outcome}` : null);
    const key = `${game}:${r.outcome}`;
    const chosen = chosenOf(game);
    const layer = layerOf(game, r.outcome);
    // First row of this layer in this block. The branches of one layer are
    // contiguous on every sheet we have, so the layer opens wherever the row
    // above is either outside the block or on the layer before it.
    const prevGame = gameAt(i - 1);
    const prevLayer = prevGame === game && rows[i - 1]?.outcome ? layerOf(game, rows[i - 1]!.outcome!) : null;
    return {
      outcome: r.outcome,
      opens: keyAt(i - 1) !== key,
      closes: keyAt(i + 1) !== key,
      blockOpens: prevGame !== game,
      blockCloses: gameAt(i + 1) !== game,
      // Dimmed, never hidden: the endings that were not called stay readable,
      // because a result gets reversed more often than anyone would like.
      dim: chosen != null && chosen !== r.outcome,
      layer,
      layerOpens: prevGame !== game || prevLayer !== layer,
    };
  };

  // ── Timing nudges ───────────────────────────────────────────────────────
  // Fixed corrections taken from the row itself when the show runs ahead or
  // behind. The LIVE cue is the anchor: time is absorbed on the far side of
  // the edit, so whatever is on air never moves. One transaction per press,
  // so one undo takes the whole correction back.
  const shiftFixedTimes = (from: number, to: number, deltaSec: number): void => {
    for (let i = from; i <= to; i++) {
      const row = rows[i];
      if (!row) continue;
      const yRow = yRows.get(row.id);
      const fixed = yRow?.get("hardStartSec") as number | null | undefined;
      if (fixed != null) yRow!.set("hardStartSec", fixed + deltaSec);
    }
  };

  /** ±seconds on this item's duration, rippled away from the live cue. */
  const nudgeRow = (rowId: string, deltaSec: number): void => {
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const row = rows[idx]!;
    const current = row.durationSec ?? 0;
    const next = Math.max(0, current + deltaSec);
    const applied = next - current; // never below zero
    if (applied === 0) return;
    // A muted or skipped row sits outside the running order — its duration
    // changes, but nothing else moves.
    const inTiming = !row.durationMuted && !row.skipped;
    const liveIdx = activeRowId ? rows.findIndex((r) => r.id === activeRowId) : -1;
    const rippleUp = liveIdx >= 0 && idx < liveIdx;
    doc.transact(() => {
      yRows.get(rowId)?.set("durationSec", next);
      if (!inTiming) return;
      if (rippleUp) {
        // Hold this item's END: its own start and everything above move back.
        const own = yRows.get(rowId)?.get("hardStartSec") as number | null | undefined;
        if (own != null) yRows.get(rowId)!.set("hardStartSec", own - applied);
        shiftFixedTimes(0, idx - 1, -applied);
      } else {
        shiftFixedTimes(idx + 1, rows.length - 1, applied);
      }
    });
  };

  /** "This is happening now": pin the row to the clock, ripple the rest down. */
  /**
   * How many rows a CUE on this one would drop. Zero when it is the live row
   * (or nothing is live), which is the difference between re-timing the sheet
   * and changing what is on air.
   */
  const cueSkipCount = (rowId: string): number => {
    const idx = rows.findIndex((r) => r.id === rowId);
    const liveIdx = activeRowId ? rows.findIndex((r) => r.id === activeRowId) : -1;
    if (idx < 0 || liveIdx < 0 || idx <= liveIdx) return 0;
    return rows.slice(liveIdx + 1, idx).filter((r) => r.type !== "group" && !r.skipped).length;
  };

  /**
   * "This item is happening now."
   *
   * On the live row that is only a re-time: pin it to the clock and shift what
   * follows. On a row further down it also means the show is GOING there, and
   * the rows in between did not run — so they are marked skipped rather than
   * squeezed. Squeezing would claim they ran faster, which is not what
   * happened, and it breaks outright once the squeeze exceeds their duration.
   * Skipping keeps the as-run record true and one undo takes it all back.
   *
   * Rows ABOVE are never touched: they already happened, and rewriting their
   * times would falsify the record of the show.
   */
  const cueRow = (rowId: string): void => {
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    // A pre-record or a bell runs alongside the show and is never called, so
    // it can never be the row the cue timer is counting. The server refuses
    // this too — this is only so the console never sends a command it knows
    // will come back as an error.
    if (rows[idx]!.parallel) return;
    const liveIdx = activeRowId ? rows.findIndex((r) => r.id === activeRowId) : -1;
    const jumping = liveIdx >= 0 && idx > liveIdx;
    // The clock carries sub-second precision for the smooth now-line; a
    // written start time is whole seconds like every other time in the sheet.
    const nowSec = Math.round(zoneSecondsOfDay(channel.serverNow(), channel.timezone));
    const currentStart = timing.rows[idx]?.startSec ?? null;
    const delta = currentStart != null ? nowSec - currentStart : 0;
    doc.transact(() => {
      if (jumping) for (const r of rows.slice(liveIdx + 1, idx)) if (r.type !== "group") yRows.get(r.id)?.set("skipped", true);
      yRows.get(rowId)?.set("hardStartSec", nowSec);
      yRows.get(rowId)?.set("skipped", false);
      if (delta !== 0) shiftFixedTimes(idx + 1, rows.length - 1, delta);
    });
    if (jumping && showLive) channel.sendCmd("jump", rowId);
  };

  // NRL flow: at full time the choices are Win / Lose / ⚡Golden point (a
  // level score goes to golden point, never straight to a draw). Once golden
  // point is playing, the final pick returns as Win / Lose / Draw. Events
  // without a sport show every tagged ending.
  /**
   * What to offer, and it changes once during a game.
   *
   *   FULL TIME     Win · Lose · ⚡ Golden point
   *                 No Draw: in the NRL a level score at full time does not end
   *                 the match, it sends it to extra time.
   *   EXTRA TIME    Win · Lose · Draw
   *                 Golden point drops off the list — it is playing. A draw is
   *                 only a real ending once extra time has been played out.
   *   SETTLED       the called result, and Reset.
   *
   * An event with no sport set gets every ending the sheet has, in one list.
   */
  const visibleOutcomesOf = (g: number): string[] => {
    const present = outcomesOfGame(g);
    // Whether THIS sheet plays an extra period at all. An exhibition or a
    // junior match is still rugby league but nobody is playing golden point,
    // and the sheet shows that by not carrying a golden-point block — so the
    // day ends at full time and Draw is the button that has to be there.
    const extraInSheet = rows.some((r) => r.outcome === "golden" && (r.outcomeGame ?? 1) === g);
    const offered = outcomesFor(channel.sport, outcomeStage(g) === "extra-time", customTypes, { extraInSheet });
    // A type the app does not know, or a sheet with no type set, shows whatever
    // endings the sheet itself carries — better than offering nothing.
    if (offered.length === 0) return [...present];
    return offered.filter((o) => present.includes(o));
  };
  const outcomeLabel = (o: string): string =>
    o === "golden"
      ? `⚡ ${showType?.extraLabel ?? "Extra time"}`
      : o === "win"
        ? "Win"
        : o === "lose"
          ? "Lose"
          : "Draw";
  /**
   * The chooser is asking, and nobody has answered.
   *
   * It used to mean "within two cues of the endings", because the chooser sat
   * on screen for the whole second half and needed a separate signal for when
   * it mattered. It no longer does — it appears in the last half-minute and
   * not before — so its being there IS the signal, and this simply says
   * whether it is still waiting on a press.
   */
  const decisionSoon =
    showLive && activeGame != null && resultDue(activeGame) && chosenOf(activeGame) == null;

  /**
   * Seconds until the thing on air ends, while the chooser is up.
   *
   * Shown counting down so the press has a deadline attached to it rather than
   * a bar that merely appeared. Clamped at zero: past the siren the question
   * is still open, and a negative number would read as an error.
   */
  const decisionCountdown = (() => {
    if (!decisionSoon) return null;
    const remaining = live?.remainingInRowSec;
    if (remaining == null || remaining > RESULT_BUFFER_SEC) return null;
    return Math.max(0, Math.ceil(remaining));
  })();

  const selectRow = (rowId: string, e: React.MouseEvent): void => {
    const order = rows.map((r) => r.id);
    if (e.shiftKey && lastSelected) {
      const a = order.indexOf(lastSelected);
      const b = order.indexOf(rowId);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelected(new Set(order.slice(from, to + 1)));
        return;
      }
    }
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      setSelected(next);
      setLastSelected(rowId);
      return;
    }
    setSelected(selected.size === 1 && selected.has(rowId) ? new Set() : new Set([rowId]));
    setLastSelected(rowId);
  };

  const addRow = (type: "cue" | "group" | "milestone"): void => {
    doc.transact(() => {
      const rowId = ulid();
      const yRow = new Y.Map();
      yRow.set("id", rowId);
      yRow.set("type", type);
      yRow.set("hardStartSec", null);
      yRow.set("durationSec", type === "cue" ? 60 : null); // groups & milestones carry no duration
      yRow.set("cells", new Y.Map<Y.XmlFragment>());
      yRows.set(rowId, yRow);
      const order = yOrder.toArray();
      const at = lastSelected ? order.indexOf(lastSelected) + 1 : order.length;
      yOrder.insert(at > 0 ? at : order.length, [rowId]);
    });
  };

  const deleteSelected = (): void => {
    if (selected.size === 0) return;
    // The rule lives with the ACTION, not only with the button that is
    // currently the one way to reach it. Twice today a control turned out to
    // have a second copy somewhere else obeying the old rule; a shortcut added
    // here later should not be able to delete a row out of a running show
    // because nobody remembered this.
    if (showLive) return;
    doc.transact(() => {
      const order = yOrder.toArray();
      // Delete back-to-front so indices stay valid.
      [...selected]
        .map((id) => order.indexOf(id))
        .filter((i) => i >= 0)
        .sort((a, b) => b - a)
        .forEach((i) => yOrder.delete(i, 1));
      selected.forEach((id) => yRows.delete(id));
    });
    setSelected(new Set());
    setLastSelected(null);
  };

  const duplicateSelected = (): void => {
    if (selected.size === 0) return;
    doc.transact(() => {
      const order = yOrder.toArray();
      const picked = order.filter((id) => selected.has(id));
      const last = picked[picked.length - 1];
      let at = (last ? order.indexOf(last) : order.length - 1) + 1;
      for (const id of picked) {
        const source = yRows.get(id);
        if (!source) continue;
        const newId = ulid();
        yRows.set(newId, cloneRow(source, newId));
        yOrder.insert(at, [newId]);
        at += 1;
      }
    });
  };

  const toggleGroupSelected = (): void => {
    doc.transact(() => {
      selected.forEach((id) => {
        const yRow = yRows.get(id);
        if (!yRow) return;
        yRow.set("type", yRow.get("type") === "group" ? "cue" : "group");
      });
    });
  };

  const addColumn = (): void => {
    const title = window.prompt("Column name");
    if (!title) return;
    doc.transact(() => {
      const col = new Y.Map();
      col.set("id", ulid());
      col.set("key", title.toLowerCase().replace(/\W+/g, "-"));
      col.set("title", title);
      col.set("kind", "richtext");
      doc.getArray<Y.Map<unknown>>("columns").push([col]);
    });
  };

  const exportCsv = (): void => {
    // Columns in the sheet's order, with the sheet's own header names.
    const header = ["Type", ...orderedColumns.map((c) => c.title)];
    const body = rows.map((r, i) => [
      r.type,
      ...orderedColumns.map((c) =>
        c.kind === "title"
          ? r.title
          : c.kind === "startTime"
            ? r.untimed && r.hardStartSec == null
              ? ""
              : timing.rows[i]!.startSec != null
                ? formatTimeOfDay(timing.rows[i]!.startSec!, true)
                : ""
            : c.kind === "duration"
              ? r.durationSec != null
                ? formatDuration(r.durationSec)
                : ""
              : (r.cells[c.key] ?? ""),
      ),
    ]);
    const blob = new Blob([serializeCsv([header, ...body])], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${meta.name.replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportPdf = (): void => {
    void exportRundownPdf({
      name: meta.name,
      versionLabel: meta.versionLabel,
      use24h: meta.use24h,
      keyTimes,
      columns: orderedColumns,
      widthFor: (key) => colWidths[key] ?? columns.find((c) => c.key === key)?.width,
      rows,
      timing,
    });
  };

  /**
   * Closing the sheet at the end of the event. Crew codes, guest passes and
   * read-only accounts stop opening it; whoever calls or edits the show is
   * unaffected, so this is always reversible by the people who did it.
   */
  const [viewingClosed, setViewingClosed] = useState(initialViewingClosed ?? false);
  useEffect(() => {
    // The server render already asked, in the same call that fetched the epoch
    // — this used to be a SECOND request to the very same endpoint, from the
    // same page load, moments apart.
    if (initialViewingClosed != null) return;
    void api
      .rundownEpoch(rundownId)
      .then((r) => setViewingClosed(r.viewingClosed))
      .catch(() => {});
  }, [rundownId, initialViewingClosed]);
  const setViewing = (closed: boolean): void => {
    if (
      closed &&
      !window.confirm(
        "End this event?\n\nView-only links and read-only accounts will stop opening this run sheet. You and anyone who can edit it keep their access, and you can reopen it from here.",
      )
    )
      return;
    void api
      .setViewing(rundownId, closed)
      .then(() => setViewingClosed(closed))
      .catch((err: unknown) => window.alert(`Couldn't change this: ${String((err as Error)?.message ?? err)}`));
  };

  const saveAsTemplate = (): void => {
    const name = window.prompt("Template name", `${meta.name} template`);
    if (!name) return;
    void api.saveTemplate({ rundownId, name }).then(() => window.alert(`Saved template "${name}".`));
  };

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    doc.transact(() => {
      const order = yOrder.toArray();
      const from = order.indexOf(String(active.id));
      const to = order.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      yOrder.delete(from, 1);
      yOrder.insert(to, [String(active.id)]);
    });
  };

  /** Empty clears the fixed time (back to auto flow); an unchanged value is a
   *  no-op so opening the editor and clicking away never pins a flowing row.
   *  A changed time ripples like a changed duration: every fixed time BELOW
   *  shifts by the same amount, one undoable transaction. */
  const commitTime = (rowId: string, raw: string, currentSec: number | null): void => {
    const trimmed = raw.trim();
    if (trimmed === "") setRowField(rowId, "hardStartSec", null);
    else {
      const sec = parseTimeOfDay(trimmed);
      if (sec != null && sec !== currentSec) {
        const delta = currentSec != null ? sec - currentSec : 0;
        const order = yOrder.toArray();
        const idx = order.indexOf(rowId);
        /**
         * Move the show, or correct one row — and they are not the same edit.
         *
         * Shifting every later time by the same amount is right when the show
         * is being re-planned. It was catastrophic when the edit was a repair:
         * putting an "am" back to "pm" is a twelve-hour change, so every fixed
         * time below it moved twelve hours too and an 8 PM item came back as
         * 8 AM. Those rows were already correct — being wrong was this row's
         * problem alone.
         *
         * Order decides. Stays in order: the show moved, everything follows.
         * Was out of order, or is being taken out of order: a value is being
         * fixed, and nothing else is touched.
         */
        const starts = order.map((id) => (yRows.get(id)?.get("hardStartSec") as number | null | undefined) ?? null);
        const ripples = idx >= 0 && delta !== 0 && startEditRipples(starts, idx, currentSec, sec);
        doc.transact(() => {
          yRows.get(rowId)?.set("hardStartSec", sec);
          if (!ripples || idx < 0) return;
          for (let i = idx + 1; i < order.length; i++) {
            const later = yRows.get(order[i]!);
            const fixed = later?.get("hardStartSec") as number | null | undefined;
            if (fixed != null) later!.set("hardStartSec", fixed + delta);
          }
        });
      }
    }
    setEditingTime(null);
  };

  /** A changed duration ripples through the show: every fixed time BELOW the
   *  row shifts by the same amount, so an item running long or short moves the
   *  rest of the sheet with it. One transaction — one undo step reverses the
   *  duration and the whole ripple together. */
  const commitDuration = (rowId: string, raw: string): void => {
    const trimmed = raw.trim();
    const newSec = trimmed === "" ? null : parseDurationShorthand(trimmed);
    const yRow = yRows.get(rowId);
    const oldSec = (yRow?.get("durationSec") as number | null | undefined) ?? null;
    // Muted and skipped rows sit outside the running order — no ripple.
    const inTiming = !yRow?.get("durationMuted") && !yRow?.get("skipped");
    doc.transact(() => {
      yRow?.set("durationSec", newSec);
      if (!inTiming || newSec == null || oldSec == null || newSec === oldSec) return;
      const delta = newSec - oldSec;
      const order = yOrder.toArray();
      const idx = order.indexOf(rowId);
      if (idx < 0) return;
      for (let i = idx + 1; i < order.length; i++) {
        const later = yRows.get(order[i]!);
        const fixed = later?.get("hardStartSec") as number | null | undefined;
        if (fixed != null) later!.set("hardStartSec", fixed + delta);
      }
    });
  };

  const allRichColumns = columns.filter((c) => c.kind === "richtext");
  const richColumns = allRichColumns.filter((c) => !hiddenCols.has(c.key));
  const titleColumn = columns.find((c) => c.kind === "title");
  const startColumn = columns.find((c) => c.kind === "startTime");
  const durationColumn = columns.find((c) => c.kind === "duration");

  // Column headers behave like a spreadsheet: click a label to edit it in
  // place, drag it to reorder the column (the document's column order is the
  // truth, so every screen and export follows).
  const [editingCol, setEditingCol] = useState<string | null>(null); // column id
  const [editingName, setEditingName] = useState(false);
  const router = useRouter();
  const isPhone = useIsPhone();
  const isNarrow = useIsNarrow();
  /**
   * The sheet's name doubles as the way back on a phone.
   *
   * Not for a view-only link — those have no dashboard to go back to, and a
   * heading that lands on a sign-in page is worse than one that does nothing.
   */
  // Tablets too, not just phones — that is where the arrow was worst.
  const tapBack = isNarrow && mode !== "view";
  /**
   * Renames the sheet. The name lives in the document, so it reaches every
   * open screen at once; the dashboard's copy is updated too, or the list
   * would still show the old one.
   */
  const commitName = (value: string): void => {
    const name = value.trim();
    setEditingName(false);
    if (!name || name === meta.name) return;
    doc.getMap("meta").set("name", name);
    void api.patchRundown(rundownId, { name }).catch(() => {
      // The document is the source of truth for what everyone sees; a failed
      // dashboard write is worth knowing about but must not undo the rename.
      console.warn("[sheet] renamed in the document but not on the dashboard");
    });
  };
  const [dragCol, setDragCol] = useState<string | null>(null); // column key
  const [dropCol, setDropCol] = useState<string | null>(null); // column key

  const commitColTitle = (colId: string, raw: string): void => {
    const next = raw.trim();
    if (next) {
      const yCols = doc.getArray<Y.Map<unknown>>("columns");
      doc.transact(() => {
        for (const c of yCols) if (c.get("id") === colId) c.set("title", next);
      });
    }
    setEditingCol(null);
  };

  /** Moves the dragged column to the drop target's position. A Yjs map can't
   *  be re-inserted after deletion, so the column is cloned across. */
  const moveColumn = (fromKey: string, toKey: string): void => {
    const yCols = doc.getArray<Y.Map<unknown>>("columns");
    doc.transact(() => {
      const arr = yCols.toArray();
      const fromIdx = arr.findIndex((c) => c.get("key") === fromKey);
      if (fromIdx < 0) return;
      const data = arr[fromIdx]!.toJSON() as Record<string, unknown>;
      yCols.delete(fromIdx, 1);
      const rest = yCols.toArray();
      const toIdx = rest.findIndex((c) => c.get("key") === toKey);
      if (toIdx < 0) return;
      const clone = new Y.Map();
      for (const [k, v] of Object.entries(data)) clone.set(k, v);
      // Dropping on a column takes its place: before it when coming from the
      // right, after it when coming from the left.
      const origToIdx = arr.findIndex((c) => c.get("key") === toKey);
      yCols.insert(fromIdx < origToIdx ? toIdx + 1 : toIdx, [clone]);
    });
  };

  // Columns render in the DOC's order — which mirrors the source sheet, so a
  // run sheet with TIME before ACTIVITY looks the same on screen. The Zero
  // column (synthetic) rides directly after the duration column.
  const shown = columns.filter(
    (c) => c.kind === "title" || c.kind === "startTime" || c.kind === "duration" || (c.kind === "richtext" && !hiddenCols.has(c.key)),
  );

  /**
   * Columns folded into the item cell because the window is too narrow to give
   * them one of their own.
   *
   * The sheet never scrolls sideways. A horizontal scrollbar hides half the
   * row behind an edge and asks someone calling a show to go looking for it —
   * on a phone, one-handed, mid-item. So the grid always fits, and what will
   * not fit as a column appears underneath the item it belongs to instead.
   *
   * Folding runs right to left, which makes the column ORDER the priority
   * order: drag a column left to keep it, and it survives a narrower window.
   */
  const narrow = gridWidth != null && gridWidth < NARROW_GRID;
  const COL_W = narrow ? COL_W_NARROW : COL_W_WIDE;
  const MIN_TITLE = narrow ? 140 : 190; // the action text is the thing being read
  const MIN_EXTRA = 92; // narrower than this and a column is unreadable anyway
  const foldedKeys = (() => {
    const extras = shown.filter((c) => c.kind === "richtext");
    if (gridWidth == null || extras.length === 0) return new Set<string>();
    const structural =
      COL_W.rownum + (shown.some((c) => c.kind === "startTime") ? COL_W.time : 0) + (shown.some((c) => c.kind === "duration") ? COL_W.dur : 0);
    const room = gridWidth - structural - MIN_TITLE;
    const keep = Math.max(0, Math.floor(room / MIN_EXTRA));
    return new Set(extras.slice(keep).map((c) => c.key));
  })();
  const orderedColumns = shown.filter((c) => !foldedKeys.has(c.key));
  /**
   * The item column, sized rather than left to the browser.
   *
   * Fixed layout is what keeps the table inside its container, but a
   * fixed-layout table does not reliably hand its spare width to the one
   * column left on `auto` — it left a 218px item column beside 439px of
   * nothing. Measuring the grid and doing the subtraction here is not clever,
   * but it is exact, and the item column is the one that must not be guessed.
   */
  const titleWidth = (() => {
    if (gridWidth == null) return null;
    const others = orderedColumns.reduce(
      (sum, c) =>
        sum +
        (colWidths[c.key] ??
          (c.kind === "startTime" ? COL_W.time : c.kind === "duration" ? COL_W.dur : c.kind === "richtext" ? (c.width ?? COL_W.extra) : 0)),
      colWidths["rownum"] ?? COL_W.rownum,
    );
    return Math.max(MIN_TITLE, gridWidth - others - 2);
  })();
  /** The folded columns, in sheet order, for the line under the item. */
  const foldedColumns = shown.filter((c) => foldedKeys.has(c.key));
  const orderedColKeys = [
    "rownum",
    ...orderedColumns.flatMap((c) => (c.kind === "duration" && showZero ? [c.key, "zero"] : [c.key])),
  ];
  const nextColKey = (key: string): string | null => {
    const i = orderedColKeys.indexOf(key);
    return i >= 0 && i < orderedColKeys.length - 1 ? orderedColKeys[i + 1]! : null;
  };
  const fixedStyle = tableStyle(orderedColKeys);
  /**
   * Stored column widths, as a share of their own total rather than in pixels.
   *
   * The table is `width: 100%` and fixed-layout on the belief that a browser
   * scales stored pixel widths proportionally to fill it. It does not: fixed
   * layout honours every width it is given and leaves whatever is left over as
   * dead space at the end. Once every column had been sized — which happens
   * the first time anyone drags one, and to the item column too, which is
   * supposed to be the one that flexes — nothing absorbed the remainder. A
   * sheet whose widths were saved on a narrower window then ran 1229px of
   * columns down a 1442px grid: the first column flush to its edge, and 213px
   * of ruled nothing down the right-hand side.
   *
   * As percentages of their own total the same numbers describe the same
   * layout, and 100% of the grid is exactly the grid. Every proportion the
   * operator dragged is kept, both edges are pinned at any width, and it costs
   * one division. Pixels stay in the store — this converts only at the point
   * of rendering, so the widths remain meaningful if the grid is measured
   * again.
   */
  const colTotalPx = orderedColKeys.reduce((sum, k) => sum + (colWidths[k] ?? 0), 0);
  const sharing = orderedColKeys.length > 0 && colTotalPx > 0 && orderedColKeys.every((k) => colWidths[k] != null);

  /**
   * Wide enough for the longest row number the sheet actually has — plus the
   * mark that sits beside it.
   *
   * A pre-record's number carries a "∥" after it, and on a long sheet the
   * numbers are four digits: "1015 ∥" wanted 60px in a 55px column, so the
   * ellipsis ate the NUMBER and left "50…" where a row number should be. The
   * mark annotating the number was crowding it out. Never visible on a
   * hundred-row match sheet, obvious on a three-thousand-row one — so the
   * floor is taken from the sheet in hand rather than from a number typed
   * here, and a short sheet still gets a narrow column.
   */
  /** One rule for what a row is called — see `rowNumbering`. */
  const numberOf = useMemo(() => rowNumbering(rows), [rows]);

  const rowNumFloor = useMemo(() => {
    const longest = rows.reduce((n, r) => Math.max(n, (r.sourceNumber ?? "").trim().length), 0);
    const anyParallel = rows.some((r) => r.parallel);
    return Math.max(38, 20 + Math.ceil(longest * 7.5) + (anyParallel ? 13 : 0));
  }, [rows]);

  /**
   * The width below which a column stops saying anything.
   *
   * A share of a narrow screen is a narrow column: on a tablet TIME fell to
   * 71px and every one of its cells was clipped — "12:00:00 AM" needs 108.
   * A floor cannot be a `min-width`, because a fixed table layout sizes its
   * columns from the specified width alone and ignores it (it computed to
   * 96px and the column stayed 71). So the floors are honoured HERE, while the
   * shares are being worked out, and the answer is still a percentage.
   */
  const floorFor = (key: string): number => {
    if (key === "rownum") return rowNumFloor;
    const c = orderedColumns.find((x) => x.key === key);
    // Measured, not guessed: "12:00:00 AM" needs 109px of content and the cell
    // spends 20 on padding; the longest duration needs 60.
    return c?.kind === "startTime" ? 130 : c?.kind === "duration" ? 80 : 0;
  };

  /**
   * Every column's share of the grid, as a percentage that sums to 100.
   *
   * Floors first, then the rest of the room split in the proportions the
   * operator dragged. Two passes: pinning a column to its floor takes room
   * from the others, which can push another below ITS floor. Percentages
   * rather than pixels so the table still meets both its edges exactly.
   */
  const colPct: Record<string, string> = {};
  if (sharing && gridWidth != null && gridWidth > 2) {
    const avail = gridWidth - 2;
    const base = Object.fromEntries(orderedColKeys.map((k) => [k, colWidths[k] ?? 0]));
    const px: Record<string, number> = {};
    const pinned = new Set<string>();
    /**
     * On a screen too small to afford them, the floors are dropped entirely.
     *
     * They protect the structural columns, but held on a phone they would take
     * half the width for a time and a duration and leave the item column — the
     * thing actually being read — with a few characters. Better a shortened
     * time than an unreadable sheet, and the phone layout already folds the
     * other columns into the item cell for exactly this reason.
     */
    const floorTotal = orderedColKeys.reduce((sum, k) => sum + floorFor(k), 0);
    const affordable = floorTotal <= avail * 0.5;
    for (let pass = 0; pass < 3; pass++) {
      const free = orderedColKeys.filter((k) => !pinned.has(k));
      const pinnedPx = [...pinned].reduce((sum, k) => sum + px[k]!, 0);
      const freeBase = free.reduce((sum, k) => sum + base[k]!, 0) || 1;
      for (const k of free) px[k] = ((avail - pinnedPx) * base[k]!) / freeBase;
      /* Unaffordable floors are dropped, not the whole allocation.
         This loop used to be skipped entirely when they would not fit, which
         left every width at zero — and a percentage of nothing is nothing, so
         the table went out with `width: 0%` on every column and the item
         column, the one being read, rendered at 0px. Measured on a 520px
         window: the sheet's text was gone. The proportions the operator
         dragged are still the right answer on a narrow screen; only the floors
         are the luxury it cannot pay for. */
      if (!affordable) break;
      const shortfall = free.filter((k) => floorFor(k) > 0 && px[k]! < floorFor(k));
      if (shortfall.length === 0) break;
      for (const k of shortfall) {
        px[k] = floorFor(k);
        pinned.add(k);
      }
    }
    const sum = orderedColKeys.reduce((total, k) => total + (px[k] ?? 0), 0) || 1;
    for (const k of orderedColKeys) colPct[k] = `${(((px[k] ?? 0) / sum) * 100).toFixed(4)}%`;
  }

  const share = (key: string, px: number | undefined): string | number | undefined =>
    colPct[key] ?? (sharing && px != null ? `${((px / colTotalPx) * 100).toFixed(4)}%` : px);

  /**
   * The folded columns' values for one row, as a line under the item.
   *
   * Labelled, because out of its column a value has nothing to say what it is:
   * "CREW" on its own could be a department, a note or a name.
   */
  const foldedLine = (rowRecord: ProjectedRow) => {
    const parts = foldedColumns
      .map((c) => ({ label: c.title, value: (rowRecord.cells[c.key] ?? "").trim() }))
      .filter((p) => p.value);
    if (parts.length === 0) return null;
    return (
      <div className="cell-folded">
        {parts.map((p) => (
          <span key={p.label} className="cf-part">
            <span className="cf-label">{p.label}</span>
            {highlightRoles(p.value, roles)}
          </span>
        ))}
      </div>
    );
  };

  /**
   * What to show in the item column when the sheet left it blank.
   *
   * Plenty of real rows have no name: a run sheet writes "DJ — Barracuda" in
   * the AUDIO column, or "Broadcast | Tries and Goals animations" under
   * SCREEN, and puts nothing at all in ITEM. They are cues like any other and
   * the import is right to leave the title empty — inventing one would put
   * words in the sheet's mouth. But a column of blanks reads as a column of
   * holes, and a page of them reads as a broken import.
   *
   * So the row says what it is, borrowed from its own first piece of content
   * and shown greyed to mark it as borrowed rather than written. The cell
   * itself stays genuinely empty: this is not its value, and typing in it
   * still starts from nothing.
   *
   * The role column is skipped on purpose — "AUDIO" names the department, not
   * the item, and a sheet of rows all called AUDIO is no better than a sheet
   * of blanks.
   */
  /**
   * A title that is only a dash is not a title.
   *
   * Some sheets type one in an item cell they mean to leave blank, and a
   * rundown imported before the generator stopped writing them carries
   * hundreds. Read literally that is a row called "—", which is worse than a
   * row called nothing: it looks like content and says less. Treated as blank
   * here so those rows get a stand-in like any other — a display decision
   * only, so nothing is rewritten in anyone's sheet.
   */
  const blankTitle = (value: string): boolean => /^[\s—–-]*$/.test(value);

  const itemStandIn = (rowRecord: ProjectedRow): string => {
    for (const c of columns) {
      if (c.kind === "title" || c.kind === "startTime" || c.kind === "duration") continue;
      if (meta.roleColumnKeys.includes(c.key)) continue;
      const value = (rowRecord.cells[c.key] ?? "").trim();
      if (value) return value.split("\n")[0]!.trim();
    }
    return "";
  };

  const richColClass = (column: ColumnDef): string =>
    column.kind !== "richtext" ? "" : `col-rich${meta.roleColumnKeys.includes(column.key) ? " col-role" : ""}`;

  const renderRichCell = (rowRecord: ProjectedRow, column: ColumnDef) => {
    const isActive = activeCell?.rowId === rowRecord.id && activeCell.columnId === column.id;
    if (isActive) {
      const fragment = getFragment(rowRecord.id, column.id);
      if (fragment)
        return (
          <td key={column.id} className={`active-cell ${richColClass(column)}`}>
            <CellEditor
              fragment={fragment}
              onDone={() => setActiveCell(null)}
              chips={/^(cue\s*)?type$/i.test(column.title) ? CUE_TYPE_CHIPS : undefined}
            />
          </td>
        );
    }
    // A formatted cell renders its marks; plain cells get role colouring.
    const richXml = rowRecord.cellsRich?.[column.key];
    return (
      <td
        key={column.id}
        className={richColClass(column)}
        onDoubleClick={canEditContent ? () => setActiveCell({ rowId: rowRecord.id, columnId: column.id }) : undefined}
      >
        {/* A read written to be spoken is a paragraph, and a paragraph in a
            grid row pushes every other row off the screen. The sheet shows the
            first couple of lines and trails off; the prompter, which exists to
            be read from, still carries every word. */}
        {column.kind === "title" ? (
          <span className="cell-clamp">
            {/* The blank test comes FIRST, before the formatted branch. A dash
                can be a formatted dash — it was, on the row the cue timer was
                sitting on — and checking rich text first handed those rows
                straight past the stand-in and back to the bare "—". */}
            {blankTitle(rowRecord.cells[column.key] ?? "") ? (
              <span className="cell-standin">{itemStandIn(rowRecord)}</span>
            ) : richXml ? (
              <RichCellText xml={richXml} />
            ) : (
              highlightRoles(rowRecord.cells[column.key] ?? "", roles)
            )}
          </span>
        ) : richXml ? (
          <RichCellText xml={richXml} />
        ) : (
          highlightRoles(rowRecord.cells[column.key] ?? "", roles)
        )}
        {column.kind === "title" && foldedLine(rowRecord)}
      </td>
    );
  };

  const renderDurationCell = (rowRecord: ProjectedRow) => {
    const open = durationPopover === rowRecord.id;
    return (
      <td
        className="mono"
        style={{ position: "relative", cursor: "default" }}
        onDoubleClick={canEditContent ? () => setDurationPopover(rowRecord.id) : undefined}
      >
        {rowRecord.type === "milestone" ? (
          <span className="duration-hidden-marker">—</span>
        ) : rowRecord.durationSec != null ? (
          <span
            className={
              rowRecord.parallel || rowRecord.durationMuted
                ? "duration-muted"
                : rowRecord.durationHidden
                  ? "duration-hidden-marker"
                  : ""
            }
            data-tip={
              rowRecord.parallel
                ? "Alongside the show — not counted in the running order"
                : rowRecord.durationMuted
                  ? "Muted — excluded from timing"
                  : rowRecord.durationHidden
                    ? "Hidden on shared views"
                    : undefined
            }
          >
            {formatDuration(rowRecord.durationSec)}
            {rowRecord.durationHidden ? " ·" : ""}
          </span>
        ) : (
          ""
        )}
        {open && (
          <div className="popover" data-popover style={{ top: "calc(100% - 2px)", left: 0, width: 210 }}>
            <label className="field-label">Duration</label>
            <input
              className="inline-edit"
              autoFocus
              defaultValue={rowRecord.durationSec != null ? formatDuration(rowRecord.durationSec) : ""}
              placeholder="1m30s"
              style={{ width: "100%", marginBottom: 8 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitDuration(rowRecord.id, e.currentTarget.value);
                  setDurationPopover(null);
                }
                if (e.key === "Escape") setDurationPopover(null);
              }}
              onBlur={(e) => commitDuration(rowRecord.id, e.currentTarget.value)}
            />
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", marginBottom: 8 }}>
              Changing it shifts every time below by the same amount.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                className={`btn btn-sm ${rowRecord.durationHidden ? "is-on" : ""}`}
                data-tip="Keep the duration in timing but hide it on shared and guest views"
                onClick={() => setRowField(rowRecord.id, "durationHidden", !rowRecord.durationHidden)}
              >
                Hide
              </button>
              <button
                type="button"
                className={`btn btn-sm ${rowRecord.durationMuted ? "is-on" : ""}`}
                data-tip="Exclude this duration from the running-order math"
                onClick={() => setRowField(rowRecord.id, "durationMuted", !rowRecord.durationMuted)}
              >
                Mute
              </button>
              <button
                type="button"
                className={`btn btn-sm ${rowRecord.parallel ? "is-on" : ""}`}
                data-tip="Runs alongside the show: takes no time in the running order, and the transport steps over it"
                onClick={() => setRowField(rowRecord.id, "parallel", !rowRecord.parallel)}
              >
                ∥ Alongside
              </button>
              <button type="button" className="btn btn-sm btn-ghost" style={{ marginLeft: "auto" }} onClick={() => setDurationPopover(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </td>
    );
  };

  // Close the duration popover on any pointerdown outside it. React's event root
  // is also document-level, so stopPropagation can't shield the popover — check
  // the target instead.
  useEffect(() => {
    if (!durationPopover) return;
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest?.("[data-popover]")) return;
      setDurationPopover(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [durationPopover]);

  const settings = (
    <>
      {/* Only worth showing on a sheet that HAS alternate endings — on a
          corporate day it is a setting for something that never happens. */}
      {outcomeGames.length > 0 && (
        <SideNavSection heading="Endings">
          <button
            type="button"
            className="menu-item"
            data-tip="Every ending stays on the sheet, grouped under the one time its layer starts at"
            onClick={() => chooseOutcomeLayout("layers")}
          >
            <span className="check">{outcomeLayout === "layers" && "✓"}</span>
            Show all, in layers
          </button>
          <button
            type="button"
            className="menu-item"
            data-tip="One line at full time; the branch appears once you call the result"
            onClick={() => chooseOutcomeLayout("fork")}
          >
            <span className="check">{outcomeLayout === "fork" && "✓"}</span>
            One line until called
          </button>
        </SideNavSection>
      )}
      <SideNavSection heading="Views">
        {/* Two companion screens, not three. The follower screen showed the
            current item, a countdown and the next one — which is the timer's
            job with more context, so the timer now carries the item before and
            after and the follower has gone. One fewer thing to explain to a
            crew, and one fewer screen to be looking at the wrong one of. */}
        {(["timer", "prompter"] as const).map((view) => (
          <a
            key={view}
            className="menu-item"
            href={`/${view}/${rundownId}${joinCode ? `?code=${joinCode}` : ""}`}
          >
            <span className="check" />
            {view[0]!.toUpperCase() + view.slice(1)}
          </a>
        ))}
      </SideNavSection>
      <SideNavSection heading="Output">
        <button type="button" className="menu-item" onClick={exportPdf}>
          <span className="check" />
          Export PDF
        </button>
        <button type="button" className="menu-item" onClick={() => window.print()}>
          <span className="check" />
          Print
        </button>
        <button type="button" className="menu-item" onClick={exportCsv}>
          <span className="check" />
          Export CSV
        </button>
      </SideNavSection>
      {isShow && (
        <SideNavSection heading="Show settings">
          <button
            type="button"
            className={`menu-item ${viewingClosed ? "" : "menu-item-danger"}`}
            data-tip={
              viewingClosed
                ? "Let view-only links and read-only accounts open this sheet again"
                : "The event is done: view-only links and read-only accounts stop opening this sheet. You keep yours, and you can reopen it from here."
            }
            onClick={() => setViewing(!viewingClosed)}
          >
            <span className={`check ${viewingClosed ? "on" : ""}`} />
            {viewingClosed ? "Event ended — reopen" : "End event"}
          </button>
          <button type="button" className="menu-item" onClick={saveAsTemplate}>
            <span className="check" />
            Save as template
          </button>
          {(meta.showInfo?.length ?? 0) > 0 && (
            <button type="button" className="menu-item" onClick={() => setPanel(panel === "info" ? null : "info")}>
              <span className="check" />
              Show information
            </button>
          )}
          <button type="button" className="menu-item" onClick={() => setPanel(panel === "history" ? null : "history")}>
            <span className="check" />
            History
          </button>
          <button type="button" className="menu-item" onClick={() => setPanel(panel === "join" ? null : "join")}>
            <span className="check" />
            View-only links
          </button>
        </SideNavSection>
      )}
    </>
  );

  const activeRow = activeRowId ? rows.find((r) => r.id === activeRowId) : null;

  return (
    <WithSideNav title={meta.name} settings={settings}>
    {/* --diag-h is published by the diagnostics bar (fixed to the bottom) so
        the page never hides its own failure message behind it. */}
    {/* A <main>, not a div: the sheet IS this page's content, and without a
        main landmark a screen-reader user has no way to skip the sidenav and
        the header band to reach it. Every other page in the app already has
        one; this — the page people actually live in — did not. */}
    <main
      className="show-page"
      // --diag-h is published by the diagnostics bar; dockBottom is the role
      // bar's height. Both are fixed to the bottom of the screen, and the sheet
      // has to end ABOVE them — a row hidden under a bar is a row not read.
      // The sheet is the page. Side padding was costing 48px of grid at every
      // width, and the bottom only has to clear whatever is docked there.
      style={{
        padding: "0.5rem 0.6rem calc(0.5rem + var(--diag-h, 0px) + var(--rolebar-h, 0px) + var(--nudgedock-h, 0px) + var(--outcomedock-h, 0px))",
      }}
    >
      <div className="show-topbar no-print">
      <header className="topbar-head">
        <div className="topbar-left">
        <div className="topbar-name">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {/* No back arrow. It sat in the same wrapping flex as the sheet name
              and squeezed it into a five-line tower on a tablet, for a job two
              other things already do: the sheet's name IS the way back on any
              narrow screen, and the sidenav carries Dashboard on a wide one. */}
          {/* The sheet's name, changed where it is read. It was set once at
              import from the file name and could only be altered from the
              dashboard — so every sheet was called whatever the PDF was. */}
          {editingName ? (
            <input
              className="inline-edit"
              autoFocus
              defaultValue={meta.name}
              style={{ font: "inherit", fontSize: "1.15rem", fontWeight: 650, letterSpacing: "-0.01em", minWidth: 220 }}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={(e) => commitName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName(e.currentTarget.value);
                if (e.key === "Escape") setEditingName(false);
              }}
            />
          ) : (
            <h1
              className={`${canEditContent && !tapBack ? "sheet-name editable" : "sheet-name"} ${tapBack ? "tap-back" : ""}`}
              style={{ fontSize: "1.15rem", fontWeight: 650, margin: 0, letterSpacing: "-0.01em" }}
              data-tip={
                tapBack
                  ? "Back to the dashboard"
                  : canEditContent
                    ? "Click to rename this sheet"
                    : undefined
              }
              onClick={
                // On a phone the name is the way back, because the arrow that
                // used to do it sat underneath the menu button. Renaming a
                // sheet is a desk job and stays on the wide layout.
                tapBack ? () => router.push("/admin") : canEditContent ? () => setEditingName(true) : undefined
              }
            >
              {meta.name || "Untitled sheet"}
            </h1>
          )}
          {mode !== "show" && <span className="chip">{mode === "edit" ? "EDIT — no transport" : "VIEW ONLY"}</span>}
        </div>
        {/* The sheet's own shape — when it starts, how long it runs, when it
            ends — belongs UNDER its name, not in the row of live readouts.
            It is the same three numbers whether or not a show is running.

            ON AIR TOO. This was hidden once a show started, on the reasoning
            that a caller wants two numbers and not five. That was wrong about
            what the block is for: the planned start, length and end are what
            the night is being measured AGAINST, and they are most worth having
            beside the cue timer, not least. It sits to the left of it — the
            plan on one side, what is actually happening on the other. */}
        <div className="hide-mobile topbar-shape">
          <div
            className="header-clock mono"
            style={canEditContent ? { cursor: "pointer" } : undefined}
            data-tip={canEditContent ? "Click to change the planned start time (an anchored first row overrides it)" : undefined}
            onClick={() => {
              if (!canEditContent) return;
              const raw = window.prompt(
                "Planned start time",
                timing.startSec != null ? formatTimeOfDay(timing.startSec, true) : "9:00 am",
              );
              if (raw === null) return;
              const sec = parseTimeOfDay(raw.trim());
              if (sec == null) {
                window.alert(`Couldn't read "${raw}" as a time — try e.g. 7:30 pm or 19:30.`);
                return;
              }
              doc.getMap("meta").set("plannedStartSec", sec);
            }}
          >
            {/* No "Planned" heading. Start, Dur and End each say what they
                are, and the row of them sits beside a running clock — nothing
                about it needed a title, which was a fourth line of text on a
                block whose whole point is being read at a glance. */}
            <span className="shape-key">Start</span>
            <span className="shape-val">{timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"}</span>
            <span className="shape-key">Dur</span>
            <span className="shape-val">{formatDuration(timing.totalDurationSec)}</span>
            <span className="shape-key">End</span>
            <span className="shape-val">
            {(() => {
              // The last timed item without a duration gets a 30-minute
              // assumption so the show still shows an approximate end.
              let lastIdx = -1;
              for (let i = rows.length - 1; i >= 0; i--) {
                const r = rows[i]!;
                if (r.type !== "group" && !r.skipped && timing.rows[i]!.startSec != null) {
                  lastIdx = i;
                  break;
                }
              }
              // A trailing item with no duration leaves the end open — assume 30
              // minutes, unless the item itself IS the ending (Full time, End…).
              const endish = /\b(end|ends|finish|close|out|full ?time|wrap)\b/i;
              const openEnded =
                lastIdx >= 0 &&
                rows[lastIdx]!.durationSec == null &&
                !rows[lastIdx]!.durationMuted &&
                !endish.test(rows[lastIdx]!.title);
              if (openEnded) {
                const approx = timing.rows[lastIdx]!.startSec! + 30 * 60;
                return <span data-tip="The last item has no duration — assuming 30 minutes">≈{formatTimeOfDayWithDay(approx, meta.use24h)}</span>;
              }
              return timing.endSec != null ? formatTimeOfDayWithDay(timing.endSec, meta.use24h) : "—";
            })()}
            </span>
          </div>
        </div>
        </div>
        </div>
        <div className="topbar-center">
          {showLive && !activeRow && untilShowSec != null && (
            <ShowCountdown
              waitSec={untilShowSec}
              title={
                firstCueRowRecord
                  ? blankTitle(firstCueRowRecord.title)
                    ? itemStandIn(firstCueRowRecord)
                    : firstCueRowRecord.title
                  : ""
              }
            />
          )}
          {live && activeRow && (
            <BigTimer
              live={live}
              paused={isPaused ?? false}
              // A row the sheet never named still has to announce itself on the
              // biggest readout on the page — the same stand-in the sheet uses,
              // rather than the dash that told the showcaller nothing.
              title={blankTitle(activeRow.title) ? itemStandIn(activeRow) : activeRow.title}
              plannedSec={activeRow.durationSec}
              nextTitle={(() => {
                const r = nextRowId ? rows.find((x) => x.id === nextRowId) : null;
                return r ? (blankTitle(r.title) ? itemStandIn(r) : r.title) : null;
              })()}
            />
          )}
          {/* The show's state sits directly under the cue timer, centred —
              that is where the eye already is — and the stopwatch rides on the
              end of the same line, to the right of Stop. It measures what the
              sheet does not time (how long the band actually played, how long
              the crowd took to clear), so it belongs with the clocks rather
              than out among the toolbar buttons; on its own line it pushed the
              sheet down for a control that is used a few times a night. Local
              to this screen: the cue timer above it is the shared truth, and a
              second shared clock would be a second thing to be wrong about. */}
          {isShow && showKnown && (
            <div className="show-state-row">
              {/* Before the doors: rehearsing and going live are the two things
                  you do here, so they share one box. Walkthrough used to sit in
                  the sheet's toolbar among Undo, Redo and Add row — editing
                  controls, which it is not — while the button it leads to was
                  somewhere else entirely. Stepping the crew through the sheet
                  and then starting the show is one sequence, and it now reads
                  as one. The group is gone once the show is live: there is
                  nothing to rehearse, and the transport keeps the row to
                  itself. */}
              <div className={isShow && !showLive && rows.length > 0 ? "preshow-group" : undefined}>
                <ShowStateControls
                  channel={channel}
                  orderedRowIds={rows.filter((r) => (!r.skipped && !r.parallel) || r.id === activeRowId).map((r) => r.id)}
                  preflight={preflight}
                  untilShowSec={untilShowSec}
                />
                {isShow && !showLive && rows.length > 0 &&
                  (() => {
                    const walkable = rows.filter((r) => r.type !== "group" && !r.skipped);
                    const at = walkRowId ? walkable.findIndex((r) => r.id === walkRowId) : -1;
                    // Name the row the way the SHEET names it. This counted its
                    // own position among walkable rows, so on an imported sheet
                    // opening at item 11 it said 1 while the gutter said 11 —
                    // and the gap moves, because banners and skipped rows keep
                    // their number on the sheet and are stepped over here. The
                    // crew are reading the numbers off paper.
                    const here = at >= 0 ? rows.indexOf(walkable[at]!) : -1;
                    const label = here >= 0 ? numberOf(here) : "";
                    return (
                      <>
                        <span
                          className="chip"
                          data-tip={`Rehearse the sheet before the show — Prev/Next move a highlight that every open screen sees${at >= 0 ? ` · ${at + 1} of ${walkable.length} steps` : ""}`}
                        >
                          Walkthrough{label ? ` ${label}` : ""}
                        </span>
                        <button
                          className="btn"
                          disabled={at <= 0}
                          onClick={() => at > 0 && channel.sendCmd("walk", walkable[at - 1]!.id)}
                        >
                          {Icon.prev} Prev
                        </button>
                        <button
                          className="btn"
                          disabled={at >= walkable.length - 1}
                          onClick={() => channel.sendCmd("walk", walkable[Math.min(at + 1, walkable.length - 1)]!.id)}
                        >
                          Next {Icon.next}
                        </button>
                        {walkRowId && (
                          <button className="btn btn-ghost" data-tip="Clear the walkthrough highlight on every screen" onClick={() => channel.sendCmd("walk")}>
                            End walkthrough
                          </button>
                        )}
                      </>
                    );
                  })()}
              </div>
              {/* Only once the show is actually running.
                  Walking the sheet before the doors open is planning, not
                  timing: there is nothing happening to measure, and a stopwatch
                  sitting there invites someone to start it during the
                  walkthrough and then wonder, an hour later, what the number on
                  it refers to. It appears with the show. */}
              {showIsLive && <Stopwatch />}
            </div>
          )}
        </div>
        <div className="topbar-right">
          <LiveReadouts
            live={live}
            use24h={meta.use24h}
            plannedEndSec={timing.endSec}
            activeTitle={activeRow?.title}
            activePlannedSec={
              activeRowId ? timing.rows[rows.findIndex((r) => r.id === activeRowId)]?.startSec ?? null : null
            }
          />
          {/* Both connection lamps together, stacked, hard right — they are one
              reading ("am I connected?"), not two readouts, and they are the
              only thing here that is a state rather than a number. Kept out of
              the row of clocks so the eye can skip them until something goes
              red, which is the only time they matter. */}
          <div className="header-dots hide-mobile">
            <span className={`status-dot ${connected ? "ok" : ""}`}>doc</span>
            <span className={`status-dot ${channel.connected ? "ok" : ""}`}>show</span>
          </div>
          <HeaderClock use24h={meta.use24h} timeZone={channel.timezone} />
        </div>
      </header>

      <div className="sheet-toolbar no-print" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {isShow && (
          <TransportBar
            channel={channel}
            orderedRowIds={rows.filter((r) => (!r.skipped && !r.parallel) || r.id === activeRowId).map((r) => r.id)}
          />
        )}
        {isShow && showLive && (
          <button
            className={`btn btn-sm ${clockFollow ? "is-on" : ""}`}
            style={
              clockSynced
                ? { borderColor: "var(--under)", color: "var(--under)", background: "var(--under-soft)" }
                : clockFollow
                  ? { borderColor: "var(--warn)", color: "var(--warn)", background: "var(--warn-soft)" }
                  : undefined
            }
            /* The drift lives here now, appended to whichever state applies —
               it is a fact ABOUT this chip's subject, and putting it in the
               header meant a number that read +00:00 all night while the clock
               was in charge. On hover it is one sentence that also says what it
               is measured on, which the bare figure never did. */
            data-tip={[
              clockSynced
                ? "The server is running the show off the TIME column, and the live cue is on the row the sheet says should be on air. Press to take the clock off and step the show yourself."
                : clockFollow
                  ? "The server is running the show off the TIME column, but the live cue is not on the row the sheet points at yet — it lines up at the next item. Press to take the clock off and step the show yourself."
                  : "Hand the show to the SERVER: every item starts at its scheduled moment and finished items hand over automatically, even with every console closed. Pause holds; manual jumps self-correct.",
              describeShowDrift(
                live,
                meta.use24h,
                activeRow?.title,
                activeRowId ? timing.rows[rows.findIndex((r) => r.id === activeRowId)]?.startSec ?? null : null,
              ),
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => channel.sendCmd(clockFollow ? "clock_off" : "clock_on")}
          >
            {/* "Following clock" is a claim about who is driving. "Clock
                synced" is a claim about where the show IS, and that is the one
                anybody is actually checking — the two came apart badly enough
                once to be worth separating for good. */}
            ◷ {clockSynced ? "Clock synced" : clockFollow ? "Following clock" : "Follow clock"}
          </button>
        )}
        {/* Undo stays out in the open while the show runs: the timing nudges are
            row changes, so a mis-tapped −30 is undone with one press — which is
            exactly the moment you cannot go hunting through a menu. */}
        {canEditContent && (
          <button
            className="btn btn-sm hide-mobile"
            disabled={undoMgr.undoStack.length === 0}
            data-tip="Undo the last row change (⌘Z) — including a timing nudge, live or not"
            onClick={() => undoMgr.undo()}
          >
            ↺ Undo
          </button>
        )}
        {/* Building the sheet is desk work. While the show is LIVE it sits
            behind a disclosure — nothing is taken away, but the bar you call
            the show from stays down to the things you call it with. */}
        {canEditContent && showLive && (
          <button
            className={`btn btn-sm hide-mobile ${editTools ? "is-on" : ""}`}
            data-tip="Add rows and redo changes while the show is running"
            onClick={() => setEditTools((v) => !v)}
          >
            {editTools ? "✕ Editing" : "✎ Edit sheet"}
          </button>
        )}
        {canEditContent && (!showLive || editTools) && (
          <span className="hide-mobile" style={{ display: "contents" }}>
            <button
              className="btn btn-sm"
              disabled={undoMgr.redoStack.length === 0}
              data-tip="Redo the undone change (⇧⌘Z)"
              onClick={() => undoMgr.redo()}
            >
              ↻ Redo
            </button>
            <button className="btn" onClick={() => addRow("cue")} data-tip="A timed item the show steps through — the normal row">
              {Icon.plus} Row
            </button>
            <button
              className="btn"
              onClick={() => addRow("group")}
              data-tip="A section heading (PRE-GAME, HALF TIME) — organises the sheet into blocks; it has no time and the transport steps past it"
            >
              {Icon.plus} Group
            </button>
            <button
              className="btn"
              onClick={() => addRow("milestone")}
              data-tip="A fixed moment on the clock (DOORS 6:00 PM, KICK-OFF) — marks a time without being something you play; it has no duration"
            >
              {Icon.plus} Milestone
            </button>
          </span>
        )}
        {canEditContent && timingGaps.length > 0 && !reconciling && (
          <button
            className="btn btn-sm"
            style={{ borderColor: "var(--warn)", color: "var(--warn)", background: "var(--warn-soft)" }}
            data-tip="The sheet's TIME and DURATION columns don't add up in these places — open to see each one explained, with the choices for fixing it"
            onClick={() => setReconciling(true)}
          >
            ⚠ {timingGaps.length} timing gap{timingGaps.length === 1 ? "" : "s"} — Reconcile
          </button>
        )}
        {/* Not while the show is running. Which columns are on screen is a
            preparation decision, and the live screen is not where anybody
            should be rearranging the sheet they are calling off. */}
        {!showLive && (
        <Dropdown label={<>{Icon.columns} Columns</>}>
          <div className="menu-heading">Show columns</div>
          {allRichColumns.map((c) => (
            <button key={c.id} type="button" className="menu-item" data-keep-open onClick={() => toggleColumn(c.key)}>
              <span className="check">{!hiddenCols.has(c.key) && Icon.check}</span>
              {c.title}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            data-keep-open
            onClick={() => {
              const next = !showZero;
              setShowZero(next);
              localStorage.setItem(`oc:zerocol:${rundownId}`, next ? "1" : "0");
            }}
          >
            <span className="check">{showZero && Icon.check}</span>
            ZERO countdown
          </button>
          {canEditContent && (
            <>
              <div className="menu-sep" />
              <button type="button" className="menu-item" onClick={addColumn}>
                <span className="check">{Icon.plus}</span> Add column…
              </button>
            </>
          )}
        </Dropdown>
        )}
        {/* Testing the two ending layouts against a live sheet needs the switch
            ON the sheet, not three levels into a menu. Only shown where there
            is something to switch — a sheet with alternate endings. */}
        {outcomeGames.length > 0 && (
          <button
            className="btn btn-sm"
            data-tip={
              outcomeLayout === "layers"
                ? "Every ending is on the sheet, grouped under the one time its layer starts at. Press to collapse each to a single line until it is called."
                : "Each set of endings is one line until you call the result. Press to show them all, in layers."
            }
            onClick={() => chooseOutcomeLayout(outcomeLayout === "layers" ? "fork" : "layers")}
          >
            {outcomeLayout === "layers" ? "⌸ Endings: layered" : "⑂ Endings: one line"}
          </button>
        )}
        {/* The prompter, out here with the transport rather than three levels
            into the Views menu — it is opened mid-show, by somebody who is
            already holding the sheet. Same tab, like every link in the app;
            the prompter has its own way back. */}
        {/* Not on a phone: the prompter is its own full screen and a phone that
            opens it has left the sheet entirely, so the button costs a slot in
            the only toolbar row there is. It is one tap away in the menu. */}
        <Link
          className="btn btn-sm hide-mobile"
          style={{ textDecoration: "none" }}
          href={`/prompter/${rundownId}${joinCode ? `?code=${joinCode}` : ""}`}
          data-tip="Open the prompter: the sheet with the words to be read set large, paced to the item they belong to"
        >
          ▤ Prompter
        </Link>
        <div className="toolbar-tail">
          <RolePicker
            rows={rows}
            roles={roles}
            myRoles={myRoles}
            onChange={(next) => {
              setMyRoles(next);
              if (next.length > 0) localStorage.setItem(`oc:myrole:${rundownId}`, JSON.stringify(next));
              else localStorage.removeItem(`oc:myrole:${rundownId}`);
            }}
          />

        </div>
      </div>
      </div>

      <div className="print-only print-header">
        <div>
          <div style={{ fontSize: "14pt", fontWeight: 700 }}>
            {meta.name}
            {meta.versionLabel ? `  ·  ${meta.versionLabel}` : ""}
          </div>
          <div style={{ fontSize: "9pt" }}>
            Planned {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · duration{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
            {timing.endSec != null ? formatTimeOfDay(timing.endSec, meta.use24h) : "—"}
          </div>
        </div>
        {keyTimes.length > 0 && (
          <table style={{ fontSize: "8.5pt", borderCollapse: "collapse" }}>
            <tbody>
              {keyTimes.map((kt) => (
                <tr key={kt.id}>
                  <td style={{ paddingRight: 10, fontWeight: 600 }}>{kt.label}</td>
                  <td className="mono">{formatTimeOfDay(kt.sec, meta.use24h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {reconciling && (
        <ReconcilePanel
          doc={doc}
          rows={rows}
          timing={timing}
          gaps={timingGaps}
          use24h={meta.use24h}
          onClose={() => {
            setReconciling(false);
            setGapFocus(null);
          }}
          onCurrent={setGapFocus}
        />
      )}

      {panel === "info" && (
        <div className="panel no-print" style={{ display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <strong>Show information</strong>
            <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)", flex: 1, minWidth: 220 }}>
              Printed on every page of the imported document. Kept here so the running order stays the running order.
            </span>
            <button className="btn btn-sm" onClick={() => setPanel(null)}>
              Close
            </button>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-2)", fontSize: "var(--fs-sm)", lineHeight: 1.8 }}>
            {(meta.showInfo ?? []).flatMap((b) => b.lines).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {panel === "history" && (
        <div className="no-print">
          <HistoryPanel rundownId={rundownId} onClose={() => setPanel(null)} />
        </div>
      )}
      {panel === "join" && (
        <div className="no-print">
          <JoinCodesPanel rundownId={rundownId} columns={columns} roleColumnKeys={meta.roleColumnKeys} onClose={() => setPanel(null)} />
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <div className="grid-wrap">
        {activeRowId && !followScroll && (
          <button
            className="btn btn-primary sync-cue"
            data-tip="Ask the server what the cue is, jump to it, and follow along again"
            onClick={syncToCue}
          >
            ⇣ Sync Cue
          </button>
        )}
        <div
          ref={measureGrid}
          className="grid-scroll"
          onMouseOver={
            canEditContent
              ? (e) => {
                  const tr = (e.target as HTMLElement).closest?.("tr[data-rowid]") as HTMLElement | null;
                  const id = tr?.dataset.rowid;
                  if (!id) return;
                  if (nudgeRowAt?.id !== id) {
                    const rowTop = tr!.offsetTop;
                    setNudgeRowAt({ id, top: rowTop });
                    // Placed in the same event as the row it belongs to, so
                    // the strip's first paint is already clear of the header
                    // rather than corrected a frame later.
                    setNudgeTop(clampBelowHeader(e.currentTarget, rowTop));
                  }
                }
              : undefined
          }
          onMouseLeave={canEditContent ? () => setNudgeRowAt(null) : undefined}
        >
        {/* Hover nudges ride the right edge of the sheet, clear of the text —
            and never above the pinned column headers (see `nudgeTop`). */}
        {/* Only while the show is actually running.
            Every button on this strip is a live correction — take five seconds
            out, put fifteen back, or CUE this row now — and none of them mean
            anything to a sheet nobody is calling yet. It was showing whenever
            the sheet was editable, which includes the walkthrough and the edit
            view, where it offered to re-cue a show that has not started and
            put a row's timing out for no reason anybody would later remember.
            `canEditContent` stays in the test: a viewer who may not change the
            sheet may not nudge it either. */}
        {showLive && canEditContent && nudgeRowAt && (
          <div className="timing-nudge-hover" style={{ top: nudgeTop }}>
            <TimingNudge onNudge={(d) => nudgeRow(nudgeRowAt.id, d)} onCue={() => cueRow(nudgeRowAt.id)} skips={cueSkipCount(nudgeRowAt.id)} />
          </div>
        )}
        {canEditContent && selected.size > 0 && (
          // Floats just below the last selected row — the actions clearly
          // belong to the rows they act on without covering any of them.
          //
          // Centred across the sheet rather than tucked against its left edge.
          // Pinned left it sat over the row numbers and the time column, which
          // are the two things you read to check you have selected what you
          // meant to; centred, it covers the middle of a row where the item's
          // own name has already been read.
          <div
            className="selection-bar"
            style={{ position: "absolute", top: selBarTop, left: "50%", transform: "translateX(-50%)", zIndex: 6 }}
          >
            <span className="count">{selected.size} selected</span>
            <button className="btn btn-sm" onClick={duplicateSelected}>
              Duplicate
            </button>
            <button className="btn btn-sm" onClick={toggleGroupSelected}>
              Group
            </button>
            <button
              className="btn btn-sm"
              data-tip="Skip: keeps the row visible but removes it from timing and transport — the show catches back up to the original anchors"
              onClick={() =>
                doc.transact(() =>
                  selected.forEach((id) => {
                    const yRow = yRows.get(id);
                    yRow?.set("skipped", !(yRow.get("skipped") as boolean | undefined));
                  }),
                )
              }
            >
              Skip
            </button>
            <Dropdown label="Win / lose / draw rows…" className="btn btn-sm">
              <div style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", padding: "4px 9px", maxWidth: 230, lineHeight: 1.5 }}>
                These rows only play for one game result. Pick which one they belong to — at full time you choose the
                real result with the buttons at the top, and the rest skip themselves. Imports usually set this for you.
              </div>
              {(
                [
                  ["win", "Play these when we WIN"],
                  ["lose", "Play these when we LOSE"],
                  ["draw", "Play these on a DRAW"],
                  ["golden", "Play these in EXTRA TIME (golden point)"],
                  [null, "Always play these (not result-specific)"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={String(value)}
                  type="button"
                  className="menu-item"
                  onClick={() => doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("outcome", value)))}
                >
                  <span className="check" />
                  {label}
                </button>
              ))}
            </Dropdown>
            {[
              ["rgba(229,72,77,0.16)", "Red"],
              ["rgba(232,176,60,0.16)", "Amber"],
              ["rgba(63,214,143,0.14)", "Green"],
              ["rgba(76,141,255,0.15)", "Blue"],
              ["rgba(167,139,250,0.16)", "Purple"],
            ].map(([color, label]) => (
              <button
                key={color}
                className="color-swatch"
                data-tip={`Highlight ${label}`}
                style={{ background: color }}
                onClick={() => doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("color", color)))}
              />
            ))}
            <button
              className="color-swatch"
              data-tip="Clear highlight"
              style={{ background: "transparent" }}
              onClick={() => doc.transact(() => selected.forEach((id) => yRows.get(id)?.set("color", null)))}
            >
              ✕
            </button>
            {/* Not while the show is on.
                Deleting a row mid-show takes its as-run history with it: what
                was cued, when, and for how long. Afterwards nobody can explain
                what happened, because the evidence went with the row. Striking
                it leaves the row on the sheet, visibly struck, out of the
                timing and out of the transport — which is what "we are not
                doing that any more" actually means at 8:47. That is the Skip
                button a few inches to the left, and it is why this one is not
                here. */}
            {showLive ? (
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-xs)", maxWidth: 210, lineHeight: 1.35 }}>
                Rows are struck rather than deleted once the show is on — use Skip.
              </span>
            ) : (
              <button className="btn btn-sm btn-danger" onClick={deleteSelected}>
                Delete
              </button>
            )}
            <button
              className="btn btn-sm btn-ghost"
              data-tip="Clear selection"
              onClick={() => {
                setSelected(new Set());
                setLastSelected(null);
              }}
            >
              ✕
            </button>
          </div>
        )}
        <table className={`rundown-grid ${fixedStyle ? "cols-fixed" : ""}`} style={fixedStyle}>
          <thead>
            <tr>
              <th data-colkey="rownum" style={{ width: share("rownum", colWidths["rownum"] ?? COL_W.rownum) }}>
                {resizeHandle("rownum", nextColKey("rownum"))}
              </th>
              {orderedColumns.map((c) => {
                /**
                 * The item column takes whatever the others leave.
                 *
                 * The table is fixed-layout so it can never be wider than its
                 * container — but fixed layout with no widths divides the room
                 * equally, which gave a 90px item column beside a 90px DUR and
                 * turned every line of action text into a column of single
                 * words. Sizing the structural and folded columns and leaving
                 * the item alone hands it the surplus, which is right: it is
                 * the thing being read.
                 */
                const w =
                  c.kind === "title"
                    ? (colWidths[c.key] ?? titleWidth ?? undefined)
                    : c.kind === "richtext"
                      ? (colWidths[c.key] ?? c.width ?? COL_W.extra)
                      : (colWidths[c.key] ?? (c.kind === "startTime" ? COL_W.time : c.kind === "duration" ? COL_W.dur : undefined));
                const th = (
                  <th
                    key={c.id}
                    data-colkey={c.key}
                    className={`${richColClass(c)} ${dragCol && dropCol === c.key && dragCol !== c.key ? "col-drop-target" : ""}`}
                    style={
                      w
                        ? {
                            width: share(c.key, w),
                            ...(c.kind === "richtext" && !sharing ? { minWidth: Math.min(w, 140) } : {}),
                          }
                        : undefined
                    }
                    onDragOver={
                      canEditContent
                        ? (e) => {
                            if (!dragCol) return;
                            e.preventDefault();
                            setDropCol(c.key);
                          }
                        : undefined
                    }
                    onDrop={
                      canEditContent
                        ? (e) => {
                            e.preventDefault();
                            if (dragCol && dragCol !== c.key) moveColumn(dragCol, c.key);
                            setDragCol(null);
                            setDropCol(null);
                          }
                        : undefined
                    }
                  >
                    {editingCol === c.id ? (
                      <input
                        className="inline-edit"
                        autoFocus
                        size={1}
                        defaultValue={c.title}
                        style={{ width: "100%", boxSizing: "border-box", font: "inherit", textTransform: "none", letterSpacing: "normal" }}
                        onFocus={(e) => e.currentTarget.select()}
                        onBlur={(e) => commitColTitle(c.id, e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitColTitle(c.id, e.currentTarget.value);
                          if (e.key === "Escape") setEditingCol(null);
                        }}
                      />
                    ) : (
                      <span
                        className="col-label"
                        draggable={canEditContent}
                        data-tip={canEditContent ? "Click to rename · drag to move the column" : undefined}
                        onClick={canEditContent ? () => setEditingCol(c.id) : undefined}
                        onDragStart={(e) => {
                          setDragCol(c.key);
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", c.key);
                        }}
                        onDragEnd={() => {
                          setDragCol(null);
                          setDropCol(null);
                        }}
                      >
                        {c.title}
                      </span>
                    )}
                    {resizeHandle(c.key, nextColKey(c.key))}
                  </th>
                );
                if (c.kind === "duration" && showZero)
                  return (
                    <Fragment key={c.id}>
                      {th}
                      <th data-colkey="zero" style={{ width: share("zero", colWidths["zero"]) }} data-tip="Countdown to the next anchored time">
                        Zero{resizeHandle("zero", nextColKey("zero"))}
                      </th>
                    </Fragment>
                  );
                return th;
              })}
            </tr>
          </thead>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <tbody ref={tbodyRef}>
              {(() => {
                // Imported sheets keep THEIR numbering (blank where the sheet
                // had none); manual rundowns count sequentially. The rule lives
                // in one place so every screen gives a row the same number.
                /**
                 * Cells for a full-width banner row inside the table.
                 *
                 * A row is a leading number cell and then the sheet's own
                 * columns, which the user can reorder — so the time has to be
                 * placed by FINDING the time column rather than by assuming it
                 * comes first. Getting that wrong put the layer's time in the
                 * cue-number column, a third of its width.
                 */
                const timeIdx = orderedColumns.findIndex((c) => c.kind === "startTime");
                const bannerCells = (timeSec: number | null, body: React.ReactNode): React.ReactNode => {
                  const cells: React.ReactNode[] = [<td key="n" />];
                  const lead = timeIdx < 0 ? 0 : timeIdx;
                  for (let c = 0; c < lead; c++) cells.push(<td key={`b${c}`} />);
                  if (timeIdx >= 0)
                    cells.push(
                      <td key="t" className="mono layer-time">
                        {timeSec != null ? formatTimeOfDay(timeSec, meta.use24h) : "—"}
                      </td>,
                    );
                  const used = 1 + lead + (timeIdx >= 0 ? 1 : 0);
                  const totalCells = orderedColumns.length + (showZero ? 1 : 0) + 1;
                  cells.push(
                    <td key="body" colSpan={Math.max(1, totalCells - used)}>
                      {body}
                    </td>,
                  );
                  return cells;
                };
                const spanAll = orderedColumns.length + (showZero ? 1 : 0) + 1;
                /**
                 * Rows outside the window are not built at all.
                 *
                 * The early return IS the saving: everything below it — every
                 * cell, every progress bar, every folded line — is what costs,
                 * and skipping it is why 3,321 rows can cost what sixty do.
                 * Their absence is made up by two empty rows of exactly the
                 * right height, so the scrollbar never notices.
                 */
                const body = rows.map((rowRecord, i) => {
                if (i < rowWindow.from || i >= rowWindow.to) return null;
                const t = timing.rows[i]!;
                const mark = branchAt(i);
                const game = rowRecord.outcomeGame ?? 1;

                const sheetRow = (
                  <SortableRow
                    key={rowRecord.id}
                    row={rowRecord}
                    branch={mark}
                    displayNumber={numberOf(i)}
                    selected={selected.has(rowRecord.id)}
                    active={activeRowId === rowRecord.id}
                    next={nextRowId === rowRecord.id}
                    walk={walkRowId === rowRecord.id}
                    gapMark={
                      gapFocus ? (gapFocus.toId === rowRecord.id ? "to" : gapFocus.fromId === rowRecord.id ? "from" : null) : null
                    }
                    paused={isPaused ?? false}
                    mine={myRowColors.has(rowRecord.id)}
                    mineColor={myRowColors.get(rowRecord.id) ?? "#2dd4bf"}
                    clockMark={clockRowId === rowRecord.id && !activeRowId}
                    runsWith={runsWith.get(rowRecord.id)}
                    onNow={onNowIds.has(rowRecord.id)}
                    disabled={!canEditContent}
                    onSelect={(e) => {
                      if (!canEditContent) return;
                      selectRow(rowRecord.id, e);
                      /**
                       * Walking the sheet: click a row to go there.
                       *
                       * Prev and Next were the only way, so reaching a row
                       * meant walking past every row before it — fine for
                       * stepping through with the crew, useless when somebody
                       * says "take us back to the anthem".
                       *
                       * Only once a walkthrough is ALREADY running. The
                       * highlight is shared with every screen watching, and a
                       * producer clicking rows to colour or skip them before
                       * the doors open should not drag the crew's highlight
                       * around behind them. Prev or Next starts it; after
                       * that, clicking moves it.
                       *
                       * Groups are headings and skipped rows are not
                       * happening, so neither is somewhere to stand — the same
                       * two exclusions Prev and Next already use.
                       */
                      if (
                        isShow &&
                        !showLive &&
                        walkRowId != null &&
                        rowRecord.type !== "group" &&
                        !rowRecord.skipped
                      ) {
                        channel.sendCmd("walk", rowRecord.id);
                      }
                    }}
                  >
                    {orderedColumns.map((col) => {
                      if (col.kind === "richtext") return renderRichCell(rowRecord, col);
                      if (col.kind === "title") {
                        const cell = (() => {
                          const plain = renderRichCell(rowRecord, col);
                          // A row running ALONGSIDE the cue gets its progress
                          // from the clock, because nothing cued it — the coin
                          // toss being recorded in the tunnel is under way
                          // whether or not the showcaller is looking at it.
                          if (activeRowId !== rowRecord.id && onNowIds.has(rowRecord.id)) {
                            const f = clockFrac(rowRecord.id);
                            if (f == null) return plain;
                            return (
                              <td className="mono-progress" style={{ position: "relative" }}>
                                {rowRecord.cells[col.key] ?? ""}
                                {foldedLine(rowRecord)}
                                <BarFill className="row-progress alongside" frac={f} />
                              </td>
                            );
                          }
                          if (activeRowId !== rowRecord.id || !live || rowRecord.durationSec == null || rowRecord.durationSec <= 0)
                            return plain;
                          // Red only after a full second over — the moment between a cue
                          // ending and the next taking over must not flash red.
                          const over = live.remainingInRowSec != null && live.remainingInRowSec < -1;
                          const frac = over
                            ? 1
                            : live.remainingInRowSec != null
                              ? Math.min(1, Math.max(0, 1 - live.remainingInRowSec / rowRecord.durationSec))
                              : 0;
                          return (
                            <td className="mono-progress" style={{ position: "relative" }}>
                              {rowRecord.cells[col.key] ?? ""}
                              {foldedLine(rowRecord)}
                              <BarFill className={`row-progress ${over ? "over" : ""}`} frac={frac} />
                            </td>
                          );
                        })();
                        return <Fragment key={col.id}>{cell}</Fragment>;
                      }
                      if (col.kind === "startTime")
                        return (
                          <td
                            key={col.id}
                            className="mono"
                            style={{ position: "relative" }}
                            onDoubleClick={canEditContent ? () => setEditingTime(rowRecord.id) : undefined}
                          >
                            {editingTime === rowRecord.id ? (
                              // The editor OVERLAYS the cell; the invisible copy of the
                              // display text keeps the column width pixel-identical, so
                              // opening it never shifts the layout.
                              <>
                                <span style={{ visibility: "hidden" }}>
                                  {t.startSec != null ? formatTimeOfDay(t.startSec, meta.use24h) : "—"}
                                </span>
                                <input
                                  ref={timeInputRef}
                                  className="inline-edit"
                                  autoFocus
                                  size={1}
                                  style={{ position: "absolute", inset: "1px 2px", width: "calc(100% - 4px)", boxSizing: "border-box" }}
                                  defaultValue={
                                    rowRecord.hardStartSec != null
                                      ? formatTimeOfDay(rowRecord.hardStartSec, meta.use24h)
                                      : t.startSec != null
                                        ? formatTimeOfDay(t.startSec, meta.use24h)
                                        : ""
                                  }
                                  placeholder="9:30 am"
                                  onFocus={(e) => e.currentTarget.select()}
                                  onBlur={(e) => commitTime(rowRecord.id, e.currentTarget.value, t.startSec ?? null)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitTime(rowRecord.id, e.currentTarget.value, t.startSec ?? null);
                                    if (e.key === "Escape") setEditingTime(null);
                                  }}
                                />
                              </>
                            ) : rowRecord.untimed && rowRecord.hardStartSec == null ? (
                              // The source sheet left this row untimed (a sub-cue) —
                              // faithful blank instead of an invented cascade time.
                              <span style={{ color: "var(--text-3)" }} data-tip="Untimed in the source sheet — double-click to set a time">
                                —
                              </span>
                            ) : t.startSec != null ? (
                              <>
                                {formatTimeOfDay(t.startSec, meta.use24h)}
                                {/* The other way in. A win reached through the
                                    extra period runs the same rows later, and a
                                    sheet printing only the earlier time is
                                    quietly wrong for half the paths through the
                                    day. Hidden in fork layout, where the block
                                    is one line until the path is known. */}
                                {outcomeLayout === "layers" && t.altStartSec != null && (
                                  <span
                                    className="alt-time"
                                    data-tip={`Or ${formatTimeOfDay(t.altStartSec, meta.use24h)}, if the match goes to ${(showType?.extraLabel ?? "extra time").toLowerCase()} first`}
                                  >
                                    or {formatTimeOfDay(t.altStartSec, meta.use24h)}
                                  </span>
                                )}
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                        );
                      // duration column (the synthetic Zero column rides after it)
                      return (
                        <Fragment key={col.id}>
                          {renderDurationCell(rowRecord)}
                          {showZero && (
                            <td className="mono" style={{ color: "var(--text-2)" }}>
                              {(() => {
                                const start = t.startSec;
                                if (start == null) return "";
                                for (let j = i; j < rows.length; j++) {
                                  const other = rows[j]!;
                                  const ot = timing.rows[j]!;
                                  if (other.hardStartSec != null && ot.startSec != null && j > i) {
                                    const zero = ot.startSec - start;
                                    return zero > 0 ? `-${formatDuration(zero)}` : "";
                                  }
                                }
                                return "";
                              })()}
                            </td>
                          )}
                        </Fragment>
                      );
                    })}
                  </SortableRow>
                );

                // An ordinary row, or a sheet with no alternate endings at all.
                if (!mark) return sheetRow;

                /**
                 * Fork layout: the block is one line until something is called.
                 *
                 * Nothing is deleted — the rows are simply not drawn — so
                 * un-calling a result puts them straight back, and every other
                 * screen on the sheet is unaffected by which layout this one
                 * happens to be using.
                 */
                if (outcomeLayout === "fork") {
                  const open = chosenOf(game) == null && !goldenPlaying(game);
                  const forkRow =
                    mark.blockOpens && open ? (
                      <tr key={`fork-${rowRecord.id}`} className="fork-row">
                        {bannerCells(
                          t.startSec,
                          <>
                            <span className="fork-lead">Full time</span>
                            <span className="fork-note">
                              {isShow ? "call it below — the sheet fills in" : "one of these will happen"}
                            </span>
                            {visibleOutcomesOf(game).map((o) => (
                              <span key={o} className={`fork-chip oc-rail-${o}`}>
                                {outcomeLabel(o)}
                              </span>
                            ))}
                          </>,
                        )}
                      </tr>
                    ) : null;
                  if (forkHides(i)) return forkRow;
                  return forkRow ? (
                    <Fragment key={`fk-${rowRecord.id}`}>
                      {forkRow}
                      {sheetRow}
                    </Fragment>
                  ) : (
                    sheetRow
                  );
                }

                // Layered layout: a header carries the one time its whole
                // layer starts at, so no branch row has to repeat it.
                if (mark.layerOpens)
                  return (
                    <Fragment key={`ly-${rowRecord.id}`}>
                      <tr className={`layer-row layer-${mark.layer}`}>
                        {bannerCells(
                          t.startSec,
                          <>
                            <span className="layer-lbl">{layerLabel(game, mark.layer)}</span>
                            <span className="layer-note">
                              {mark.layer === 1
                                ? "only if it goes that far — one of these, all from this time"
                                : "one of these, all from this time"}
                            </span>
                          </>,
                        )}
                      </tr>
                      {sheetRow}
                    </Fragment>
                  );
                return sheetRow;
                });
                if (!rowWindow.active) return body;
                return (
                  <>
                    {rowWindow.padTop > 0 && (
                      <tr aria-hidden className="row-spacer" style={{ height: rowWindow.padTop }}>
                        <td colSpan={spanAll} />
                      </tr>
                    )}
                    {body}
                    {rowWindow.padBottom > 0 && (
                      <tr aria-hidden className="row-spacer" style={{ height: rowWindow.padBottom }}>
                        <td colSpan={spanAll} />
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </SortableContext>
        </table>
        </div>
        </div>
      </DndContext>

      {/* Cue pool parked for now (2026-08-08, user call) — flip to re-enable. */}
      {/* Touch devices cannot hover, so the nudges dock at the bottom and act
          on the row you picked — or the live cue when nothing is selected. */}
      {/* ── The result, asked for where the show is being called ──────────────
          Docked at the foot of the sheet rather than tucked in the toolbar at
          the top: at full time the showcaller is watching the game and the
          bottom of the screen, not the row of buttons above the grid. It
          stacks ABOVE the cue-point dock and the role bar, so it never covers
          either, and it only exists while there is a result still to call. */}
      {isShow && activeGame != null && resultDue(activeGame) && (
        <div ref={publishOutcomeHeight} className={`outcome-dock no-print ${decisionSoon ? "pressing" : ""}`} style={{ bottom: `calc(${dockBottom}px + var(--nudgedock-h, 0px))` }}>
          <span className="od-what">
            {outcomeStage(activeGame) === "settled" ? (
              <span className="od-stage od-done">Result called</span>
            ) : (
              <span className={`od-stage ${decisionSoon ? "od-soon" : ""}`}>
                {outcomeStage(activeGame) === "extra-time"
                  ? `⚡ ${showType?.extraLabel ?? "Extra time"} — call the result`
                  : "Full time — call the result"}
              </span>
            )}
            {/* A deadline, not just a prompt. The chooser is only up for the
                last half-minute, so the number says how much of it is left. */}
            {decisionCountdown != null && (
              <span className="od-count" aria-live="polite">
                {decisionCountdown}s
              </span>
            )}
            {outcomeGames.length > 1 && <span className="od-game">game {activeGame}</span>}
            <span className="od-hint">
              {outcomeStage(activeGame) === "settled"
                ? "The other endings are skipped — the show carries on to it when this item finishes."
                : "Pick one. The show stays on what is on air and moves to it when this item ends."}
            </span>
          </span>
          <span className="od-picks">
            {visibleOutcomesOf(activeGame).map((o) => (
              <button
                key={o}
                className={`btn od-pick od-${o} ${chosenOf(activeGame) === o ? "is-on" : ""}`}
                data-tip={
                  o === "golden"
                    ? "Scores level — play the golden-point block. The final result is asked for again once it lands."
                    : `Play the ${o} ending and skip the others`
                }
                onClick={() => pickOutcome(o, activeGame)}
              >
                {outcomeLabel(o)}
              </button>
            ))}
            {chosenOf(activeGame) && (
              <button className="btn od-reset" data-tip="Un-call it: every ending comes back" onClick={() => clearOutcomeOf(activeGame)}>
                Reset
              </button>
            )}
          </span>
        </div>
      )}

      {/* The docked strip follows the same rule as the hovering one: these are
          live corrections, and CUE is meaningless before anybody has started.
          Two copies of one tool obeying two different rules would be worse
          than either rule. */}
      {showLive &&
        canEditContent &&
        (() => {
          const targetId = selected.size === 1 ? [...selected][0]! : activeRowId;
          const target = targetId ? rows.find((r) => r.id === targetId) : null;
          if (!target) return null;
          return (
            <div className="timing-nudge-dock" ref={publishNudgeHeight} style={{ bottom: dockBottom }}>
              <span className="tn-target" data-tip={target.title || "untitled"}>
                {selected.size === 1 ? "Selected" : "Live"}: {target.title || "untitled"}
              </span>
              <TimingNudge onNudge={(d) => nudgeRow(target.id, d)} onCue={() => cueRow(target.id)} skips={cueSkipCount(target.id)} />
            </div>
          );
        })()}

      <DiagnosticsBar
        rundownId={rundownId}
        doc={docStatus}
        show={{ connected: channel.connected, role: channel.role, timezone: channel.timezone }}
      />

      {CUE_POOL_ENABLED && <CuePool doc={doc} mode={mode} channel={channel} />}
      {myRoles.length > 0 && activeRowId && <div style={{ height: 72 }} />}
      {myRoles.length > 0 && (
        <RoleBar
          myRoles={myRoles}
          roleColorFor={roleColorFor}
          roleColumnKeys={meta.roleColumnKeys}
          rows={rows}
          timing={timing}
          live={live}
          channel={channel}
          activeRowId={activeRowId}
        />
      )}

      {/* Somebody else has the sheet. Say who, and — once they have gone quiet
          — offer it, because a sheet nobody can edit because a producer went
          home is worse than the problem the lock solves. */}
      {mayEditSheet && !lock.mine && lock.view && lock.view.kind !== "yours" && lock.view.kind !== "free" && (
        <div className="edit-lock-bar no-print" role="status">
          <span>
            <strong>{lock.view.by}</strong>{" "}
            {lock.view.kind === "stale"
              ? "left this sheet open and has gone quiet — you can take over."
              : "is editing this sheet. You can watch, and call the show, but not change it."}
          </span>
          {lock.view.kind === "stale" && (
            <button
              type="button"
              className="btn btn-sm btn-primary"
              data-tip="Take the sheet. Their screen goes read-only the moment they come back."
              onClick={() => void lock.claim()}
            >
              Take over
            </button>
          )}
        </div>
      )}

      {/* On the edit screen without the sheet, and nobody else has it either:
          after pressing Done, or when the first claim never landed because the
          server was briefly unreachable. Both used to render NOTHING — a page
          that says EDIT, refuses every keystroke, and offers no way back in.
          The state has to be visible, and it has to be reversible. */}
      {mayEditSheet && !lock.mine && (!lock.view || lock.view.kind === "free" || lock.view.kind === "yours") && (
        <div className="edit-lock-bar no-print" role="status">
          <span>
            This sheet is read-only — you are not holding it. Nobody else is editing it.
          </span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            data-tip="Take the sheet so you can change it. Nobody else can edit while you hold it."
            onClick={() => void lock.claim()}
          >
            Start editing
          </button>
        </div>
      )}

      {/* Holding it. "Done" is this app's save: the sheet stores itself
          continuously, so finishing is the moment that matters to anyone
          waiting for it. */}
      {mayEditSheet && lock.mine && (
        <div className="edit-lock-bar is-mine no-print" role="status">
          <span>You are editing this sheet — nobody else can change it until you finish.</span>
          <button
            type="button"
            className="btn btn-sm"
            data-tip="Hand the sheet back so somebody else can edit it. Everything is already saved."
            onClick={() => void lock.release()}
          >
            Done editing
          </button>
        </div>
      )}

      {/* Driven by hand and left behind: say so, and offer the way out.
          One button, not two. "Catch up now" jumped to the row the sheet
          pointed at and left you driving; Follow clock goes to the same row
          and keeps going, so the pair read as a choice when one was simply
          the other's first move. Catching up without handing over is still
          there — it is cueing the row, which is what that button did. */}
      {cueDriftRows >= 3 && (
        <div className="cue-drift no-print" role="status">
          <span>
            The live cue is <strong>{cueDriftRows} rows</strong>
            {cueDriftSec > 60 ? ` (${Math.round(cueDriftSec / 60)} min)` : ""} behind the clock — nothing is advancing
            it.
          </span>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            data-tip="Hand the show to the clock: it jumps to the row the sheet says should be on air, and the server advances it from there"
            onClick={() => channel.sendCmd("clock_on")}
          >
            Follow clock
          </button>
        </div>
      )}

      {/* A refused command is shown where the person who pressed it is
          looking. Live, "nothing happened" is the worst possible feedback. */}
      {channel.lastCmdError && (
        <div className="cmd-error no-print" role="alert">
          <strong>{channel.lastCmdError.action}</strong> didn&rsquo;t go through — {channel.lastCmdError.msg}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => channel.clearCmdError()}>
            Dismiss
          </button>
        </div>
      )}

      {rows.length === 0 &&
        // Until the document has arrived it is legitimately empty — saying so
        // would be a lie on a slow connection, and hides a real failure when
        // the sheet never loads at all. A refusal, though, is final: waiting
        // will never help, so say what is wrong and what to do about it.
        (docStatus.blocked ? (
          <DocBlockedPanel block={docStatus.blocked} rundownPath={`/${mode}/${rundownId}`} />
        ) : synced ? (
          <div className="empty">
            <div className="glyph">◴</div>
            <div>Empty rundown — add your first row above.</div>
          </div>
        ) : (
          <div className="empty">
            <div className="glyph">◴</div>
            <div>{connected ? "Loading the run sheet…" : "Connecting to the server…"}</div>
            <div style={{ color: "var(--text-3)", fontSize: "var(--fs-sm)", marginTop: 6 }}>
              {connected
                ? "This can take a moment on a phone connection."
                : "Still trying — check this device is online and can reach the server."}
            </div>
          </div>
        ))}

      <div className="print-only print-footer">
        <span>
          {meta.name}
          {meta.versionLabel ? ` · ${meta.versionLabel}` : ""}
        </span>
        <span>Generated {printedAt} · OpenCall</span>
      </div>


    </main>
    </WithSideNav>
  );
}
