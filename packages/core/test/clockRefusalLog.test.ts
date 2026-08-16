import { describe, expect, it } from "vitest";
import { reportClockRefusal } from "../src/live";

/**
 * The follower refuses to take a show backwards, and that refusal is correct.
 * What was wrong was saying so once a second: the loop ticks at 1 Hz, so one
 * show parked in that state wrote ~3,600 lines an hour into the log that is
 * supposed to surface real faults. These pin the cadence, because the loop
 * itself cannot be imported and so cannot be tested.
 */
describe("reportClockRefusal", () => {
  it("reports the first time a show refuses", () => {
    const seen = new Map<string, string>();
    expect(reportClockRefusal(seen, "show1", "rowA")).toBe(true);
  });

  it("stays silent while the same show refuses the same target", () => {
    const seen = new Map<string, string>();
    reportClockRefusal(seen, "show1", "rowA");
    // One tick per second for four hours is what this stands in for.
    for (let tick = 0; tick < 14_400; tick += 1) {
      expect(reportClockRefusal(seen, "show1", "rowA")).toBe(false);
    }
  });

  it("reports again when the target changes — a different target is a different state", () => {
    const seen = new Map<string, string>();
    reportClockRefusal(seen, "show1", "rowA");
    expect(reportClockRefusal(seen, "show1", "rowB")).toBe(true);
    expect(reportClockRefusal(seen, "show1", "rowB")).toBe(false);
  });

  it("reports again after the caller clears the show — a real recurrence is not swallowed", () => {
    const seen = new Map<string, string>();
    reportClockRefusal(seen, "show1", "rowA");
    expect(reportClockRefusal(seen, "show1", "rowA")).toBe(false);
    // The caller clears whenever the follower is NOT refusing: the show stops,
    // the clock catches up, or the follower moves.
    seen.delete("show1");
    expect(reportClockRefusal(seen, "show1", "rowA")).toBe(true);
  });

  it("keeps shows apart — one stuck show does not silence another", () => {
    const seen = new Map<string, string>();
    expect(reportClockRefusal(seen, "show1", "rowA")).toBe(true);
    expect(reportClockRefusal(seen, "show2", "rowA")).toBe(true);
    expect(reportClockRefusal(seen, "show1", "rowA")).toBe(false);
    expect(reportClockRefusal(seen, "show2", "rowA")).toBe(false);
  });
});
