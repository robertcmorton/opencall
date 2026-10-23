import { describe, expect, it } from "vitest";
import { computeTiming } from "../src/timing";
import { fixedTargets, planArrivals, planLevel } from "../src/runningLate";
import { mustStartIndexes } from "../src/mustStart";
import type { PlanRow } from "../src/types";

const T = (h: number, m: number) => h * 3600 + m * 60;
const cue = (id: string, durationSec: number, hardStartSec: number | null, extra: Partial<PlanRow> & { title?: string; mustStart?: boolean } = {}) => ({
  id,
  type: "cue" as const,
  durationSec,
  hardStartSec,
  ...extra,
});
/** The plan checked against a hand-marked fixed time at 19:15, an hour before it. */
const check = (rows: ReturnType<typeof cue>[]) => {
  const timing = computeTiming(rows, null);
  const targets = fixedTargets(rows, timing.rows, [], (i) => rows[i]!.id);
  return planArrivals(rows, timing.rows, targets, T(18, 15));
};

describe("planArrivals — the on-time window before the show", () => {
  it("a plan that meets its fixed time exactly is on time", () => {
    const [a] = check([cue("A", 600, T(19, 0)), cue("B", 300, null), cue("KO", 2400, T(19, 15), { mustStart: true })]);
    expect(a!.overSec).toBe(0);
    expect(planLevel(a!)).toBe("spare");
    expect(a!.untilSec).toBe(3600);
  });

  it("an item printed to run past the fixed time makes the plan over by that much", () => {
    // What adding a minute in front of kick-off now does: kick-off keeps 19:15, B runs to 19:16.
    const [a] = check([cue("A", 600, T(19, 0)), cue("B", 360, T(19, 10)), cue("KO", 2400, T(19, 15), { mustStart: true })]);
    expect(a!.overSec).toBe(60);
    expect(planLevel(a!)).toBe("over");
  });

  it("room in front of the fixed time is time to spare", () => {
    const [a] = check([cue("A", 600, T(19, 0)), cue("B", 240, T(19, 10)), cue("KO", 2400, T(19, 15), { mustStart: true })]);
    expect(a!.overSec).toBe(-60);
  });

  it("lateness carries on to the next fixed time; time to spare does not", () => {
    const rows = [cue("A", 960, T(19, 0)), cue("KO", 600, T(19, 15), { mustStart: true }), cue("C", 300, T(19, 25)), cue("H2", 600, T(19, 30), { mustStart: true })];
    const [first, second] = check(rows);
    expect(first!.overSec).toBe(60);
    expect(second!.overSec).toBe(60);
  });
});

describe("mustStartIndexes — the rows a ripple stops at", () => {
  it("finds each half of a game and any row marked by hand", () => {
    const rows = [
      cue("a", 1800, T(18, 0), { title: "Gates open" }),
      cue("b", 120, T(18, 30), { title: "Anthem", mustStart: true }),
      cue("c", 0, T(18, 32), { title: "Kick off" }),
      cue("d", 2400, T(18, 32), { title: "1st Half" }),
      cue("e", 900, T(19, 12), { title: "Half Time" }),
      cue("f", 2400, T(19, 27), { title: "2nd Half" }),
      cue("g", 60, T(20, 7), { title: "Full time" }),
    ];
    expect(mustStartIndexes(rows, null)).toEqual([1, 3, 5]);
  });

  it("a sheet with no game and nothing marked has none", () => {
    expect(mustStartIndexes([cue("a", 600, T(18, 0), { title: "Doors" }), cue("b", 900, null, { title: "Speeches" })], null)).toEqual([]);
  });
});
