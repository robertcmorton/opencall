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

  it("a longer duration moves the fixed times below it, as in the editor", () => {
    const doc = sheet();
    setDuration(doc, row(doc, "Welcome").id, 360);
    expect(row(doc, "Kick-off").hardStartSec).toBe(18 * 3600 + 31 * 60);
    expect(row(doc, "Doors").hardStartSec).toBe(18 * 3600); // above: untouched
  });

  it("a struck row gives its time back below, and putting it back takes it again", () => {
    const doc = sheet();
    const before = row(doc, "Kick-off").hardStartSec!;
    strikeRow(doc, row(doc, "Anthem").id, true);
    expect(row(doc, "Anthem").skipped).toBe(true);
    expect(row(doc, "Kick-off").hardStartSec).toBe(before - 120);
    strikeRow(doc, row(doc, "Anthem").id, false);
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
