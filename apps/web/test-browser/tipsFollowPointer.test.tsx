import { afterEach, describe, expect, it } from "vitest";
import { keepTipsOnScreen } from "../lib/keepTipsOnScreen";
import "../app/globals.css";

/**
 * Tips on big things follow the pointer (21 Oct, Robert: "mouse over text
 * info in the wrong place"). A sheet row is as wide as the screen; its tip was
 * centred above the whole row, nowhere near the mouse.
 */
let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
  document.body.innerHTML = "";
});

const px = (el: HTMLElement, v: string) => parseFloat(el.style.getPropertyValue(v));

describe("where a tip appears", () => {
  it("by the pointer, over a row as wide as the screen", () => {
    document.body.innerHTML = `<table style="width:100%;margin-top:300px"><tbody><tr data-tip="Runs at the same time as the anthem"><td style="height:200px">row</td></tr></tbody></table>`;
    stop = keepTipsOnScreen();
    const tr = document.querySelector("tr") as HTMLElement;
    const td = tr.querySelector("td")!;
    td.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 120, clientY: 420 }));
    const left = px(tr, "--tip-left");
    const top = px(tr, "--tip-top");
    // Centred on x = 120 (pulled inside the screen if need be), just above y = 420.
    expect(left).toBeLessThan(120);
    expect(top).toBeLessThan(420);
    expect(top).toBeGreaterThan(300);
  });

  it("on the thing itself, over a small button — wherever the pointer is", () => {
    document.body.innerHTML = `<button data-tip="Strike it out" style="position:absolute;left:100px;top:400px;width:60px;height:30px">Strike</button>`;
    stop = keepTipsOnScreen();
    const b = document.querySelector("button") as HTMLElement;
    b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 101, clientY: 401 }));
    const first = [px(b, "--tip-left"), px(b, "--tip-top")];
    b.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 159, clientY: 429 }));
    expect([px(b, "--tip-left"), px(b, "--tip-top")]).toEqual(first);
    expect(first[1]).toBeLessThan(b.getBoundingClientRect().top);
  });
});
