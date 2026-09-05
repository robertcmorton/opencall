import { describe, expect, it } from "vitest";
import { ShowStateMachine } from "../src/show";

describe("ShowStateMachine", () => {
  it("runs a full start → pause → resume → jump → stop lifecycle", () => {
    const m = new ShowStateMachine();
    const started = m.apply("start", "row-1", 1000);
    expect(started).toMatchObject({ state: "running", activeRowId: "row-1", seq: 1 });

    const paused = m.apply("pause", undefined, 2000);
    expect(paused).toMatchObject({ state: "paused", pausedAtMs: 2000 });

    const resumed = m.apply("resume", undefined, 5000);
    expect(resumed).toMatchObject({ state: "running", pausedAccumMs: 3000, pausedAtMs: null });

    const jumped = m.apply("jump", "row-9", 6000);
    expect(jumped).toMatchObject({ activeRowId: "row-9", activeRowStartedAtMs: 6000, pausedAccumMs: 0 });

    const stopped = m.apply("stop", undefined, 7000);
    expect(stopped).toMatchObject({ state: "ended", activeRowId: null, seq: 5 });
  });

  it("rejects invalid transitions with reasons", () => {
    const m = new ShowStateMachine();
    expect(m.apply("pause", undefined)).toBe("not running");
    m.apply("start", "row-1");
    expect(m.apply("start", "row-1")).toBe("show already live");
  });

  it("bumps seq monotonically on every accepted command", () => {
    const m = new ShowStateMachine();
    m.apply("start", "a");
    m.apply("next", "b");
    m.apply("next", "c");
    expect(m.current.seq).toBe(3);
  });
});

describe("pre-show walkthrough", () => {
  it("moves the cursor while idle, clears on start, and refuses while live", () => {
    const m = new ShowStateMachine();
    expect(m.apply("walk", "row-3")).toMatchObject({ state: "idle", walkRowId: "row-3" });
    expect(m.apply("walk", undefined)).toMatchObject({ walkRowId: null });
    m.apply("walk", "row-5");
    expect(m.apply("start", "row-1")).toMatchObject({ state: "running", walkRowId: null });
    expect(m.apply("walk", "row-2")).toBe("show is live — use the transport");
    m.apply("stop", undefined);
    expect(m.apply("walk", "row-7")).toMatchObject({ state: "ended", walkRowId: "row-7" });
  });
});

describe("clock-follow backdating", () => {
  it("records a row as starting when the SHEET says, not when the follower noticed", () => {
    // Following the clock at 20:27 lands on a row the sheet started at 19:37.
    // Recording it as beginning now would report the show 50 minutes late and
    // put 51 minutes back on an item with 2 left.
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1_000);
    const plannedStartMs = 10_000_000;
    const noticedMs = plannedStartMs + 50 * 60 * 1000;
    const jumped = m.apply("jump", "row-408", noticedMs, plannedStartMs);
    expect(jumped).toMatchObject({ activeRowId: "row-408", activeRowStartedAtMs: plannedStartMs });
  });

  it("a person pressing Next still starts the row now", () => {
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1_000);
    expect(m.apply("next", "row-2", 5_000)).toMatchObject({ activeRowStartedAtMs: 5_000 });
  });
});

/**
 * Clock-follow is a toggle, and only a toggle.
 *
 * There used to be a second pair of commands — clock_hold / clock_release —
 * that stopped the advance without giving up follow. They were retired in
 * v1.7: holding and releasing did exactly what clock_off and clock_on do, so
 * the app carried two controls for one behaviour and neither label could
 * explain why the other existed.
 */
describe("clock-follow", () => {
  it("switches on and off without touching the show", () => {
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1000);
    expect(m.apply("clock_on", undefined, 1100)).toMatchObject({ clockFollow: true });
    // The SHOW is untouched: handing the cue to the clock is not a pause, and
    // nothing downstream should see a frozen timer because of it.
    expect(m.current.state).toBe("running");
    expect(m.apply("clock_off", undefined, 2000)).toMatchObject({ clockFollow: false });
    expect(m.current.state).toBe("running");
  });

  it("refuses to follow a show that is not live", () => {
    const m = new ShowStateMachine();
    expect(m.apply("clock_on", undefined, 1000)).toBe("not live");
  });

  it("stops following when the show ends", () => {
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1000);
    m.apply("clock_on", undefined, 1100);
    expect(m.apply("stop", undefined, 3000)).toMatchObject({ clockFollow: false, state: "ended" });
  });
});

/**
 * Catching up to the clock is a claim about where the show already is.
 *
 * Reported from a live show: follow clock, then catch up, and the show
 * immediately read +1:19. The jump stamped the row as starting at the moment
 * the button was pressed, so the drift became exactly however overdue that row
 * was — the opposite of what pressing "catch up" had just asserted. Clock-follow
 * had backdated for this reason since it was written; a hand-pressed catch-up
 * went down a different path and did not.
 */
describe("catch up to the clock", () => {
  it("records the row as starting when the SHEET says, not when the button was pressed", () => {
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1_000);
    const plannedStartMs = 10_000_000;
    const pressedAtMs = plannedStartMs + 79_000; // the reported 1:19 late
    const state = m.apply("jump", "row-9", pressedAtMs, plannedStartMs);
    expect(typeof state).not.toBe("string");
    expect((state as Exclude<typeof state, string>).activeRowStartedAtMs).toBe(plannedStartMs);
  });

  it("still starts an ordinary jump at the moment it is taken", () => {
    // Jumping somewhere on purpose means "we are taking this now" — only a
    // catch-up asks for the sheet's time.
    const m = new ShowStateMachine();
    m.apply("start", "row-1", 1_000);
    const takenAtMs = 10_079_000;
    const state = m.apply("jump", "row-9", takenAtMs);
    expect((state as Exclude<typeof state, string>).activeRowStartedAtMs).toBe(takenAtMs);
  });
});

describe("the cue timer represents the live show only", () => {
  // The machine is handed a row id by the caller; the server is where rows are
  // known, so these assert the invariant the server enforces: a row running
  // alongside the show never becomes the active row.
  const sheet = [
    { id: "a", parallel: false },
    { id: "pre", parallel: true },
    { id: "b", parallel: false },
  ];
  const mayCue = (id: string) => !sheet.find((r) => r.id === id)?.parallel;

  it("refuses to cue a pre-record", () => {
    expect(mayCue("pre")).toBe(false);
  });

  it("still cues the rows that are on air", () => {
    expect(mayCue("a")).toBe(true);
    expect(mayCue("b")).toBe(true);
  });

  it("leaves the machine itself unchanged for rows that are allowed", () => {
    const m = new ShowStateMachine();
    m.apply("start", "a", 1000);
    const after = m.apply("jump", "b", 2000);
    expect(typeof after).not.toBe("string");
    expect((after as { activeRowId: string | null }).activeRowId).toBe("b");
  });
});

/**
 * The show that reported itself four hours ahead of itself.
 *
 * Start cues the first row — right, while a person is in charge. Switching the
 * follower on afterwards changed who was in charge without changing what was
 * cued, and the follower could not correct it: a clock that has not reached
 * the sheet returns no target, and the loop leaves the cue alone. So the
 * correction happens at the handover, and the server decides, because only the
 * server can see the sheet's times.
 */
describe("handing the show to the clock", () => {
  it("clears a cue the clock would never have made", () => {
    const m = new ShowStateMachine();
    m.apply("start", "first", 1000);
    expect(m.current.activeRowId).toBe("first");

    // clearCue: the clock has not reached the sheet's first item.
    const after = m.apply("clock_on", undefined, 2000, undefined, true);
    expect(after).toMatchObject({ clockFollow: true, activeRowId: null, activeRowStartedAtMs: null });
  });

  it("leaves a cue alone when the clock HAS reached the sheet", () => {
    const m = new ShowStateMachine();
    m.apply("start", "first", 1000);
    const after = m.apply("clock_on", undefined, 2000);
    expect(after).toMatchObject({ clockFollow: true, activeRowId: "first" });
  });

  it("never drags a show backwards just because the follower was switched on", () => {
    // Mid-show, deliberately ahead of the clock. Switching the follower on
    // must not yank the cue back — the follower itself refuses to do that.
    const m = new ShowStateMachine();
    m.apply("start", "first", 1000);
    m.apply("jump", "eighth", 2000);
    const after = m.apply("clock_on", undefined, 3000);
    expect(after).toMatchObject({ clockFollow: true, activeRowId: "eighth" });
  });

  it("goes live and waits: the first item can still be cued afterwards", () => {
    const m = new ShowStateMachine();
    m.apply("start", "first", 1000);
    m.apply("clock_on", undefined, 2000, undefined, true);
    expect(m.current.activeRowId).toBeNull();
    expect(m.current.state).toBe("running");

    // What the follower does when the clock finally arrives at the first item.
    const after = m.apply("jump", "first", 9000, 8500);
    expect(after).toMatchObject({ activeRowId: "first", activeRowStartedAtMs: 8500 });
  });

  it("cannot arm the follower before a show is live — which is why `start` needs no guard", () => {
    const m = new ShowStateMachine();
    expect(m.apply("clock_on", undefined, 1000)).toBe("not live");
    expect(m.current.clockFollow).toBe(false);
    // And stopping puts it back down, so every start begins with it off.
    m.apply("start", "first", 2000);
    m.apply("clock_on", undefined, 3000);
    expect(m.current.clockFollow).toBe(true);
    m.apply("stop", undefined, 4000);
    expect(m.current.clockFollow).toBe(false);
  });
});

describe("played rows", () => {
  it("records a row as played when it leaves air, never the cue itself, and Start empties the list", () => {
    const m = new ShowStateMachine();
    m.apply("start", "r1", 1000);
    expect(m.current.playedRowIds).toEqual([]);
    m.apply("next", "r2", 2000);
    expect(m.current.playedRowIds).toEqual(["r1"]);
    m.apply("jump", "r2", 3000); // re-cueing the same row plays nothing
    expect(m.current.playedRowIds).toEqual(["r1"]);
    m.apply("prev", "r1", 4000);
    expect(m.current.playedRowIds).toEqual(["r1", "r2"]);
    m.apply("next", "r2", 5000); // r1 leaves again: listed once
    expect(m.current.playedRowIds).toEqual(["r1", "r2"]);
    m.apply("stop", undefined, 6000);
    expect(m.current.playedRowIds).toEqual(["r1", "r2"]); // the as-run record survives Stop
    m.apply("start", "r1", 7000);
    expect(m.current.playedRowIds).toEqual([]);
  });
});
