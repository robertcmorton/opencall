"use client";

import Link from "next/link";

import { useCallback, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { ulid } from "ulid";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  absoluteNow,
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
  zoneSecondsOfDay,
} from "@opencall/core";
import { describeDevice, viewerName } from "../lib/viewerIdentity";
import { api, setActiveJoinCode } from "../lib/api";
import { exportRundownPdf } from "../lib/exportPdf";
import { projectRundownDoc, type ColumnDef, type ProjectedRow } from "@opencall/db/doc";
import { CuePool } from "./CuePool";
import { ReconcilePanel, findTimingGaps } from "./ReconcilePanel";
import { KeyTimesEditor } from "./KeyTimes";
import { CellEditor } from "./CellEditor";
import { GuestPassPanel, HistoryPanel, JoinCodesPanel } from "./SharePanels";
import { LiveReadouts, ShowStateControls, TransportBar } from "./TransportBar";
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
  disabled: boolean;
  onSelect: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id, disabled });
  return (
    <tr
      ref={setNodeRef}
      className={`${row.type === "group" ? "group-row" : ""} ${row.type === "milestone" ? "milestone-row" : ""} ${selected ? "selected" : ""} ${active ? "active-row" : ""} ${next ? "next-row" : ""} ${walk ? "walk-row" : ""} ${gapMark ? `gap-row gap-row-${gapMark}` : ""} ${active && paused ? "paused" : ""} ${mine ? "my-role-row" : ""} ${row.skipped ? "skipped-row" : ""} ${row.parallel ? "parallel-row" : ""} ${clockMark ? "clock-row" : ""} ${
        branch
          ? `branch-row oc-rail-${branch.outcome} ${branch.opens ? "branch-open" : ""} ${branch.closes ? "branch-close" : ""} ${branch.blockOpens ? "branch-block-open" : ""} ${branch.blockCloses ? "branch-block-close" : ""} ${branch.dim ? "branch-dim" : ""}`
          : ""
      }`}
      data-rowid={row.id}
      data-tip={
        walk
          ? "Walkthrough position — synced to every screen"
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
      <td className="row-number mono" onClick={onSelect} {...attributes} {...listeners}>
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
  for (const field of ["type", "hardStartSec", "durationSec", "durationMuted", "durationHidden", "backtime", "color", "outcome", "parallel"]) {
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
}: {
  live: import("@opencall/core").LiveShowTiming;
  paused: boolean;
  title: string;
  plannedSec: number | null;
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
      <div className="bt-label">
        {paused ? "PAUSED · " : ""}
        {title || "—"}
      </div>
      <div className="bt-time">{display}</div>
      <div className="bt-bar">
        <BarFill frac={frac} />
      </div>
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
}: {
  rundownId: string;
  mode?: EditorMode;
  joinCode?: string;
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
  const { doc, connected, synced, status: docStatus } = useRundownDoc(rundownId, joinCode);
  // The hook re-renders on every doc update, so projecting during render stays fresh.
  const { meta, keyTimes, roles, columns, rows } = projectRundownDoc(doc);
  const timing = computeTiming(rows, meta.plannedStartSec);
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
  const activeRowId = channel.show?.state === "running" || channel.show?.state === "paused" ? channel.show.activeRowId : null;
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
  const [panel, setPanel] = useState<"guest" | "history" | "join" | "info" | null>(null);
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
  // Row the timing nudges act on when hovering (pointer devices).
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
  // Ticks the event-local clock cursor along the TIME column.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => window.clearInterval(id);
  }, []);
  // Phones show only the essentials (title/start/duration + the role column);
  // this opts back into the full sheet.
  /**
   * The grid's own width, watched so the column folding can react to a window
   * resize or a phone turning sideways without a reload.
   */
  const [gridWidth, setGridWidth] = useState<number | null>(null);
  const measureGrid = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const read = () => setGridWidth(el.clientWidth);
    read();
    new ResizeObserver(read).observe(el);
  }, []);
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
    const target = scroller.scrollTop + (row.top - box.top) - (box.height - row.height) / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  };

  // Auto-scroll keeps the active row centered while following. A manual
  // scroll (wheel/touch) disengages following instead of fighting the user;
  // the floating "Sync Cue" button re-engages it.
  const programmaticScroll = useRef(false);
  const focusRowId = activeRowId ?? walkRowId;
  useEffect(() => {
    if (!focusRowId || !followScroll) return;
    // Opening a rundown that is ALREADY live: the show state often arrives
    // before the document's rows have rendered, so retry until the live row
    // exists — first thing on screen is the current cue, centred.
    let cancelled = false;
    let settle: number | undefined;
    const attempt = (left: number) => {
      if (cancelled) return;
      const el = document.querySelector("tr.active-row, tr.walk-row");
      if (el) {
        programmaticScroll.current = true;
        centreInSheet(el);
        settle = window.setTimeout(() => {
          programmaticScroll.current = false;
        }, 1000);
      } else if (left > 0) {
        settle = window.setTimeout(() => attempt(left - 1), 300);
      }
    };
    attempt(20);
    return () => {
      cancelled = true;
      window.clearTimeout(settle);
    };
  }, [focusRowId, followScroll]);
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
   * The timing check belongs to preparation, not to the show.
   *
   * It reports where the sheet's own TIME and DURATION columns disagree — a
   * question for whoever is building the sheet, answered before anyone goes on
   * air. Once the show is running the disagreements are the POINT: a game runs
   * long, an item is cut, the cue is dragged back to now. A live screen that
   * counts those as faults is crying wolf at the one person who cannot afford
   * to look away, so the check runs on import and in the walkthrough only.
   */
  const timingGaps = showLive ? [] : findTimingGaps(rows, timing);
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
  const clockTarget = (rowList: ProjectedRow[], t: typeof timing, tz: string | null | undefined): string | null => {
    // Counted past midnight, like the sheet — a wall clock resets at 00:00 and
    // a show running into the small hours does not.
    const now = absoluteNow(zoneSecondsOfDay(channel.serverNow(), tz), t);
    let target: string | null = null;
    for (let i = 0; i < rowList.length; i++) {
      const r = rowList[i]!;
      if (r.type === "group" || r.skipped) continue;
      if (r.untimed && r.hardStartSec == null) continue;
      const start = t.rows[i]!.startSec;
      if (start != null && start <= now) target = r.id;
    }
    return target;
  };
  const clockRowId = clockTarget(rows, timing, channel.timezone);

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
    const offered = outcomesFor(channel.sport, outcomeStage(g) === "extra-time", customTypes);
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
  const [viewingClosed, setViewingClosed] = useState(false);
  useEffect(() => {
    void api
      .rundownEpoch(rundownId)
      .then((r) => setViewingClosed(r.viewingClosed))
      .catch(() => {});
  }, [rundownId]);
  const setViewing = (closed: boolean): void => {
    if (
      closed &&
      !window.confirm(
        "Close this run sheet?\n\nCrew codes, guest passes and view-only accounts will stop opening it. You and anyone who can edit the sheet keep your access, and you can open it again from here.",
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
        doc.transact(() => {
          yRows.get(rowId)?.set("hardStartSec", sec);
          if (delta === 0) return;
          const order = yOrder.toArray();
          const idx = order.indexOf(rowId);
          if (idx < 0) return;
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
            {richXml ? <RichCellText xml={richXml} /> : highlightRoles(rowRecord.cells[column.key] ?? "", roles)}
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
        {(["follow", "timer", "prompter"] as const).map((view) => (
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
            className="menu-item"
            data-tip={
              viewingClosed
                ? "Let crew codes, guest passes and view-only accounts open this sheet again"
                : "The event is done: stop crew codes, guest passes and view-only accounts from opening this sheet. You keep yours."
            }
            onClick={() => setViewing(!viewingClosed)}
          >
            <span className={`check ${viewingClosed ? "on" : ""}`} />
            {viewingClosed ? "Closed to viewers — reopen" : "Close to viewers"}
          </button>
          <button type="button" className="menu-item" onClick={saveAsTemplate}>
            <span className="check" />
            Save as template
          </button>
          <button type="button" className="menu-item" onClick={() => setPanel(panel === "guest" ? null : "guest")}>
            <span className="check" />
            Guest pass
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
            Join codes
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
    <div
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
          {/* The way back. It was only in the settings drawer, so getting to
              the dashboard meant opening a panel and hunting for a link — and
              after an import there was no back at all. */}
          {/* Icon only, and a fixed size. As a text button it changed width
              with the label and sat in the same wrapping flex as the sheet
              name, so it moved every time the window did. */}
          {/* Not for someone on a view-only link: they have no dashboard, and
              a back button that lands on a sign-in page is worse than none. */}
          {mode !== "view" && (
            <Link className="back-to-dash" href="/admin" aria-label="Back to the dashboard" data-tip="Back to the dashboard">
              ←
            </Link>
          )}
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
              className={canEditContent ? "sheet-name editable" : "sheet-name"}
              style={{ fontSize: "1.15rem", fontWeight: 650, margin: 0, letterSpacing: "-0.01em" }}
              data-tip={canEditContent ? "Click to rename this sheet" : undefined}
              onClick={canEditContent ? () => setEditingName(true) : undefined}
            >
              {meta.name || "Untitled sheet"}
            </h1>
          )}
          {mode !== "show" && <span className="chip">{mode === "edit" ? "EDIT — no transport" : "VIEW ONLY"}</span>}
        </div>
        {/* The sheet's own shape — when it starts, how long it runs, when it
            ends — belongs UNDER its name, not in the row of live readouts.
            It is the same three numbers whether or not a show is running, and
            labelling them "Planned" only invited the question of what the
            unplanned ones would be. */}
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
            {timing.startSec != null ? formatTimeOfDay(timing.startSec, meta.use24h) : "—"} · dur{" "}
            {formatDuration(timing.totalDurationSec)} · end{" "}
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
          </div>
        </div>
        </div>
        </div>
        <div className="topbar-center">
          {live && activeRow && (
            <BigTimer
              live={live}
              paused={isPaused ?? false}
              title={activeRow.title}
              plannedSec={activeRow.durationSec}
            />
          )}
          {/* The show's state sits directly under the cue timer, centred —
              that is where the eye already is. */}
          {isShow && (
            <ShowStateControls
              channel={channel}
              orderedRowIds={rows.filter((r) => !r.skipped || r.id === activeRowId).map((r) => r.id)}
            />
          )}
        </div>
        <div className="topbar-right">
          <LiveReadouts live={live} use24h={meta.use24h} />
          <span className={`status-dot hide-mobile ${connected ? "ok" : ""}`}>doc</span>
          <span className={`status-dot hide-mobile ${channel.connected ? "ok" : ""}`}>show</span>
          <HeaderClock use24h={meta.use24h} timeZone={channel.timezone} />
        </div>
      </header>

      <div className="sheet-toolbar no-print" style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        {isShow && (
          <TransportBar
            channel={channel}
            orderedRowIds={rows.filter((r) => !r.skipped || r.id === activeRowId).map((r) => r.id)}
          />
        )}
        {isShow && !showLive && rows.length > 0 && (
          <>
            {/* Pre-show walkthrough: step the shared cursor through the sheet
                with the crew — every connected screen follows along. */}
            {(() => {
              const walkable = rows.filter((r) => r.type !== "group" && !r.skipped);
              const at = walkRowId ? walkable.findIndex((r) => r.id === walkRowId) : -1;
              return (
                <>
                  <span className="chip" data-tip="Rehearse the sheet before the show — Prev/Next move a highlight that every open screen sees">
                    Walkthrough{at >= 0 ? ` ${at + 1}/${walkable.length}` : ""}
                  </span>
                  <button
                    className="btn btn-sm"
                    disabled={at <= 0}
                    onClick={() => at > 0 && channel.sendCmd("walk", walkable[at - 1]!.id)}
                  >
                    {Icon.prev} Prev
                  </button>
                  <button
                    className="btn btn-sm"
                    disabled={at >= walkable.length - 1}
                    onClick={() => channel.sendCmd("walk", walkable[Math.min(at + 1, walkable.length - 1)]!.id)}
                  >
                    Next {Icon.next}
                  </button>
                  {walkRowId && (
                    <button className="btn btn-sm btn-ghost" data-tip="Clear the walkthrough highlight on every screen" onClick={() => channel.sendCmd("walk")}>
                      End walkthrough
                    </button>
                  )}
                </>
              );
            })()}
          </>
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
            data-tip={
              clockSynced
                ? "The server is running the show off the TIME column, and the live cue is on the row the sheet says should be on air. Press to take the clock off and step the show yourself."
                : clockFollow
                  ? "The server is running the show off the TIME column, but the live cue is not on the row the sheet points at yet — it lines up at the next item. Press to take the clock off and step the show yourself."
                  : "Hand the show to the SERVER: every item starts at its scheduled moment and finished items hand over automatically, even with every console closed. Pause holds; manual jumps self-correct."
            }
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
        <Link
          className="btn btn-sm"
          style={{ textDecoration: "none" }}
          href={`/prompter/${rundownId}${joinCode ? `?code=${joinCode}` : ""}`}
          data-tip="Open the prompter: the sheet with the words to be read set large, paced to the item they belong to"
        >
          ▤ Prompter
        </Link>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
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

      {panel === "guest" && (
        <div className="no-print">
          <GuestPassPanel rundownId={rundownId} columns={columns} onClose={() => setPanel(null)} />
        </div>
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
            data-tip="Jump back to the live cue and follow along again"
            onClick={() => {
              setFollowScroll(true);
              programmaticScroll.current = true;
              const live = document.querySelector("tr.active-row");
              if (live) centreInSheet(live);
              window.setTimeout(() => {
                programmaticScroll.current = false;
              }, 1000);
            }}
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
                  if (nudgeRowAt?.id !== id) setNudgeRowAt({ id, top: tr!.offsetTop });
                }
              : undefined
          }
          onMouseLeave={canEditContent ? () => setNudgeRowAt(null) : undefined}
        >
        {/* Hover nudges ride the right edge of the sheet, clear of the text. */}
        {canEditContent && nudgeRowAt && (
          <div className="timing-nudge-hover" style={{ top: nudgeRowAt.top }}>
            <TimingNudge onNudge={(d) => nudgeRow(nudgeRowAt.id, d)} onCue={() => cueRow(nudgeRowAt.id)} skips={cueSkipCount(nudgeRowAt.id)} />
          </div>
        )}
        {canEditContent && selected.size > 0 && (
          // Floats just below the last selected row — the actions clearly
          // belong to the rows they act on without covering any of them.
          <div className="selection-bar" style={{ position: "absolute", top: selBarTop, left: 8, zIndex: 6 }}>
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
            <button className="btn btn-sm btn-danger" onClick={deleteSelected}>
              Delete
            </button>
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
              <th data-colkey="rownum" style={{ width: colWidths["rownum"] ?? COL_W.rownum }}>
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
                    style={w ? { width: w, ...(c.kind === "richtext" ? { minWidth: Math.min(w, 140) } : {}) } : undefined}
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
                      <th data-colkey="zero" style={{ width: colWidths["zero"] }} data-tip="Countdown to the next anchored time">
                        Zero{resizeHandle("zero", nextColKey("zero"))}
                      </th>
                    </Fragment>
                  );
                return th;
              })}
            </tr>
          </thead>
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <tbody>
              {(() => {
                // Imported sheets keep THEIR numbering (blank where the sheet
                // had none); manual rundowns count sequentially.
                const mirrored = rows.some((r) => r.sourceNumber != null);
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
                return rows.map((rowRecord, i) => {
                const t = timing.rows[i]!;
                const mark = branchAt(i);
                const game = rowRecord.outcomeGame ?? 1;

                const sheetRow = (
                  <SortableRow
                    key={rowRecord.id}
                    row={rowRecord}
                    branch={mark}
                    displayNumber={mirrored ? (rowRecord.sourceNumber ?? "") : String(i + 1)}
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
                    disabled={!canEditContent}
                    onSelect={(e) => canEditContent && selectRow(rowRecord.id, e)}
                  >
                    {orderedColumns.map((col) => {
                      if (col.kind === "richtext") return renderRichCell(rowRecord, col);
                      if (col.kind === "title") {
                        const cell = (() => {
                          const plain = renderRichCell(rowRecord, col);
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

      {canEditContent &&
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


    </div>
    </WithSideNav>
  );
}
