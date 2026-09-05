import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../src/csv";
import { classifyRows, detectHeaderRow, detectOutcomes, mapColumns } from "../src/import";
import {
  calledEndingBehind,
  keepAfterResult,
  nextCueRow,
  resultCalled,
  type ClockTargetRow,
  type EndingRow,
} from "../src/live";

/**
 * The endings, run a thousand ways.
 *
 * A show is walked from kick-off to venue clear by the transport's own rule
 * (`nextCueRow`, which is what Next, the clock and the readouts all use),
 * while results are called the way the dock calls them (`keepAfterResult`),
 * at every moment a showcaller could press them: at full time, in the
 * holding, mid-half, after the whole period, twice, changed, reset. Sheets
 * are written in every order a real sheet has been seen in, with and
 * without lose and draw branches, with one game or two, and with a block
 * BUILT at full time on a sheet that never wrote endings.
 *
 * What must hold, every run:
 *  - a row is never on air twice;
 *  - a struck row is never cued;
 *  - once a result is called, the next cues are that branch in sheet order
 *    and then the first row past the endings — never back into extra time;
 *  - extra time already played stays; extra time not yet played is struck;
 *  - pressing the same result again changes nothing;
 *  - changing the call swaps the branch and keeps what was played;
 *  - a result in one game never touches the other game's endings.
 */

interface SimRow extends ClockTargetRow {
  id: string;
  type: "cue";
  skipped: boolean;
  outcome?: string | null;
  outcomeGame?: number;
}

type Order = "wlgd" | "wldg" | "gwld" | "wl_g" | "w_g_";

function sheet(order: Order, games: 1 | 2, built = false): SimRow[] {
  const rows: SimRow[] = [];
  let n = 0;
  const cue = (id: string, extra: Partial<SimRow> = {}) => {
    rows.push({ id: `${id}#${n++}`, type: "cue", skipped: false, ...extra });
  };
  for (let g = 1; g <= games; g++) {
    cue(`kick${g}`, { hardStartSec: 3600 * g });
    cue(`h1_${g}`, { hardStartSec: 3600 * g + 60 });
    cue(`ht_${g}`, { hardStartSec: 3600 * g + 120 });
    cue(`h2_${g}`, { hardStartSec: 3600 * g + 180 });
    const parts: Record<string, () => void> = {
      w: () => {
        cue(`wcap${g}`, { outcome: "win", outcomeGame: g, untimed: true });
        cue(`w1_${g}`, { outcome: "win", outcomeGame: g, untimed: true });
        cue(`w2_${g}`, { outcome: "win", outcomeGame: g, untimed: true });
      },
      l: () => {
        cue(`l1_${g}`, { outcome: "lose", outcomeGame: g, untimed: true });
      },
      g: () => {
        cue(`gcap${g}`, { outcome: "golden", outcomeGame: g, untimed: true });
        cue(`gp1_${g}`, { outcome: "golden", outcomeGame: g, untimed: true });
        cue(`gp2_${g}`, { outcome: "golden", outcomeGame: g, untimed: true });
        cue(`gp3_${g}`, { outcome: "golden", outcomeGame: g, untimed: true });
        cue(`gp4_${g}`, { outcome: "golden", outcomeGame: g, untimed: true });
      },
      d: () => {
        cue(`d1_${g}`, { outcome: "draw", outcomeGame: g, untimed: true });
      },
      _: () => undefined,
    };
    if (built) {
      // No endings written. The block gets built at full time, after h2.
      cue(`ft_${g}`, { hardStartSec: 3600 * g + 240 });
    } else {
      for (const ch of order) parts[ch]!();
    }
    cue(`post${g}`, { hardStartSec: 3600 * g + 600 });
  }
  cue("clear", { hardStartSec: 9 * 3600 });
  return rows;
}

class Show {
  active: string | null = null;
  readonly played = new Set<string>();
  readonly log: string[] = [];
  constructor(public rows: SimRow[]) {}
  liveIndex() {
    return this.active ? this.rows.findIndex((r) => r.id === this.active) : -1;
  }
  endings(game: number): EndingRow[] {
    return this.rows
      .map((r, index) => ({ r, index }))
      .filter(({ r }) => r.outcome && (r.outcomeGame ?? 1) === game)
      .map(({ r, index }) => ({ id: r.id, index, outcome: r.outcome!, skipped: r.skipped }));
  }
  start(id: string) {
    this.active = id;
    this.log.push(id);
  }
  next(): boolean {
    const n = nextCueRow(this.rows, this.active, this.played);
    if (!n) return false;
    const row = this.rows.find((r) => r.id === n)!;
    expect(row.skipped, `cued a struck row ${n}`).toBe(false);
    expect(this.played.has(n), `cued ${n} twice`).toBe(false);
    if (this.active) this.played.add(this.active);
    this.active = n;
    this.log.push(n);
    return true;
  }
  /** The dock's `pickOutcome`. */
  call(o: string, game: number) {
    const keep = keepAfterResult(this.endings(game), o, this.liveIndex());
    for (const r of this.rows) if (r.outcome && (r.outcomeGame ?? 1) === game) r.skipped = !keep.has(r.id);
  }
  reset(game: number) {
    for (const r of this.rows) if (r.outcome && (r.outcomeGame ?? 1) === game) r.skipped = false;
  }
  /** Build the extra-time block after the row on air, as `insertGoldenPointAfter` does. */
  build(game: number) {
    const at = this.liveIndex();
    const block: SimRow[] = ["hold", "gp1", "hold2", "gp2"].map((t) => ({
      id: `built_${t}_${game}#${this.rows.length + Math.random()}`,
      type: "cue",
      skipped: false,
      outcome: "golden",
      outcomeGame: game,
      untimed: true,
    }));
    this.rows.splice(at + 1, 0, ...block);
  }
  snapshot() {
    return this.rows.map((r) => `${r.id}:${r.skipped ? "x" : "."}`).join(" ");
  }
}

const lcg = (seed: number) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = <T>(rnd: () => number, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

function endingSpan(show: Show, game: number) {
  const e = show.endings(game);
  return { first: Math.min(...e.map((r) => r.index)), last: Math.max(...e.map((r) => r.index)) };
}

/** Run one show under one set of conditions and check every invariant. */
function runOne(seed: number): string {
  const rnd = lcg(seed);
  const order = pick(rnd, ["wlgd", "wldg", "gwld", "wl_g", "w_g_"] as const);
  const games = pick(rnd, [1, 2] as const);
  const built = rnd() < 0.15;
  const show = new Show(sheet(order, games, built));
  const notes: string[] = [`seed=${seed} order=${order} games=${games} built=${built}`];
  show.start(show.rows[0]!.id);
  for (let game = 1; game <= games; game++) {
    // Walk to this game's second half.
    while (!show.active!.startsWith(`h2_${game}`)) expect(show.next()).toBe(true);
    if (built) {
      // Sheet wrote nothing: at full time the block gets built, played, and a
      // result is called somewhere inside it (or right after).
      expect(show.next()).toBe(true); // ft
      show.build(game);
      const stepsIn = Math.floor(rnd() * 5); // 0..4 rows into the block
      for (let i = 0; i < stepsIn; i++) show.next();
      show.call(pick(rnd, ["win", "lose"]), game);
      notes.push(`built: called ${stepsIn} rows in`);
      const golden = show.rows.filter((r) => r.outcome === "golden" && (r.outcomeGame ?? 1) === game);
      const live = show.liveIndex();
      for (const r of golden) {
        const idx = show.rows.indexOf(r);
        expect(r.skipped, `built golden ${r.id} at ${idx} vs cue ${live}`).toBe(idx > live);
      }
      // Onward: never back into the block, never a struck row.
      while (show.next()) {
        if (show.active!.startsWith("post")) break;
      }
      expect(show.active!.startsWith(`post${game}`)).toBe(true);
      continue;
    }
    const has = (o: string) => show.endings(game).some((r) => r.outcome === o);
    const results = ["win", "lose", "draw"].filter(has);
    const goldenFirst = has("golden") && rnd() < 0.6;
    // Where to call: at full time (before any ending), or n rows into extra time.
    let callAt = 0;
    if (goldenFirst) {
      show.call("golden", game);
      notes.push("golden point called at full time");
      // Every result struck, every golden row playing.
      for (const r of show.endings(game)) expect(r.skipped).toBe(r.outcome !== "golden");
      callAt = Math.floor(rnd() * 6); // 0 = still on h2, up to past the whole period
      for (let i = 0; i < callAt; i++) show.next();
    }
    const result = pick(rnd, results);
    const before = show.snapshot();
    show.call(result, game);
    notes.push(`${result} called ${callAt} rows into extra time`);
    // Extra time played stays; extra time not reached is struck.
    const live = show.liveIndex();
    for (const r of show.endings(game)) {
      if (r.outcome === "golden") {
        const playedOrOnAir = r.index <= live && !before.includes(`${r.id}:x`);
        expect(r.skipped, `golden ${r.id}`).toBe(!playedOrOnAir);
      } else expect(r.skipped, `result ${r.id}`).toBe(r.outcome !== result);
    }
    expect(resultCalled(show.endings(game))).toBe(results.length > 1 ? result : results.length === 1 ? null : null);
    // Pressing it again changes nothing.
    const once = show.snapshot();
    show.call(result, game);
    expect(show.snapshot()).toBe(once);
    // Sometimes the call is changed, sometimes reset and re-called.
    let final = result;
    if (results.length > 1 && rnd() < 0.3) {
      final = pick(rnd, results.filter((o) => o !== result));
      show.call(final, game);
      notes.push(`changed to ${final}`);
    } else if (rnd() < 0.15) {
      show.reset(game);
      for (const r of show.endings(game)) expect(r.skipped).toBe(false);
      show.call(final, game);
      notes.push("reset and re-called");
    }
    // From here the transport must play the branch, in order, then leave.
    const branch = show.rows.filter((r) => r.outcome === final && (r.outcomeGame ?? 1) === game && !r.skipped && !show.played.has(r.id) && r.id !== show.active).map((r) => r.id);
    const expectedBehind = calledEndingBehind(show.rows, show.active, show.played).map((r) => r.id);
    if (results.length > 1) {
      // The rule agrees with the dock about what is behind the cue.
      const behindBySheet = branch.filter((id) => show.rows.findIndex((r) => r.id === id) < live);
      expect(expectedBehind).toEqual(behindBySheet);
    }
    const seen: string[] = [];
    while (show.next()) {
      seen.push(show.active!);
      if (show.active!.startsWith("post")) break;
    }
    expect(show.active!.startsWith(`post${game}`), `landed on ${show.active} — ${seen.join(" > ")}`).toBe(true);
    // The branch, in sheet order, then straight out.
    const played = seen.slice(0, -1);
    expect(played, notes.join(" | ")).toEqual(branch);
    // The other game's endings are untouched.
    if (games === 2) {
      const other = game === 1 ? 2 : 1;
      if (game === 1) for (const r of show.endings(other)) expect(r.skipped).toBe(false);
    }
  }
  while (show.next()) {
    /* to the end */
  }
  expect(show.active).toBe(show.rows[show.rows.length - 1]!.id);
  expect(new Set(show.log).size).toBe(show.log.length);
  return notes.join(" | ");
}

describe("the endings, swept", () => {
  it("holds every invariant across a thousand seeded shows", () => {
    const runs: string[] = [];
    for (let seed = 1; seed <= 1000; seed++) runs.push(runOne(seed));
    // Every condition got exercised, not just the easy ones.
    expect(runs.some((n) => n.includes("built:"))).toBe(true);
    expect(runs.some((n) => n.includes("golden point called"))).toBe(true);
    expect(runs.some((n) => n.includes("changed to"))).toBe(true);
    expect(runs.some((n) => n.includes("reset and re-called"))).toBe(true);
    expect(runs.some((n) => / 5 rows into/.test(n))).toBe(true);
    expect(runs.some((n) => /draw called/.test(n))).toBe(true);
  });
});

describe("the endings-sweep sheet imports the way a real sheet does", () => {
  // The row after the endings is a MILESTONE (a time, no length), because
  // that is what closes an ending block on import — a timed cue there would
  // be swallowed into the draw branch. Real sheets end the same way.
  it("tags win, lose, golden and draw from its captions, in the real-sheet order", () => {
    const grid = parseCsv(readFileSync(join(__dirname, "fixtures", "endings-sweep.csv"), "utf8"));
    const headerIndex = detectHeaderRow(grid);
    const mapping = mapColumns(grid[headerIndex]!);
    const rows = classifyRows(grid, headerIndex, mapping);
    detectOutcomes(rows);
    const tagged = rows.filter((r) => r.outcome).map((r) => `${r.outcome}:${r.title.slice(0, 22)}`);
    expect(tagged).toEqual([
      "win:FULL TIME — HARBOUR WI",
      "win:Winning song",
      "win:Presentation",
      "lose:FULL TIME — HARBOUR LO",
      "lose:Music bed only",
      "golden:FULL TIME — SCORES LEV",
      "golden:HOLDING — golden point",
      "golden:Golden point — first h",
      "golden:HOLDING — change ends",
      "golden:Golden point — second ",
      "draw:FULL TIME — DRAW, NO E",
      "draw:Draw wrap",
    ]);
  });
});
