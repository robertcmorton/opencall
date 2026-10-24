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

  const shownIn = (el: HTMLElement) => {
    const fill = el.querySelector(".bar-sweep-fill")!.getBoundingClientRect();
    const box = el.querySelector(".bar-sweeping")!.getBoundingClientRect();
    return (fill.right - box.left) / box.width;
  };
  const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  it("starts the next row from its own beginning — the big timer is one bar every row passes through", async () => {
    const el = host();
    root = createRoot(el);
    // The first row runs its whole length…
    act(() => root!.render(<BarFill className="row-progress" frac={0} sweep={{ key: "row-1", durationMs: 400, elapsedMs: 0 }} />));
    await new Promise((r) => setTimeout(r, 500));
    // …and the second, the same length, comes up from its start: the same
    // animation text as the first, which a browser will not restart by itself.
    act(() => root!.render(<BarFill className="row-progress" frac={0} sweep={{ key: "row-2", durationMs: 400, elapsedMs: 0 }} />));
    await frames();
    expect(shownIn(el)).toBeLessThan(0.6);
    const sweep = document.getAnimations().find((a) => (a as CSSAnimation).animationName === "bar-sweep")!;
    expect(sweep.playState).toBe("running");
  });

  it("a longer row is aimed from where the row has got to, not from where its first animation began", async () => {
    const el = host();
    root = createRoot(el);
    act(() => root!.render(<BarFill className="row-progress" frac={0.2} sweep={{ key: "row-1", durationMs: 10_000, elapsedMs: 2000 }} />));
    await new Promise((r) => setTimeout(r, 1000));
    // A nudge doubles the row after another second: 3 s of 20 s is 15%.
    act(() => root!.render(<BarFill className="row-progress" frac={0.15} sweep={{ key: "row-1", durationMs: 20_000, elapsedMs: 3000 }} />));
    await frames();
    expect(shownIn(el)).toBeGreaterThan(0.13);
    expect(shownIn(el)).toBeLessThan(0.18);
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
