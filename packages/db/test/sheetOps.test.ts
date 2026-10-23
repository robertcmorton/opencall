import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildRundownDoc, projectRundownDoc } from "../src/doc";
import { addRow, deleteRow, moveRow, readSheet, setCellText, setDuration, setStartTime, SheetOpError, strikeRow } from "../src/sheetOps";

const sheet = () =>
  buildRundownDoc(
    [
      { type: "milestone", title: "Doors", hardStartSec: 18 * 3600 },
      { type: "cue", title: "Welcome", durationSec: 300, cells: { audio: "Walk-in music" } },
      { type: "cue", title: "Anthem", durationSec: 120 },
      { type: "milestone", title: "Kick-off", hardStartSec: 18 * 3600 + 30 * 60 },
      { type: "cue", title: "First half", durationSec: 2400 },
    ],
    { name: "Test sheet", plannedStartSec: 18 * 3600 },
  );
const ids = (doc: Y.Doc) => projectRundownDoc(doc).rows.map((r) => r.id);
const row = (doc: Y.Doc, title: string) => projectRundownDoc(doc).rows.find((r) => r.title === title)!;

describe("sheet operations (the assistant's edits)", () => {
  it("reads rows with computed start times and their cells", () => {
    const s = readSheet(sheet());
    expect(s.name).toBe("Test sheet");
    expect(s.rows.map((r) => r.title)).toEqual(["Doors", "Welcome", "Anthem", "Kick-off", "First half"]);
    expect(s.rows[2]!.start).toBe("6:05:00 PM");
    expect(s.rows[1]!.cells).toEqual({ Audio: "Walk-in music" });
  });

  it("sets a cell by column title or key, multi-line, and the title too", () => {
    const doc = sheet();
    const w = row(doc, "Welcome").id;
    setCellText(doc, w, "Audio", "Line one\nLine two");
    setCellText(doc, w, "lights", "Spot on MC");
    setCellText(doc, w, "Title", "Welcome & acknowledgement");
    const r = row(doc, "Welcome & acknowledgement");
    expect(r.cells.audio).toBe("Line one\nLine two");
    expect(r.cells.lights).toBe("Spot on MC");
  });

  it("refuses a time column as text, and an unknown column by naming the real ones", () => {
    const doc = sheet();
    expect(() => setCellText(doc, row(doc, "Welcome").id, "Duration", "5:00")).toThrow(SheetOpError);
    expect(() => setCellText(doc, row(doc, "Welcome").id, "Nope", "x")).toThrow(/Columns: /);
  });

  it("a longer duration moves the rows below it, down to the kick-off, which keeps its time", () => {
    const doc = sheet();
    setDuration(doc, row(doc, "Welcome").id, 360);
    expect(readSheet(doc).rows.find((r) => r.title === "Anthem")!.start).toBe("6:06:00 PM");
    expect(row(doc, "Kick-off").hardStartSec).toBe(18 * 3600 + 30 * 60);
    expect(row(doc, "Doors").hardStartSec).toBe(18 * 3600); // above: untouched
  });

  it("a struck row gives its time back below, and putting it back takes it again — the kick-off keeps its time", () => {
    const doc = sheet();
    const before = row(doc, "Kick-off").hardStartSec!;
    strikeRow(doc, row(doc, "Welcome").id, true);
    expect(row(doc, "Welcome").skipped).toBe(true);
    expect(readSheet(doc).rows.find((r) => r.title === "Anthem")!.start).toBe("6:00:00 PM");
    expect(row(doc, "Kick-off").hardStartSec).toBe(before);
    strikeRow(doc, row(doc, "Welcome").id, false);
    expect(readSheet(doc).rows.find((r) => r.title === "Anthem")!.start).toBe("6:05:00 PM");
    expect(row(doc, "Kick-off").hardStartSec).toBe(before);
  });

  it("adds a row after another (or at the top) with cells, and deletes it", () => {
    const doc = sheet();
    const id = addRow(doc, row(doc, "Welcome").id, { title: "Sponsor read", durationSec: 30, cells: { Script: "Thanks to our partner" } });
    expect(ids(doc).indexOf(id)).toBe(2);
    expect(row(doc, "Sponsor read").cells.script).toBe("Thanks to our partner");
    const top = addRow(doc, null, { title: "Crew call", type: "milestone" });
    expect(ids(doc)[0]).toBe(top);
    expect(row(doc, "Crew call").durationSec).toBeNull();
    deleteRow(doc, id);
    expect(ids(doc)).not.toContain(id);
  });

  it("an added row starts where it is put, and moves the rows below — but not the kick-off", () => {
    const doc = sheet();
    addRow(doc, row(doc, "Welcome").id, { title: "Sponsor read", durationSec: 30 });
    const start = (t: string) => readSheet(doc).rows.find((r) => r.title === t)!.start;
    expect(start("Sponsor read")).toBe("6:05:00 PM");
    expect(start("Anthem")).toBe("6:05:30 PM");
    // The first half must start on time, and Kick-off is its moment.
    expect(row(doc, "Kick-off").hardStartSec).toBe(18 * 3600 + 30 * 60);
    expect(row(doc, "Doors").hardStartSec).toBe(18 * 3600); // above: untouched
  });

  it("a deleted row's time leaves the sheet, and waits in front of the kick-off", () => {
    const doc = sheet();
    deleteRow(doc, row(doc, "Welcome").id);
    expect(readSheet(doc).rows.find((r) => r.title === "Anthem")!.start).toBe("6:00:00 PM");
    expect(row(doc, "Kick-off").hardStartSec).toBe(18 * 3600 + 30 * 60);
  });

  it("with nothing below that must start on time, every fixed time below moves", () => {
    const doc = buildRundownDoc(
      [
        { type: "cue", title: "Doors", durationSec: 600, hardStartSec: 18 * 3600 },
        { type: "cue", title: "Speeches", durationSec: 900, hardStartSec: 18 * 3600 + 600 },
        { type: "cue", title: "Dinner", durationSec: 3600, hardStartSec: 18 * 3600 + 1500 },
      ],
      { name: "No game", plannedStartSec: 18 * 3600 },
    );
    addRow(doc, row(doc, "Doors").id, { title: "Video", durationSec: 120 });
    expect(row(doc, "Speeches").hardStartSec).toBe(18 * 3600 + 720);
    expect(row(doc, "Dinner").hardStartSec).toBe(18 * 3600 + 1620);
    deleteRow(doc, row(doc, "Video").id);
    expect(row(doc, "Dinner").hardStartSec).toBe(18 * 3600 + 1500);
    // A length, a strike, and an emptied length — which gives its time back.
    setDuration(doc, row(doc, "Speeches").id, 1200);
    expect(row(doc, "Dinner").hardStartSec).toBe(18 * 3600 + 1800);
    setDuration(doc, row(doc, "Speeches").id, null);
    expect(row(doc, "Dinner").hardStartSec).toBe(18 * 3600 + 600);
    setDuration(doc, row(doc, "Speeches").id, 900);
    strikeRow(doc, row(doc, "Speeches").id, true);
    expect(row(doc, "Dinner").hardStartSec).toBe(18 * 3600 + 600);
  });

  it("a yellow fixed time keeps its time when a length changes, and the cues move past it", () => {
    const doc = buildRundownDoc(
      [
        { type: "cue", title: "Soundcheck", durationSec: 900, hardStartSec: 17 * 3600 + 45 * 60 },
        { type: "milestone", title: "DOORS OPEN", hardStartSec: 18 * 3600 },
        { type: "cue", title: "Walk-in music", durationSec: 600 },
        { type: "cue", title: "Welcome", durationSec: 300, hardStartSec: 18 * 3600 + 600 },
      ],
      { name: "Doors", plannedStartSec: 17 * 3600 + 45 * 60 },
    );
    setDuration(doc, row(doc, "Soundcheck").id, 1200);
    expect(row(doc, "DOORS OPEN").hardStartSec).toBe(18 * 3600);
    expect(readSheet(doc).rows.find((r) => r.title === "Walk-in music")!.start).toBe("6:05:00 PM");
    expect(row(doc, "Welcome").hardStartSec).toBe(18 * 3600 + 900);
  });

  it("moves a row after another, up or down", () => {
    const doc = sheet();
    moveRow(doc, row(doc, "Anthem").id, row(doc, "Doors").id);
    expect(projectRundownDoc(doc).rows.map((r) => r.title).slice(0, 3)).toEqual(["Doors", "Anthem", "Welcome"]);
    moveRow(doc, row(doc, "Anthem").id, row(doc, "First half").id);
    expect(projectRundownDoc(doc).rows.at(-1)!.title).toBe("Anthem");
  });

  it("a changed start time ripples only when the editor's rule says so", () => {
    const doc = sheet();
    setStartTime(doc, row(doc, "Welcome").id, 18 * 3600 + 60); // first fixed time: moves nothing
    expect(row(doc, "Kick-off").hardStartSec).toBe(18 * 3600 + 30 * 60);
  });
});

describe("locked rows", () => {
  it("refuse text, time, move and delete, but can still be struck", () => {
    const doc = sheet();
    const w = row(doc, "Welcome").id;
    const r = doc.getMap<Y.Map<unknown>>("rows").get(w)!;
    r.set("locked", true);
    r.set("lockedBy", "Sam");
    expect(() => setCellText(doc, w, "Title", "x")).toThrow(/locked by Sam/);
    expect(() => setDuration(doc, w, 10)).toThrow(SheetOpError);
    expect(() => setStartTime(doc, w, 10)).toThrow(SheetOpError);
    expect(() => moveRow(doc, w, null)).toThrow(SheetOpError);
    expect(() => deleteRow(doc, w)).toThrow(SheetOpError);
    strikeRow(doc, w, true);
    expect(row(doc, "Welcome").skipped).toBe(true);
    expect(row(doc, "Welcome").locked).toBe(true);
  });
});
