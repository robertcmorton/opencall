import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildRundownDoc, projectRundownDoc } from "../src/doc";
import { compareSheets } from "../src/compare";
import { addRow, deleteRow, moveRow, setCellText, setDuration, strikeRow } from "../src/sheetOps";

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
const copy = (doc: Y.Doc) => {
  const out = new Y.Doc();
  Y.applyUpdate(out, Y.encodeStateAsUpdate(doc));
  return out;
};
const id = (doc: Y.Doc, title: string) => projectRundownDoc(doc).rows.find((r) => r.title === title)!.id;

describe("comparing two versions of a sheet", () => {
  it("says nothing differs when nothing does", () => {
    const a = sheet();
    expect(compareSheets(a, copy(a)).same).toBe(true);
  });

  it("names rows added and removed, with where they sit", () => {
    const before = sheet();
    const after = copy(before);
    addRow(after, id(after, "Welcome"), { title: "Sponsor read" });
    deleteRow(after, id(after, "Anthem"));
    const c = compareSheets(before, after);
    expect(c.added).toEqual([expect.objectContaining({ title: "Sponsor read", number: 3 })]);
    expect(c.removed).toEqual([expect.objectContaining({ title: "Anthem", number: 3 })]);
    expect(c.changed).toEqual([]);
    expect(c.moved).toEqual([]);
  });

  it("names what changed in a row, by column title", () => {
    const before = sheet();
    const after = copy(before);
    setCellText(after, id(after, "Welcome"), "Audio", "Silence");
    setDuration(after, id(after, "Welcome"), 360);
    strikeRow(after, id(after, "Anthem"), true);
    const c = compareSheets(before, after);
    // A longer Welcome moves the fixed Kick-off too, as in the editor.
    expect(c.changed.map((r) => [r.title, r.fields])).toEqual([
      ["Welcome", ["Duration", "Audio"]],
      ["Anthem", ["Struck"]],
      ["Kick-off", ["Start time"]],
    ]);
  });

  it("calls only the row that was dragged a move, not every row it passed", () => {
    const before = sheet();
    const after = copy(before);
    moveRow(after, id(after, "First half"), null);
    const c = compareSheets(before, after);
    expect(c.moved.map((r) => r.title)).toEqual(["First half"]);
  });

  it("reads the other way round for 'what would restoring undo'", () => {
    const version = sheet();
    const now = copy(version);
    addRow(now, null, { title: "Added later" });
    const c = compareSheets(now, version);
    expect(c.removed.map((r) => r.title)).toEqual(["Added later"]);
    expect(c.added).toEqual([]);
  });

  it("pairs rows by title when an import has given them all new ids", () => {
    const before = sheet();
    const rows = projectRundownDoc(before).rows;
    const reimported = buildRundownDoc(
      rows.map((r) => ({ type: r.type, title: r.title, durationSec: r.title === "Anthem" ? 90 : r.durationSec, hardStartSec: r.hardStartSec, cells: r.cells })),
      { name: "Test sheet", plannedStartSec: 18 * 3600 },
    );
    const c = compareSheets(before, reimported);
    expect(c.added).toEqual([]);
    expect(c.removed).toEqual([]);
    expect(c.moved).toEqual([]);
    expect(c.changed.map((r) => [r.title, r.fields])).toEqual([["Anthem", ["Duration"]]]);
  });
});
