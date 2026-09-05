"use client";

import { useEffect, useState, useRef } from "react";
import { formatDuration, formatTimeOfDay,
  formatTimeOfDayWithDay, type LiveShowTiming } from "@opencall/core";
import type { ShowChannel } from "../lib/showChannel";
import { Icon } from "./ui";

function signed(sec: number): string {
  const sign = sec < 0 ? "−" : "+";
  return `${sign}${formatDuration(Math.abs(sec))}`;
}

/**
 * How far off the plan the show is, in a sentence — and what that is measured
 * ON, which is the part that matters.
 *
 * "+8:59:01" is a true number and a useless one alone. It is measured against
 * the row the show is sitting on, so when that row's printed time is wrong the
 * figure is wrong with it, and nothing on screen says which row or what time it
 * claims. That took an evening to work out once, from a number that could have
 * explained itself.
 *
 * It used to be a readout in the header. It stopped being one because while the
 * clock is driving and synced it is pinned near zero by construction — the
 * follower backdates each row to the sheet's own time — so it sat there
 * restating the green chip. It is a real reading only when a person is calling,
 * and then it is a question asked now and then rather than a number watched. So
 * it lives on the clock chip's hover, attached to the state it qualifies.
 */
export function describeShowDrift(
  live: LiveShowTiming | null,
  use24h: boolean,
  activeTitle?: string,
  activePlannedSec?: number | null,
): string | undefined {
  if (!live || live.showDriftSec == null) return undefined;
  // A row with no title of its own — real sheets have them — should not be
  // quoted as if it had one. "measured on “—”" reads like a bug.
  const raw = activeTitle?.split("\n")[0]?.trim() ?? "";
  const named = raw && raw !== "—" ? `“${raw.slice(0, 40)}”` : "the row on air";
  const planned = activePlannedSec != null ? formatTimeOfDayWithDay(activePlannedSec, use24h) : null;
  const on = planned ? `${named}, which the sheet puts at ${planned}` : named;
  const late =
    Math.abs(live.showDriftSec) < 1
      ? "on time"
      : `${signed(live.showDriftSec)} ${live.showDriftSec > 0 ? "behind" : "ahead"}`;
  const over = live.rowOverSec > 1 ? ` It has also run ${formatDuration(live.rowOverSec)} past its length.` : "";
  /**
   * And what time that actually puts you off.
   *
   * The header shows the end the SHEET plans, which does not move. This is the
   * other one — the plan shifted by however late the show is running — and it
   * is the number somebody is really asking for when they ask how we are
   * doing. Two ends side by side in the header read as a contradiction, so the
   * forecast lives here, next to the drift that explains it and under a hover
   * nobody is obliged to read mid-show.
   */
  const off =
    live.projectedEndSec != null
      ? ` At this rate the show comes off at ${formatTimeOfDayWithDay(Math.round(live.projectedEndSec), use24h)}.`
      : "";
  return `The show is ${late}, measured on ${on}.${over}${off}`;
}

export function LiveReadouts({
  live,
  use24h,
  activeTitle,
  activePlannedSec,
  plannedEndSec = null,
}: {
  live: LiveShowTiming | null;
  use24h: boolean;
  /**
   * The time the SHEET says the day ends, as it stands right now — with
   * every strike, move and added row in it.
   *
   * This is the fallback: while a row is on air the forecast — this end plus
   * however late the show is running — is the number shown, because that is
   * the question the readout answers: where does the show come off NOW.
   * Between cues, and before the doors, there is no drift to measure and the
   * sheet's own end is the best forecast there is.
   *
   * The end that was PLANNED lives on the left of the header, beside Start
   * and Dur, and stays put once the show starts. The two are meant to be
   * read against each other — that gap is how far the day has moved.
   */
  plannedEndSec?: number | null;
  /** The row the drift is measured on — see the explanation below. */
  activeTitle?: string;
  /** What the sheet says that row starts at. */
  activePlannedSec?: number | null;
}) {
  // Not gated on `live` any more. That hid the projected end whenever no row
  // was on air — the wait before the first cue, the gap after a Stop — and it
  // hid it for the whole walkthrough. The sheet has an end at every one of
  // those moments; only the drift is missing, and without drift the sheet's
  // end IS the forecast.
  const projectedEndSec = live?.projectedEndSec ?? plannedEndSec;
  return (
    <>
      {/* No "Item" readout here.
          It showed the same number as the cue timer two inches to its left —
          the same computation, not merely a similar one — and a reader who
          notices two clocks has to check whether they agree. This group answers
          how the SHOW is doing, cumulatively: drift, and where it now ends. The
          item countdown is a question about one row, and it already has a
          larger home with the row's name and a progress bar attached. */}
      {/* Projected end first, drift second. The end time is the number people
          ask each other for — "what time are we off?" — and it belongs nearer
          the clocks it is a kind of. The drift beside it then reads as the
          reason that number is moving. */}
      <div className="header-proj">
        <div className="header-label">Proj. end</div>
        <div className="header-clock mono">
          {projectedEndSec != null ? formatTimeOfDayWithDay(Math.round(projectedEndSec), use24h) : "—"}
        </div>
      </div>
      {/* No drift readout here any more.
          While the clock is driving and synced it is pinned near zero by
          construction — the follower backdates every row to the time the sheet
          gives it — so it stood in the header restating what the green chip
          already said. It is a real number only when a person is calling, and
          then it is one question ("how are we doing?") asked occasionally
          rather than a reading watched continuously. It now lives on the
          clock chip's hover, where the state it qualifies already is. */}
    </>
  );
}

/**
 * The show's STATE: start it, hold it, end it, and say which it is.
 *
 * These sit centred directly under the cue timer, because that is where the
 * eye already is. Stepping the cue (Prev/Next) is a different job and lives in
 * the toolbar with the rest of the working controls.
 */
export function ShowStateControls({
  channel,
  orderedRowIds,
  preflight = [],
  /**
   * Seconds until the first item is due, when the show has not reached it yet.
   *
   * Null means there is nothing to wait for — the first cue's time has come, or
   * the sheet never gave one. See `secondsUntilShow`.
   */
  untilShowSec = null,
}: {
  channel: ShowChannel;
  orderedRowIds: string[];
  untilShowSec?: number | null;
  /**
   * Things worth a look before going live, in the words the caller needs.
   *
   * A bad time is cheap to fix at four o'clock and expensive at 8:47. The
   * evening this was written, one cell reading "5:26:00 am" sent a live show
   * twelve hours out of place — and every reading on the page was there to be
   * seen hours earlier, if anything had said so.
   */
  preflight?: string[];
}) {
  const show = channel.show;
  const liveState = show?.state ?? "idle";
  const isLive = liveState === "running" || liveState === "paused";
  const [armStop, setArmStop] = useState(false);
  const armTimer = useRef<number | undefined>(undefined);
  const stopRef = useRef<HTMLButtonElement>(null);
  /**
   * Anything else you touch is an answer of "no".
   *
   * An armed Stop used to sit there until it timed out, so the way to back out
   * was to do nothing and wait — and waiting is the one thing nobody is doing
   * during a show. Carrying on with the sheet now cancels it, which is what
   * carrying on with the sheet means.
   *
   * pointerdown, not click: it runs before the click, so pressing Stop a second
   * time is seen as inside the button and stops the show, while a press
   * anywhere else disarms before that element's own click is delivered. Escape
   * does the same, because a keyboard has nowhere else to press.
   *
   * The ten-second timeout stays underneath as a backstop. Without it an armed
   * button left alone on an unattended console stays armed, and the next stray
   * tap on it ends a live show with no confirmation at all.
   */
  useEffect(() => {
    if (!armStop) return;
    const off = (e: PointerEvent) => {
      if (!stopRef.current?.contains(e.target as Node)) setArmStop(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmStop(false);
    };
    document.addEventListener("pointerdown", off, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", off, true);
      document.removeEventListener("keydown", key);
    };
  }, [armStop]);
  /**
   * Warned about, never blocked.
   *
   * If it is 8:01 and kick-off is at 8:02, the show starts — whatever the
   * sheet says about itself. So a dirty sheet costs one more press and a
   * clean one costs nothing, which is the same bargain Stop already makes.
   */
  const [armStart, setArmStart] = useState(false);
  useEffect(() => () => window.clearTimeout(armTimer.current), []);
  useEffect(() => {
    if (!armStart) return;
    const t = window.setTimeout(() => setArmStart(false), 15000);
    return () => window.clearTimeout(t);
  }, [armStart]);

  /**
   * Only a caller drives the show — but everybody may see whether it is running.
   *
   * This used to return null for anyone else, which took the LIVE / PAUSED
   * badge away along with the buttons. "Is the show on air?" is worth knowing
   * wherever you are sitting, and it is the same line the drift warning
   * already draws: the warning is for everybody, the remedy is for the caller.
   *
   * Before the doors there is no badge to show, so a non-caller still gets
   * nothing rather than an empty strip.
   */
  const mayDrive = channel.role === "caller" || channel.role === "admin";
  if (!mayDrive && !isLive) return null;

  /**
   * Going live is not the same as starting the first item.
   *
   * This always cued row one, whatever the clock said. On a sheet whose first
   * item is at 8pm, opening the show at 11am put that item on air nine hours
   * early: the big timer counted it, and since it was only ever going to be
   * ten minutes long, the show read as hours overdue before anyone arrived.
   *
   * The session opens with nothing cued instead, and the timer counts down to
   * the first item. Following the clock picks it up when its time comes; a
   * showcaller calling it by hand presses Next, which now takes the first item
   * from a standing start.
   */
  const start = () => {
    channel.sendCmd("start", untilShowSec != null ? undefined : orderedRowIds[0]);
    /**
     * …and hand it straight to the clock.
     *
     * Starting used to leave the show wherever `start` put it — row one, or
     * nothing — and following the clock was a second, separate press. Which
     * meant the common case took two actions and the sheet spent the gap
     * between them saying something untrue: a show started at 8pm on a sheet
     * whose current item is number forty sat on item one until somebody
     * noticed.
     *
     * Sent as a second command rather than folded into `start`, because
     * `clock_on` is refused unless the show is already live — that ordering is
     * deliberate on the server, and it carries the correction that matters
     * here: if the clock has not reached the sheet's first item yet it clears
     * the cue rather than pretending something is on air. So the sheet either
     * lands on the row the times say, or waits with nothing cued, and never
     * on row one by default.
     *
     * Still a toggle: anybody calling the show by hand presses it off, and
     * that choice sticks for the session.
     */
    channel.sendCmd("clock_on");
  };

  return (
    <div className="show-state">
      {!isLive ? (
        <>
          <button
            className={`btn ${armStart ? "btn-warn" : "btn-positive"}`}
            onClick={() => {
              if (preflight.length > 0 && !armStart) {
                setArmStart(true);
                return;
              }
              setArmStart(false);
              start();
            }}
            disabled={!channel.connected || orderedRowIds.length === 0}
            data-tip={preflight.length > 0 ? "This sheet has something worth checking first" : undefined}
          >
            {Icon.play} {armStart ? "Start anyway" : "Start show"}
          </button>
          {armStart && (
            <span className="preflight">
              <b>
                {preflight.length} thing{preflight.length === 1 ? "" : "s"} to look at
              </b>
              {preflight.slice(0, 4).map((line, i) => (
                <span key={i}>{line}</span>
              ))}
              {preflight.length > 4 && <span>…and {preflight.length - 4} more</span>}
            </span>
          )}
        </>
      ) : (
        <>
          {/* PAUSED is a wider word than LIVE, and this badge sits at the head
              of the row — so pausing shoved every control after it sideways.
              Fixing the button beside it was not enough; measuring showed Stop
              still moving 11.8px, and this was the rest of it. Same cell trick:
              the badge is always as wide as the longer word. */}
          <span className={`live-badge ${liveState === "paused" ? "paused" : ""}`}>
            <span className="label-swap">
              <span className={liveState === "paused" ? "is-off" : undefined}>LIVE</span>
              <span className={liveState === "paused" ? undefined : "is-off"}>PAUSED</span>
            </span>
          </span>
          {/* NO PAUSE. It froze the clock on the item on air and marked every
              screen PAUSED — while time of day and the printed times beneath
              kept going, so on resume everything under the cue was wrong by
              the length of the pause unless HOLD or the nudges put it right.
              A stoppage is what HOLD is for: it re-times the sheet as it
              waits. Removed from the transport on 4 September 2026. The server
              still understands "pause" and "resume", so a session paused
              before that day can be picked up: Resume is offered then, and
              only then. */}
          {mayDrive && liveState === "paused" && (
            <button
              className="btn btn-sm btn-positive"
              aria-label="Resume the show"
              data-tip="Resume"
              onClick={() => channel.sendCmd("resume")}
            >
              {Icon.play} Resume
            </button>
          )}
          {mayDrive && (
          <button
            // Stopping needs a second press — ending a live show by a stray
            // tap is worse than a wasted one. But the first press has to LOOK
            // like it did something, and three seconds was short enough that a
            // glance away read as a dead button. Ten seconds, and the button
            // says what it is waiting for.
            //
            // Armed, it reads "Confirm" — one word, the same width class as
            // "Stop", and it names the act rather than narrating the mechanism.
            // "Press again to stop" was an instruction to read at the moment
            // there is least time to read one.
            ref={stopRef}
            className={`btn btn-sm btn-danger ${armStop ? "is-on armed" : ""}`}
            // Named for the state it is IN: armed, this button ends the show on
            // the next press, and that is the one thing a screen reader must
            // not have to infer. See the Pause button above.
            aria-label={armStop ? "Confirm — end the show now" : "Stop the show"}
            data-tip={armStop ? "Press again to end the show — or touch anything else to cancel" : "Stop the show — asks once to confirm"}
            onClick={() => {
              if (armStop) {
                channel.sendCmd("stop");
                setArmStop(false);
                window.clearTimeout(armTimer.current);
              } else {
                setArmStop(true);
                window.clearTimeout(armTimer.current);
                armTimer.current = window.setTimeout(() => setArmStop(false), 10000);
              }
            }}
          >
            {Icon.stop}{" "}
            <span className="label-swap">
              <span className={armStop ? "is-off" : undefined}>Stop</span>
              <span className={armStop ? undefined : "is-off"}>Confirm</span>
            </span>
          </button>
          )}
        </>
      )}
    </div>
  );
}

/** Stepping the live cue. The show's own state lives in `ShowStateControls`. */
export function TransportBar({
  channel,
  orderedRowIds,
  nextRowId,
}: {
  channel: ShowChannel;
  orderedRowIds: string[];
  /**
   * Where Next goes, by the shared rule (`nextCueRow`): a called ending left
   * behind the cue first, then the next row not yet played. Prev stays a
   * plain step back — going back is always deliberate.
   */
  nextRowId?: string | null;
}) {
  const show = channel.show;
  const liveState = show?.state ?? "idle";
  const isLive = liveState === "running" || liveState === "paused";

  const step = (dir: 1 | -1) => {
    // Nothing cued yet — the show is live but waiting for its first item. Next
    // takes that item; there is nothing before it to go back to. Without this
    // the transport was dead on a show that had started early, because the
    // only way forward was a cue the show did not have.
    if (!show?.activeRowId) {
      if (dir === 1 && orderedRowIds[0]) channel.sendCmd("next", orderedRowIds[0]);
      return;
    }
    const idx = orderedRowIds.indexOf(show.activeRowId);
    const target = dir === 1 && nextRowId !== undefined ? nextRowId : orderedRowIds[idx + dir];
    if (target) channel.sendCmd(dir === 1 ? "next" : "prev", target);
  };

  // Space / Shift+Space transport shortcuts — ignored while typing in a cell.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !isLive) return;
      // Optional call: a keydown can arrive with `document` as its target,
      // which has no closest(). It threw there, and a handler that throws is a
      // handler that is gone — taking the only remaining way to step a live
      // cue with it, for the rest of the session and without a word.
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /**
   * No buttons on a live show — the keyboard only.
   *
   * Prev and Next are how you WALK a sheet: before the show, with the crew,
   * stepping through to see what is coming. Live they answer the wrong
   * question. A showcaller does not take "the next one", they take a
   * particular item, by name, because a producer just said its name — and the
   * sheet already offers that on the row itself, where the thing being called
   * can be read. A blind step beside a running clock is a way to lose your
   * place with no record of why.
   *
   * The walkthrough keeps its own Prev and Next, which is where they belong.
   *
   * Space and Shift+Space stay: they are muscle memory, they cost no room on
   * the screen, and they are the one control a showcaller can use without
   * looking down. This component still exists to own them.
   */
  return null;
}
