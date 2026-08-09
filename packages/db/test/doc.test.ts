import { describe, expect, it } from "vitest";
import { computeTiming } from "@opencall/core";
import { buildRundownDoc, cellPlainText, decodeDoc, encodeDoc, projectRundownDoc } from "../src/doc";

describe("rundown doc round-trip", () => {
  it("builds, encodes, decodes, and projects with timing intact", () => {
    const doc = buildRundownDoc([
      { type: "group", title: "Walk in", hardStartSec: 9 * 3600 },
      { type: "cue", title: "Welcome", durationSec: 90, cells: { audio: "Lav 1" } },
      { type: "cue", title: "Reel", durationSec: 180 },
    ]);
    const projected = projectRundownDoc(decodeDoc(encodeDoc(doc)));

    expect(projected.rows.map((r) => r.title)).toEqual(["Walk in", "Welcome", "Reel"]);
    expect(projected.rows[1]!.cells["audio"]).toBe("Lav 1");
    expect(projected.columns.some((c) => c.key === "script")).toBe(true);

    const timing = computeTiming(projected.rows, null);
    expect(timing.rows[1]!.startSec).toBe(9 * 3600);
    expect(timing.endSec).toBe(9 * 3600 + 270);
  });

  it("ignores dangling rowOrder ids on projection", () => {
    const doc = buildRundownDoc([{ type: "cue", title: "Only", durationSec: 60 }]);
    doc.getArray<string>("rowOrder").push(["does-not-exist"]);
    const projected = projectRundownDoc(doc);
    expect(projected.rows).toHaveLength(1);
  });
});

describe("sheet-faithful columns and outcome tags", () => {
  it("orders columns per the sheet, keeps its header names, and round-trips outcomes", () => {
    const doc = buildRundownDoc(
      [
        { type: "cue", title: "A", durationSec: 60, outcome: "win" },
        { type: "cue", title: "B", durationSec: 30 },
      ],
      { name: "Order", baseTitles: { title: "ACTIVITY", start: "TIME", duration: "DUR" } },
      [{ key: "loc", title: "LOCATION" }],
      true,
      [],
      ["start", "duration", "title", "loc"],
    );
    const projected = projectRundownDoc(decodeDoc(encodeDoc(doc)));
    expect(projected.columns.map((c) => c.key)).toEqual(["start", "duration", "title", "loc"]);
    expect(projected.columns.map((c) => c.title)).toEqual(["TIME", "DUR", "ACTIVITY", "LOCATION"]);
    expect(projected.rows[0]!.outcome).toBe("win");
    expect(projected.rows[1]!.outcome).toBeNull();
  });

  it("appends unlisted keys and ignores unknown keys in the order", () => {
    const doc = buildRundownDoc([{ type: "cue", title: "A" }], {}, [{ key: "loc", title: "LOC" }], true, [], ["duration", "ghost", "loc"]);
    const { columns } = projectRundownDoc(doc);
    expect(columns.map((c) => c.key)).toEqual(["duration", "loc", "title", "start"]);
  });
});

describe("cell text fidelity", () => {
  it("keeps angle brackets a person typed", () => {
    // Run sheets use them as prompts to read aloud; they are not markup.
    const doc = buildRundownDoc([
      { type: "cue", title: "PRESENTATION", cells: { script: "Now <player name> accepts the trophy" } },
      { type: "cue", title: "<Captain to speak>" },
    ]);
    const rows = projectRundownDoc(doc).rows;
    expect(rows[0]!.cells.script).toBe("Now <player name> accepts the trophy");
    expect(rows[1]!.title).toBe("<Captain to speak>");
  });

  it("still strips the editor's own formatting marks", () => {
    expect(cellPlainText("<paragraph><bold>LIVE</bold> now</paragraph>")).toBe("LIVE now");
    expect(cellPlainText("<paragraph>a</paragraph><paragraph>b</paragraph>")).toBe("a\nb");
  });

  it("keeps the sheet's own item numbers on every row", () => {
    const doc = buildRundownDoc([
      { type: "cue", title: "ONE", sourceNumber: "1" },
      { type: "cue", title: "SUB", sourceNumber: "129a" },
    ]);
    expect(projectRundownDoc(doc).rows.map((r) => r.sourceNumber)).toEqual(["1", "129a"]);
  });
});

describe("cue skips what it passes", () => {
  // The showcaller says "we're doing item 45 now" while item 40 is on air.
  // 41–43 did not run. The as-run record has to say so.
  it("marks the rows between live and cued as not run", () => {
    const doc = buildRundownDoc([
      { type: "cue", title: "40 on air", hardStartSec: 29100, durationSec: 120 },
      { type: "cue", title: "41", durationSec: 240 },
      { type: "cue", title: "42", durationSec: 180 },
      { type: "cue", title: "43", durationSec: 360 },
      { type: "cue", title: "45 cued", hardStartSec: 30000, durationSec: 240 },
    ]);
    const rows = projectRundownDoc(doc).rows;
    const yRows = doc.getMap("rows") as never as Map<string, { set: (k: string, v: unknown) => void }>;
    doc.transact(() => {
      for (const r of rows.slice(1, 4)) (yRows as never as { get: (k: string) => { set: (k: string, v: unknown) => void } }).get(r.id).set("skipped", true);
    });
    const after = projectRundownDoc(doc).rows;
    expect(after.map((r) => r.skipped)).toEqual([false, true, true, true, false]);
  });

  it("a skipped row takes no time in the running order", () => {
    const doc = buildRundownDoc([
      { type: "cue", title: "on air", hardStartSec: 29100, durationSec: 120 },
      { type: "cue", title: "dropped", durationSec: 600 },
      { type: "cue", title: "next", durationSec: 120 },
    ]);
    const rows = projectRundownDoc(doc).rows;
    const map = doc.getMap("rows") as never as { get: (k: string) => { set: (k: string, v: unknown) => void } };
    doc.transact(() => map.get(rows[1]!.id).set("skipped", true));
    const t = computeTiming(projectRundownDoc(doc).rows, null);
    // "next" starts when "on air" ends, not ten minutes later.
    expect(t.rows[2]!.startSec).toBe(29100 + 120);
  });
});
