import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import "../app/globals.css";
import { BarFill } from "../components/BarFill";

let root: Root | null = null;
const host = () => {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:400px;height:20px";
  document.body.appendChild(el);
  return el;
};
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("progress bar of a running row", () => {
  it("moves by transform, never by width — a width animation re-lays out the page every frame", async () => {
    const el = host();
    root = createRoot(el);
    act(() => root!.render(<BarFill className="row-progress" frac={0.25} sweep={{ key: "row-1", durationMs: 60_000, elapsedMs: 15_000 }} />));
    const anims = document.getAnimations().filter((a) => (a as CSSAnimation).animationName === "bar-sweep");
    expect(anims.length).toBe(1);
    const props = new Set(
      (anims[0]!.effect as KeyframeEffect).getKeyframes().flatMap((k) => Object.keys(k)),
    );
    expect(props.has("transform")).toBe(true);
    expect(props.has("width")).toBe(false);
  });

  it("starts partway through, showing the elapsed share of the row", async () => {
    const el = host();
    root = createRoot(el);
    act(() => root!.render(<BarFill className="row-progress" frac={0.25} sweep={{ key: "row-1", durationMs: 60_000, elapsedMs: 15_000 }} />));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const fill = el.querySelector(".bar-sweep-fill")!.getBoundingClientRect();
    const box = el.querySelector(".bar-sweeping")!.getBoundingClientRect();
    const shown = (fill.right - box.left) / box.width;
    expect(shown).toBeGreaterThan(0.24);
    expect(shown).toBeLessThan(0.3);
  });

  it("draws a plain width when there is nothing to sweep towards (paused or overrunning)", () => {
    const el = host();
    root = createRoot(el);
    act(() => root!.render(<BarFill className="row-progress" frac={0.5} sweep={null} />));
    const bar = el.querySelector(".row-progress") as HTMLElement;
    expect(bar.classList.contains("bar-sweeping")).toBe(false);
    expect(bar.getBoundingClientRect().width).toBeCloseTo(200, 0);
  });
});
