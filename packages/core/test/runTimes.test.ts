import { describe, expect, it } from "vitest";
import { blockRowIds, formatOverUnder, joinedLateSec, ranOverUnder, runTimes, type RanRow, type Transition } from "../src/runTimes";
import { computeTiming } from "../src/timing";

const s = (sec: number) => sec * 1000;
const t = (atSec: number, type: string, rowId: string | null): Transition => ({ atMs: s(atSec), type, rowId });

describe("how long each row actually ran", () => {
  it("runs from the move that put it on air to the next one", () => {
    const log = [t(0, "start", "a"), t(90, "next", "b"), t(200, "next", "c"), t(260, "stop", null)];
    const r = runTimes(log);
    expect(r.get("a")).toEqual({ sec: 90, runs: 1, joinedAtMs: 0 });
    expect(r.get("b")).toEqual({ sec: 110, runs: 1 });
    expect(r.get("c")).toEqual({ sec: 60, runs: 1 });
  });

  it("leaves the row still on air out, unless asked to count it to now", () => {
    const log = [t(0, "start", "a"), t(30, "next", "b")];
    expect(runTimes(log).has("b")).toBe(false);
    expect(runTimes(log, s(45)).get("b")).toEqual({ sec: 15, runs: 1 });
  });

  it("takes pauses off", () => {
    const log = [t(0, "start", "a"), t(20, "pause", "a"), t(50, "resume", "a"), t(70, "next", "b")];
    expect(runTimes(log).get("a")!.sec).toBe(40);
  });

  it("ignores entries about other rows, and moves that keep the same row on air", () => {
    const log = [t(0, "start", "a"), t(10, "fire", "Siren"), t(15, "mark_played", "z"), t(20, "clock_hold", "a"), t(60, "next", "b")];
    expect(runTimes(log).get("a")).toEqual({ sec: 60, runs: 1, joinedAtMs: 0 });
    expect(runTimes(log).has("z")).toBe(false);
  });

  it("adds runs together when a row comes back on air", () => {
    const log = [t(0, "jump", "a"), t(30, "jump", "b"), t(40, "jump", "a"), t(50, "stop", null)];
    expect(runTimes(log).get("a")).toEqual({ sec: 40, runs: 2 });
  });

  it("starting with nothing cued counts nothing until a row goes on air", () => {
    const log = [t(0, "start", null), t(300, "clock_on", "a"), t(360, "next", "b")];
    expect(runTimes(log).get("a")!.sec).toBe(60);
  });
});

describe("over and under, as the sheet shows it", () => {
  it("signs and trims", () => {
    expect(formatOverUnder(12)).toBe("+0:12");
    expect(formatOverUnder(-65)).toBe("−1:05");
    expect(formatOverUnder(0)).toBe("±0:00");
    expect(formatOverUnder(3725)).toBe("+1:02:05");
  });
});

describe("the running total over or under", () => {
  const row = (id: string, durationSec: number | null, extra: Partial<{ type: string; parallel: boolean; durationMuted: boolean }> = {}) => ({
    id,
    type: "cue",
    durationSec,
    ...extra,
  });
  const runs = new Map([
    ["a", { sec: 70, runs: 1 }],
    ["b", { sec: 50, runs: 1 }],
    ["side", { sec: 999, runs: 1 }],
    ["muted", { sec: 999, runs: 1 }],
    ["head", { sec: 999, runs: 1 }],
    ["open", { sec: 999, runs: 1 }],
  ]);
  it("adds what each played item ran past (or short of) its planned length", () => {
    expect(ranOverUnder([row("a", 60), row("b", 60)], (id) => runs.get(id))).toBe(0);
    expect(ranOverUnder([row("a", 60)], (id) => runs.get(id))).toBe(10);
  });
  it("leaves out rows alongside the show, muted ones, headings and rows with no length", () => {
    const rows = [
      row("a", 60),
      row("side", 60, { parallel: true }),
      row("muted", 60, { durationMuted: true }),
      row("head", 60, { type: "group" }),
      row("open", null),
    ];
    expect(ranOverUnder(rows, (id) => runs.get(id))).toBe(10);
  });
  it("is null when nothing counted has played", () => {
    expect(ranOverUnder([row("x", 60)], (id) => runs.get(id))).toBeNull();
  });
});

/**
 * Half time with its contents printed inside it (21 Oct 2026). The show goes
 * straight into the first item, so the block itself is on air for a second;
 * its fifteen minutes are measured by the items, not by it.
 */
describe("a block whose items play its length", () => {
  const plan = [
    { id: "half1", type: "cue", hardStartSec: 68_400, durationSec: 2_400 },
    { id: "ht", type: "cue", hardStartSec: 70_800, durationSec: 900 },
    { id: "wrap", type: "cue", hardStartSec: 70_800, durationSec: 300, durationMuted: true },
    { id: "ads", type: "cue", hardStartSec: 71_100, durationSec: 600, durationMuted: true },
    { id: "half2", type: "cue", hardStartSec: 71_700, durationSec: 2_400 },
  ];
  const timing = computeTiming(plan as never, 68_400);

  it("is found from the muted items printed inside it", () => {
    expect([...blockRowIds(plan, timing)]).toEqual(["ht"]);
  });

  it("is found from the importer's mark", () => {
    const spans = [{ id: "a", type: "cue", durationSec: 600, spans: true }, { id: "b", type: "cue", durationSec: 600 }];
    expect([...blockRowIds(spans, computeTiming(spans as never, 0))]).toEqual(["a"]);
  });

  it("is not every row that is followed by another", () => {
    const chain = [
      { id: "a", type: "cue", durationSec: 60 },
      { id: "b", type: "cue", durationSec: 60 },
      // muted, but printed after a's window rather than inside it
      { id: "c", type: "cue", durationSec: 30, durationMuted: true, hardStartSec: 120 },
    ];
    expect(blockRowIds(chain, computeTiming(chain as never, 0)).size).toBe(0);
  });

  it("is left out of the running total", () => {
    const rows: RanRow[] = plan;
    const runs = new Map([["half1", { sec: 2_400, runs: 1 }], ["ht", { sec: 1, runs: 1 }], ["half2", { sec: 2_410, runs: 1 }]]);
    expect(ranOverUnder(rows, (id) => runs.get(id))).toBe(10 - 899);
    expect(ranOverUnder(rows, (id) => runs.get(id), blockRowIds(plan, timing))).toBe(10);
  });
});

/**
 * A first half planned at 48:00 that the show joined thirteen minutes in, then
 * left at the planned end: "ran 34:38", "−13:22" (21 Oct 2026). It was not cut
 * short; the show arrived late to it.
 */
describe("a row the show joined part-way through", () => {
  const sheetSecOf = (ms: number) => 68_400 + ms / 1000; // 7:00 PM at ms 0
  const log = [t(802, "start", "half1"), t(802, "clock_on", "half1"), t(2_880, "jump", "ht")];

  it("remembers where the show started", () => {
    expect(runTimes(log).get("half1")).toEqual({ sec: 2_078, runs: 1, joinedAtMs: s(802) });
    expect(runTimes(log).get("ht")).toBeUndefined();
  });

  it("says how far in the show was", () => {
    expect(joinedLateSec(runTimes(log).get("half1"), 68_400, 2_880, sheetSecOf)).toBe(802);
  });

  it("is an ordinary run when the show started on time", () => {
    const onTime = [t(5, "start", "half1"), t(2_880, "jump", "ht")];
    expect(joinedLateSec(runTimes(onTime).get("half1"), 68_400, 2_880, sheetSecOf)).toBeNull();
  });

  // Started late by hand and left to run: it played all of itself.
  it("is an ordinary run when the row still ran its length", () => {
    const late = [t(802, "start", "half1"), t(3_690, "next", "ht")];
    expect(joinedLateSec(runTimes(late).get("half1"), 68_400, 2_880, sheetSecOf)).toBeNull();
  });

  it("is not a row the show arrived at in turn", () => {
    const later = [t(0, "start", "pre"), t(1_000, "jump", "half1"), t(2_880, "jump", "ht")];
    expect(runTimes(later).get("half1")?.joinedAtMs).toBeUndefined();
  });

  // "Back to clock" mid-show: the clock catches up to the row it wants, part-way through it.
  it("is a row the clock caught up to when it was handed the show back", () => {
    const back = [t(0, "start", "pre"), t(5, "clock_off", "pre"), t(700, "clock_on", "pre"), t(701, "jump", "half1"), t(2_880, "jump", "ht")];
    expect(runTimes(back).get("half1")?.joinedAtMs).toBe(s(701));
    // A person's move after switching it off is theirs, not a catch-up.
    const byHand = [t(0, "start", "pre"), t(700, "clock_off", "pre"), t(701, "jump", "half1")];
    expect(runTimes(byHand, s(800)).get("half1")?.joinedAtMs).toBeUndefined();
  });
});
