import { describe, expect, it } from "vitest";
import { nextForRole, type NextCandidate } from "../lib/nextForRole";

const row = (index: number, startSec: number | null, role: string | null, eligible = true): NextCandidate => ({ index, startSec, role, eligible });

const sheet = [
  row(0, 9 * 3600, "prompter"),
  row(1, 10 * 3600, null),
  row(2, 11 * 3600, "prompter"),
  row(3, 12 * 3600, "prompter", false), // struck
  row(4, 13 * 3600, "prompter"),
  row(5, null, "prompter"),
];

describe("nextForRole", () => {
  it("before the show, skips my items whose planned time has passed", () => {
    expect(nextForRole(sheet, { running: false, activeIndex: -1, nowSec: 10 * 3600 + 30 * 60 })?.index).toBe(2);
  });
  it("before the show, an untimed item is still next once the timed ones are gone", () => {
    expect(nextForRole(sheet, { running: false, activeIndex: -1, nowSec: 14 * 3600 })?.index).toBe(5);
  });
  it("with a cue, counts from the cue and ignores the clock", () => {
    // Cue on row 0 at two in the afternoon: row 2 is next, though its time has gone.
    expect(nextForRole(sheet, { running: true, activeIndex: 0, nowSec: 14 * 3600 })?.index).toBe(2);
  });
  it("never offers a struck row or a heading, and answers null when nothing is left", () => {
    expect(nextForRole(sheet, { running: true, activeIndex: 2, nowSec: 0 })?.index).toBe(4);
    expect(nextForRole(sheet.slice(0, 4), { running: true, activeIndex: 2, nowSec: 0 })).toBeNull();
  });
});
