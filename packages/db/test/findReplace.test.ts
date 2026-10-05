import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { buildRundownDoc, projectRundownDoc } from "../src/doc";
import { findInSheet, replaceInSheet } from "../src/findReplace";

const sheet = () =>
  buildRundownDoc(
    [
      { type: "cue", title: "Welcome from the MC", durationSec: 60, cells: { audio: "MC mic live\nMC walks off" } },
      { type: "cue", title: "Anthem", durationSec: 120, cells: { audio: "Track 3" } },
      { type: "cue", title: "MC thanks the sponsor", durationSec: 30 },
    ],
    { name: "Test", plannedStartSec: 0 },
  );
const titles = (doc: Y.Doc) => projectRundownDoc(doc).rows.map((r) => r.title);

describe("find and replace", () => {
  it("finds every cell with a match, counting each one", () => {
    const hits = findInSheet(sheet(), "mc");
    expect(hits.map((h) => h.count)).toEqual([1, 2, 1]);
    expect(findInSheet(sheet(), "mc", { matchCase: true })).toEqual([]);
  });

  it("replaces across titles and other columns, line by line", () => {
    const doc = sheet();
    const r = replaceInSheet(doc, "MC", "Host", { matchCase: true });
    expect(r).toEqual({ replaced: 4, cells: 3, lockedSkipped: 0 });
    expect(titles(doc)).toEqual(["Welcome from the Host", "Anthem", "Host thanks the sponsor"]);
    expect(projectRundownDoc(doc).rows[0]!.cells.audio).toBe("Host mic live\nHost walks off");
  });

  it("keeps formatting on the replaced words", () => {
    const doc = sheet();
    const titleId = projectRundownDoc(doc).columns.find((c) => c.key === "title")!.id;
    const row = doc.getMap<Y.Map<unknown>>("rows").get(projectRundownDoc(doc).rows[1]!.id)!;
    const text = ((row.get("cells") as Y.Map<Y.XmlFragment>).get(titleId)!.toArray()[0] as Y.XmlElement).toArray()[0] as Y.XmlText;
    text.format(0, 6, { bold: {} });
    replaceInSheet(doc, "Anthem", "National anthem");
    expect(text.toDelta()).toEqual([{ insert: "National anthem", attributes: { bold: {} } }]);
  });

  it("leaves locked rows alone and says how many", () => {
    const doc = sheet();
    const first = doc.getMap<Y.Map<unknown>>("rows").get(projectRundownDoc(doc).rows[0]!.id)!;
    first.set("locked", true);
    const r = replaceInSheet(doc, "MC", "Host", { matchCase: true });
    expect(r).toEqual({ replaced: 1, cells: 1, lockedSkipped: 3 });
    expect(titles(doc)[0]).toBe("Welcome from the MC");
  });
});
