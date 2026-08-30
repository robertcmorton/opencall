import { describe, expect, it } from "vitest";
import { ABANDON_AFTER_MS, abandonedSessions } from "../src/sessions";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-30T20:00:00Z");
const ago = (hours: number) => ({ id: `s${hours}`, lastMoveAt: NOW - hours * HOUR });

describe("abandonedSessions", () => {
  it("leaves a show that has merely gone quiet", () => {
    // Six hours is where the dashboard starts DOUBTING a session. A long
    // interval, a changeover, a rain delay — all still a real show, and
    // stopping one from a timer is the thing this must never do.
    expect(abandonedSessions([ago(1), ago(6), ago(12), ago(23)], NOW)).toEqual([]);
  });

  it("ends one that has gone a full day without a command", () => {
    expect(abandonedSessions([ago(24), ago(40)], NOW).map((s) => s.id)).toEqual(["s24", "s40"]);
  });

  it("measures from the start when a session never moved at all", () => {
    // Somebody pressed Start and closed the laptop. There is no command in the
    // as-run log to measure from, so the start IS the last sign of life.
    const started = { id: "never-moved", lastMoveAt: NOW - 30 * HOUR };
    expect(abandonedSessions([started], NOW).map((s) => s.id)).toEqual(["never-moved"]);
  });

  it("is exactly a day, not about a day", () => {
    expect(abandonedSessions([{ id: "just-under", lastMoveAt: NOW - ABANDON_AFTER_MS + 1000 }], NOW)).toEqual([]);
    expect(abandonedSessions([{ id: "bang-on", lastMoveAt: NOW - ABANDON_AFTER_MS }], NOW).map((s) => s.id)).toEqual(["bang-on"]);
  });

  it("takes a threshold, so the rule can be exercised without waiting a day", () => {
    expect(abandonedSessions([ago(2)], NOW, HOUR).map((s) => s.id)).toEqual(["s2"]);
  });
});
