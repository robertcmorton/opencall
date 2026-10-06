import { describe, expect, it } from "vitest";
import { formatOverUnder, ranOverUnder, runTimes, type Transition } from "../src/runTimes";

const s = (sec: number) => sec * 1000;
const t = (atSec: number, type: string, rowId: string | null): Transition => ({ atMs: s(atSec), type, rowId });

describe("how long each row actually ran", () => {
  it("runs from the move that put it on air to the next one", () => {
    const log = [t(0, "start", "a"), t(90, "next", "b"), t(200, "next", "c"), t(260, "stop", null)];
    const r = runTimes(log);
    expect(r.get("a")).toEqual({ sec: 90, runs: 1 });
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
    expect(runTimes(log).get("a")).toEqual({ sec: 60, runs: 1 });
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
