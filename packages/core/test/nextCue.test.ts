import { describe, expect, it } from "vitest";
import { calledEndingBehind, clockStep, nextCueRow, type ClockTargetRow } from "../src/live";

const cue = (id: string, extra: Partial<ClockTargetRow> = {}): ClockTargetRow => ({ id, type: "cue", ...extra });

/** The real-sheet order: results written above the extra period, then the rest of the night. */
const sheet = (skipped: Partial<Record<string, boolean>> = {}): ClockTargetRow[] =>
  [
    cue("h2", { hardStartSec: 20 * 3600 }), // second half
    cue("ft", { hardStartSec: 21 * 3600 }), // full time
    cue("win1", { outcome: "win", untimed: true }),
    cue("win2", { outcome: "win", untimed: true }),
    cue("lose1", { outcome: "lose", untimed: true }),
    cue("gp1", { outcome: "golden", untimed: true }),
    cue("gp2", { outcome: "golden", untimed: true }),
    cue("gp3", { outcome: "golden", untimed: true }),
    cue("draw1", { outcome: "draw", untimed: true }),
    cue("plug", { hardStartSec: 22 * 3600 }),
    cue("out", { hardStartSec: 22 * 3600 + 600 }),
  ].map((r) => ({ ...r, skipped: !!skipped[r.id] }));

describe("nextCueRow", () => {
  it("is the next row the show can stand on, skipping struck rows", () => {
    expect(nextCueRow(sheet({ win1: true }), "ft")).toBe("win2");
  });
  it("steps over rows already played", () => {
    expect(nextCueRow(sheet(), "ft", new Set(["win1", "win2"]))).toBe("lose1");
  });
  it("goes back for a result called after golden point, then carries on past the extra time", () => {
    // Golden called (results struck), the show has played gp1 and gp2 and sits on gp3.
    const golden = sheet({ win1: true, win2: true, lose1: true, draw1: true });
    const played = new Set(["h2", "ft", "gp1", "gp2"]);
    expect(nextCueRow(golden, "gp3", played)).toBe("plug"); // nothing called yet: onward
    // Win called: win rows un-struck, draw and lose stay struck.
    const won = sheet({ lose1: true, draw1: true });
    expect(calledEndingBehind(won, "gp3", played).map((r) => r.id)).toEqual(["win1", "win2"]);
    expect(nextCueRow(won, "gp3", played)).toBe("win1");
    // On win1 (gp3 has now left air): win2 next.
    const played2 = new Set([...played, "gp3"]);
    expect(nextCueRow(won, "win1", played2)).toBe("win2");
    // On win2: the golden rows are played, so the show lands on the plug, not back in extra time.
    const played3 = new Set([...played2, "win1"]);
    expect(nextCueRow(won, "win2", played3)).toBe("plug");
  });
  it("a result called at full time is ahead, not behind, and plays in order", () => {
    const won = sheet({ lose1: true, gp1: true, gp2: true, gp3: true, draw1: true });
    expect(calledEndingBehind(won, "ft")).toEqual([]);
    expect(nextCueRow(won, "ft")).toBe("win1");
  });
  it("answers null at the end of the sheet", () => {
    expect(nextCueRow(sheet(), "out")).toBeNull();
  });
});

describe("clockStep with played rows", () => {
  it("stepping off the last golden row after Win advances to the winning song, not the plug", () => {
    const won = sheet({ lose1: true, draw1: true });
    const played = new Set(["h2", "ft", "gp1", "gp2"]);
    const durations = won.map((r) => (r.outcome === "golden" ? 300 : r.outcome ? 60 : 1800));
    const step = clockStep(won, durations, "gp3", 301, played);
    expect(step).toEqual({ kind: "advance", rowId: "win1" });
  });
  it("stepping off the winning song passes the played extra time", () => {
    const won = sheet({ lose1: true, draw1: true });
    const played = new Set(["h2", "ft", "gp1", "gp2", "gp3", "win1"]);
    const durations = won.map((r) => (r.outcome === "golden" ? 300 : r.outcome ? 60 : 1800));
    const step = clockStep(won, durations, "win2", 61, played);
    expect(step).toEqual({ kind: "advance", rowId: "plug" });
  });
});
