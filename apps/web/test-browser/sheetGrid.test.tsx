import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useEffect, useState } from "react";
import * as Y from "yjs";
import "../app/globals.css";
import { buildRundownDoc, projectRundownDoc } from "@opencall/db/doc";
import { useSheetGrid, type GridCell } from "../lib/useSheetGrid";

/**
 * The spreadsheet keys, in a real browser: real clicks, real layout for the
 * drag (elementFromPoint), real clipboard events. A small grid stands in for
 * the run sheet; the hook is the one the sheet uses.
 *
 * Each of these was found by hand on 6 Oct; these keep them found.
 */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const sheet = () =>
  buildRundownDoc(
    [
      { type: "cue", title: "Doors", durationSec: 60, cells: { audio: "Walk-in" } },
      { type: "cue", title: "Welcome", durationSec: 60, cells: { audio: "MC mic" } },
      { type: "cue", title: "Anthem", durationSec: 120 },
      { type: "cue", title: "Kick-off", durationSec: 30, cells: { audio: "Siren" } },
      { type: "cue", title: "First half", durationSec: 2400, cells: { audio: "Crowd" } },
    ],
    { name: "Grid test", plannedStartSec: 0 },
  );

function Harness({ doc, opened }: { doc: Y.Doc; opened: { cell: GridCell; seed?: string }[] }) {
  const [gridEl, setGridEl] = useState<HTMLDivElement | null>(null);
  const [, bump] = useState(0);
  useEffect(() => {
    const f = () => bump((n) => n + 1);
    doc.on("update", f);
    return () => doc.off("update", f);
  }, [doc]);
  const { rows, columns } = projectRundownDoc(doc);
  const cols = columns.filter((c) => c.key === "title" || c.key === "duration" || c.key === "audio");
  const textOf = (rowId: string, col: { id: string }) => {
    const r = rows.find((x) => x.id === rowId);
    const c = cols.find((x) => x.id === col.id);
    if (!r || !c) return "";
    if (c.kind === "duration") return r.durationSec == null ? "" : String(r.durationSec);
    return r.cells[c.key] ?? "";
  };
  const grid = useSheetGrid({
    enabled: true,
    doc,
    gridEl,
    rowIds: rows.map((r) => r.id),
    columns: cols.map((c) => ({ id: c.id, kind: c.kind })),
    editorOpen: false,
    spaceTypes: true,
    textOf,
    open: (cell, seed) => opened.push({ cell, seed }),
    typeAhead: () => {},
    scrollToIndex: () => {},
    newRowSec: 60,
  });
  return (
    <div ref={setGridEl} style={{ height: 400, overflow: "auto" }}>
      <table className="rundown-grid">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-rowid={r.id}>
              {cols.map((c) => (
                <td key={c.id} {...grid.cellProps(r.id, c.id)} style={{ width: 140, height: 28 }}>
                  {textOf(r.id, c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {grid.note && <div className="grid-note-test">{grid.note.text}</div>}
    </div>
  );
}

const mount = (doc: Y.Doc) => {
  const opened: { cell: GridCell; seed?: string }[] = [];
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<Harness doc={doc} opened={opened} />));
  return opened;
};
const cell = (r: number, c: number) => document.querySelectorAll("tr[data-rowid]")[r]!.querySelectorAll("td")[c] as HTMLElement;
const at = (): [number, number] | null => {
  const td = document.querySelector("td[data-cursor]");
  if (!td) return null;
  const tr = td.closest("tr")!;
  return [[...document.querySelectorAll("tr[data-rowid]")].indexOf(tr), [...tr.children].indexOf(td)];
};
const key = (k: string, mods: KeyboardEventInit = {}) => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...mods })));
const titles = (doc: Y.Doc) => projectRundownDoc(doc).rows.map((r) => r.title);

describe("spreadsheet keys", () => {
  it("a click puts the box on a cell; arrows and Tab move it", () => {
    mount(sheet());
    act(() => cell(0, 0).click());
    expect(at()).toEqual([0, 0]);
    key("ArrowDown");
    key("ArrowRight");
    expect(at()).toEqual([1, 1]);
    key("Tab");
    expect(at()).toEqual([1, 2]);
    key("Tab"); // past the last column: the start of the next row
    expect(at()).toEqual([2, 0]);
  });

  it("Cmd+arrow jumps to the end of the filled run, then to the next filled cell", () => {
    mount(sheet()); // audio column: filled, filled, EMPTY, filled, filled
    act(() => cell(0, 2).click());
    key("ArrowDown", { metaKey: true });
    expect(at()).toEqual([1, 2]);
    key("ArrowDown", { metaKey: true });
    expect(at()).toEqual([3, 2]);
    key("ArrowDown", { metaKey: true });
    expect(at()).toEqual([4, 2]);
    key("ArrowUp", { metaKey: true });
    expect(at()).toEqual([3, 2]);
  });

  it("typing opens the cell with what was typed; Enter opens it as it is", () => {
    const opened = mount(sheet());
    act(() => cell(1, 0).click());
    key("x");
    key("Enter");
    expect(opened.map((o) => o.seed)).toEqual(["x", undefined]);
  });

  it("pastes a block from a spreadsheet, adds rows past the end, and one undo takes it all back", () => {
    const doc = sheet();
    mount(doc);
    const undo = new Y.UndoManager([doc.getMap("rows"), doc.getArray("rowOrder")]);
    act(() => cell(3, 0).click());
    const dt = new DataTransfer();
    dt.setData("text/plain", "Kick-off!\t45\nHalf time\t900\nSecond half\t2400\n");
    act(() => void document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })));
    expect(titles(doc)).toEqual(["Doors", "Welcome", "Anthem", "Kick-off!", "Half time", "Second half"]);
    expect(projectRundownDoc(doc).rows[4]!.durationSec).toBe(900);
    expect(document.querySelector(".grid-note-test")?.textContent).toMatch(/Pasted 3 rows and 2 columns\. Added 1 new row/);
    act(() => void undo.undo());
    expect(titles(doc)).toEqual(["Doors", "Welcome", "Anthem", "Kick-off", "First half"]);
  });

  it("a paste from Google Sheets keeps bold, italic and a coloured cell", () => {
    const doc = sheet();
    mount(doc);
    act(() => cell(0, 0).click());
    const dt = new DataTransfer();
    dt.setData(
      "text/html",
      '<google-sheets-html-origin><table><tr><td style="font-weight:bold">Gates open</td><td>60</td><td><span style="font-style:italic">quiet</span> please</td></tr><tr><td style="background-color:#fff2cc">Sponsor A read</td><td></td><td>Plain</td></tr></table>',
    );
    dt.setData("text/plain", "Gates open\t60\tquiet please\nSponsor A read\t\tPlain");
    act(() => void document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })));
    const [a, b] = projectRundownDoc(doc).rows;
    expect(a!.title).toBe("Gates open");
    expect(a!.cellsRich?.title).toContain("<bold>");
    expect(a!.cells.audio).toBe("quiet please");
    expect(a!.cellsRich?.audio).toContain("<italic>quiet</italic>");
    expect(b!.cellsRich?.title).toContain("<highlight>");
    expect(b!.cells.audio).toBe("Plain");
  });

  it("a paste from Excel keeps the formatting Excel writes as named styles", () => {
    const doc = sheet();
    mount(doc);
    act(() => cell(0, 0).click());
    // The shape Excel puts on the clipboard: formatting lives in a <style>
    // block as classes, the cells only name them, and a run of differently
    // formatted words inside one cell is a <font class=…>.
    const excel = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!--table
	{mso-displayed-decimal-separator:"\\.";}
@page
	{margin:.75in .7in .75in .7in;}
td
	{padding-top:1px;font-weight:400;font-style:normal;text-decoration:none;}
.xl65
	{font-weight:700;
	mso-font-charset:0;}
.xl66
	{font-style:italic;}
.xl67
	{background:yellow;
	mso-pattern:black none;}
.font5
	{font-weight:700;}
.font6
	{font-weight:400;}
--></style></head><body><table border=0 cellpadding=0 cellspacing=0><!--StartFragment-->
 <tr height=21 style='height:16.0pt'>
  <td height=21 class=xl65 style='height:16.0pt'>Gates open</td>
  <td>60</td>
  <td class=xl66>quiet please</td>
 </tr>
 <tr height=21 style='height:16.0pt'>
  <td height=21 class=xl67>Sponsor A read</td>
  <td></td>
  <td>Cue <font class="font5">VT 3</font><font class="font6"> now</font></td>
 </tr>
 <tr>
  <td class=xl65 style='font-weight:400'>Plain after all</td>
 </tr>
<!--EndFragment--></table></body></html>`;
    const dt = new DataTransfer();
    dt.setData("text/html", excel);
    dt.setData("text/plain", "Gates open\t60\tquiet please\nSponsor A read\t\tCue VT 3 now\nPlain after all");
    act(() => void document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })));
    const [a, b, c] = projectRundownDoc(doc).rows;
    expect(a!.title).toBe("Gates open");
    expect(a!.cellsRich?.title).toContain("<bold>");
    expect(a!.cellsRich?.audio).toContain("<italic>quiet please</italic>");
    expect(b!.cellsRich?.title).toContain("<highlight>");
    expect(b!.cells.audio).toBe("Cue VT 3 now");
    expect(b!.cellsRich?.audio).toContain("<bold>VT 3</bold>");
    expect(b!.cellsRich?.audio).not.toContain("<bold> now");
    // An inline style beats the class, as it would on a web page.
    expect(c!.title).toBe("Plain after all");
    expect(c!.cellsRich?.title ?? "").not.toContain("<bold>");
  });

  it("copies a block as text a spreadsheet reads back", () => {
    mount(sheet());
    act(() => cell(0, 0).click());
    key("ArrowDown", { shiftKey: true });
    key("ArrowRight", { shiftKey: true });
    const dt = new DataTransfer();
    act(() => void document.dispatchEvent(new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true })));
    expect(dt.getData("text/plain")).toBe("Doors\t60\nWelcome\t60");
  });

  it("a mouse drag picks a block", async () => {
    mount(sheet());
    const from = cell(0, 0).getBoundingClientRect();
    const to = cell(2, 1).getBoundingClientRect();
    const o = { bubbles: true, isPrimary: true, pointerId: 1, pointerType: "mouse", button: 0 };
    act(() => void cell(0, 0).dispatchEvent(new PointerEvent("pointerdown", { ...o, clientX: from.left + 5, clientY: from.top + 5 })));
    for (const f of [0.5, 1])
      act(() =>
        void document.dispatchEvent(
          new PointerEvent("pointermove", { ...o, clientX: from.left + 5 + (to.left - from.left) * f, clientY: from.top + 5 + (to.top - from.top) * f }),
        ),
      );
    act(() => void document.dispatchEvent(new PointerEvent("pointerup", o)));
    expect(document.querySelectorAll("td[data-inblock]").length).toBe(6);
  });

  it("a finger dragging anywhere but the box is left to scroll", () => {
    mount(sheet());
    act(() => cell(0, 0).click());
    const from = cell(3, 0).getBoundingClientRect();
    const o = { bubbles: true, isPrimary: true, pointerId: 2, pointerType: "touch", button: 0 };
    act(() => void cell(3, 0).dispatchEvent(new PointerEvent("pointerdown", { ...o, clientX: from.left + 5, clientY: from.top + 5 })));
    act(() => void document.dispatchEvent(new PointerEvent("pointermove", { ...o, clientX: from.left + 5, clientY: from.top + 70 })));
    act(() => void document.dispatchEvent(new PointerEvent("pointerup", o)));
    expect(document.querySelectorAll("td[data-inblock]").length).toBe(0);
    expect(at()).toEqual([0, 0]);
  });

  it("keys pressed inside a menu are the menu's — Escape there does not put the box away", () => {
    mount(sheet());
    act(() => cell(1, 1).click());
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    const item = document.createElement("button");
    menu.appendChild(item);
    document.body.appendChild(menu);
    item.focus();
    act(() => void item.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => void item.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(at()).toEqual([1, 1]);
  });
});
