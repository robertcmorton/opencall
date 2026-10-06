import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import "../app/globals.css";
import { RowMenu, type RowMenuEntry } from "../components/RowMenu";

/** The row menu in a real browser: where it lands, the keyboard, and closing. */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const entries = (picked: string[]): RowMenuEntry[] => [
  { heading: "Row 3" },
  { label: "Add a row above", onSelect: () => picked.push("above") },
  { label: "Add a row below", onSelect: () => picked.push("below") },
  "sep",
  { label: "Only play this if…", keepOpen: true, onSelect: () => picked.push("results") },
  { swatches: [{ key: "red", label: "Colour it red", css: "#a33", onSelect: () => picked.push("red") }] },
  { label: "Delete row", danger: true, onSelect: () => picked.push("delete") },
];

const open = (x: number, y: number, extra: { touch?: boolean; sheet?: boolean } = {}) => {
  const picked: string[] = [];
  let closed = 0;
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<RowMenu x={x} y={y} entries={entries(picked)} onClose={() => closed++} {...extra} />));
  return { picked, closed: () => closed, menu: document.querySelector(".row-menu") as HTMLElement };
};

describe("row menu", () => {
  it("opens where the mouse is, and stays on screen near the bottom-right corner", () => {
    const near = open(40, 40);
    expect(Math.round(near.menu.getBoundingClientRect().left)).toBe(40);
    act(() => root!.unmount());
    document.body.innerHTML = "";
    const corner = open(innerWidth - 5, innerHeight - 5);
    const r = corner.menu.getBoundingClientRect();
    expect(r.right).toBeLessThanOrEqual(innerWidth);
    expect(r.bottom).toBeLessThanOrEqual(innerHeight);
  });

  it("takes the keyboard: first item focused, arrows move, Enter chooses, Escape closes", () => {
    const m = open(40, 40);
    expect(document.activeElement?.textContent).toBe("Add a row above");
    act(() => void m.menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement?.textContent).toBe("Add a row below");
    act(() => (document.activeElement as HTMLButtonElement).click());
    expect(m.picked).toEqual(["below"]);
    expect(m.closed()).toBe(1);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(m.closed()).toBe(2);
  });

  it("an item that asks again keeps the menu open", () => {
    const m = open(40, 40);
    const item = [...m.menu.querySelectorAll("button")].find((b) => b.textContent === "Only play this if…")!;
    act(() => item.click());
    expect(m.picked).toEqual(["results"]);
    expect(m.closed()).toBe(0);
  });

  it("a press outside closes it", () => {
    const m = open(40, 40);
    act(() => void document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(m.closed()).toBe(1);
  });

  it("by finger: buttons at least 44px tall, and no focus ring waiting on the first one", () => {
    const m = open(40, 40, { touch: true });
    const h = Math.min(...[...m.menu.querySelectorAll<HTMLElement>(".row-menu-item")].map((b) => b.getBoundingClientRect().height));
    expect(h).toBeGreaterThanOrEqual(44);
    expect(m.menu.contains(document.activeElement)).toBe(false);
  });

  it("on a phone: a full-width sheet from the bottom, with Cancel", async () => {
    const m = open(40, 40, { touch: true, sheet: true });
    // It slides up (6 Oct): measure where it settles, not mid-slide.
    await Promise.all(document.getAnimations().map((a) => a.finished));
    const r = m.menu.getBoundingClientRect();
    expect(Math.round(r.left)).toBe(0);
    expect(Math.round(r.right)).toBe(document.documentElement.clientWidth);
    expect(Math.round(r.bottom)).toBe(innerHeight);
    expect([...m.menu.querySelectorAll("button")].some((b) => b.textContent === "Cancel")).toBe(true);
  });

  it("is a proper menu to a screen reader: items, colour choices and separators only", () => {
    const m = open(40, 40);
    expect(m.menu.getAttribute("role")).toBe("menu");
    for (const child of m.menu.children) {
      const role = child.getAttribute("role");
      expect(["menuitem", "menuitemradio", "separator", "group", "presentation", "note"]).toContain(role);
    }
    expect(m.menu.querySelector("[role=group] button")?.getAttribute("role")).toBe("menuitemradio");
  });
});
