import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildRundownDoc, projectRundownDoc } from "../src/doc";
import { clearCells, fillDown, formatGrid, parseGrid, pasteGrid, type GridColumn } from "../src/sheetGrid";

const sheet = () =>
  buildRundownDoc(
    [
      { type: "cue", title: "Doors", durationSec: 60, cells: { audio: "Walk-in music" } },
      { type: "group", title: "FIRST HALF" },
      { type: "cue", title: "Kick-off", durationSec: 120 },
    ],
    { name: "Test", plannedStartSec: 0 },
  );
const view = (doc: Y.Doc) => projectRundownDoc(doc);
const cols = (doc: Y.Doc, ...keys: string[]): GridColumn[] =>
  keys.map((k) => {
    const c = view(doc).columns.find((x) => x.key === k)!;
    return { id: c.id, kind: c.kind };
  });
const ids = (doc: Y.Doc) => view(doc).rows.map((r) => r.id);

describe("reading a copied block", () => {
  it("splits tabs and lines, and ignores the last line break", () => {
    expect(parseGrid("a\tb\nc\td\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(parseGrid("a\r\nb")).toEqual([["a"], ["b"]]);
    expect(parseGrid("")).toEqual([]);
    expect(parseGrid("a\t")).toEqual([["a", ""]]);
  });

  it("keeps line breaks, tabs and quotes inside a quoted cell", () => {
    expect(parseGrid('"two\nlines"\t"say ""hi"""\nx\ty')).toEqual([
      ["two\nlines", 'say "hi"'],
      ["x", "y"],
    ]);
  });

  it("takes a cell that only starts with a quote as typed", () => {
    expect(parseGrid('"Ready" she said\tok')).toEqual([['"Ready" she said', "ok"]]);
  });

  it("writes a block that reads back the same", () => {
    const block = [
      ["Item", "Notes"],
      ["two\nlines", 'a "quote"'],
    ];
    expect(parseGrid(formatGrid(block))).toEqual(block);
  });
});

describe("pasting", () => {
  it("fills across columns and down rows, reading times and lengths", () => {
    const doc = sheet();
    const r = pasteGrid(doc, ids(doc), cols(doc, "title", "start", "duration", "audio"), [
      ["Gates", "6:30 pm", "2:30", "Anthem"],
      ["Welcome", "", "", ""],
    ]);
    expect(r).toMatchObject({ rows: 2, columns: 4, added: [], lockedSkipped: 0, unreadable: 0 });
    const [a, b] = view(doc).rows;
    expect(a).toMatchObject({ title: "Gates", hardStartSec: 18 * 3600 + 30 * 60, durationSec: 150 });
    expect(a!.cells.audio).toBe("Anthem");
    // A heading keeps having no length; its text still changes.
    expect(b).toMatchObject({ title: "Welcome", type: "group", durationSec: null, hardStartSec: null });
    expect(b!.cells.audio ?? "").toBe("");
  });

  it("adds rows when the block runs past the end, with no invented length", () => {
    const doc = sheet();
    const last = ids(doc).slice(2);
    const r = pasteGrid(doc, last, cols(doc, "title"), [["Kick-off"], ["Half time"], ["Full time"]]);
    expect(r.added).toHaveLength(2);
    expect(view(doc).rows.map((x) => x.title)).toEqual(["Doors", "FIRST HALF", "Kick-off", "Half time", "Full time"]);
    expect(view(doc).rows[4]!.durationSec).toBeNull();
  });

  it("leaves locked rows alone, drops extra columns and counts what it could not read", () => {
    const doc = sheet();
    doc.getMap<Y.Map<unknown>>("rows").get(ids(doc)[0]!)!.set("locked", true);
    const r = pasteGrid(doc, ids(doc), cols(doc, "title", "duration"), [
      ["Changed", "1:00", "extra"],
      ["Also", "soon"],
    ]);
    expect(r).toMatchObject({ rows: 1, lockedSkipped: 1, droppedColumns: 1 });
    expect(view(doc).rows[0]!.title).toBe("Doors");
    expect(view(doc).rows[1]!.title).toBe("Also");
    // "soon" is not a length, but the row is a heading: nothing to read.
    expect(r.unreadable).toBe(0);
    pasteGrid(doc, ids(doc).slice(2), cols(doc, "duration"), [["soon"]]);
    expect(view(doc).rows[2]!.durationSec).toBe(120);
  });

  it("is one undo", () => {
    const doc = sheet();
    const undo = new Y.UndoManager([doc.getMap("rows"), doc.getArray("rowOrder")]);
    doc.transact(() => pasteGrid(doc, ids(doc), cols(doc, "title"), [["A"], ["B"], ["C"], ["D"]]));
    expect(view(doc).rows.map((x) => x.title)).toEqual(["A", "B", "C", "D"]);
    undo.undo();
    expect(view(doc).rows.map((x) => x.title)).toEqual(["Doors", "FIRST HALF", "Kick-off"]);
  });
});

describe("fill down and clear", () => {
  it("copies the top cell into the ones below, formatting kept", () => {
    const doc = sheet();
    const [first] = ids(doc);
    const audio = cols(doc, "audio");
    const frag = (doc.getMap<Y.Map<unknown>>("rows").get(first!)!.get("cells") as Y.Map<Y.XmlFragment>).get(audio[0]!.id)!;
    ((frag.toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlText).format(0, 4, { bold: {} });
    const r = fillDown(doc, ids(doc), [...audio, ...cols(doc, "duration")]);
    expect(r.filled).toBe(3); // two audio cells, one length (the heading has none)
    const rows = view(doc).rows;
    expect(rows.map((x) => x.cells.audio)).toEqual(["Walk-in music", "Walk-in music", "Walk-in music"]);
    expect(rows[2]!.cellsRich?.audio).toContain("<bold>");
    expect(rows[2]!.durationSec).toBe(60);
    expect(rows[1]!.durationSec ?? null).toBeNull();
  });

  it("clears text, fixed times and lengths", () => {
    const doc = sheet();
    pasteGrid(doc, ids(doc), cols(doc, "start"), [["9:00"]]);
    clearCells(doc, ids(doc).slice(0, 1), cols(doc, "title", "start", "duration", "audio"));
    expect(view(doc).rows[0]).toMatchObject({ title: "", hardStartSec: null, durationSec: null });
    expect(view(doc).rows[0]!.cells.audio ?? "").toBe("");
  });
});
