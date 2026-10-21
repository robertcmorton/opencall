import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { RunningLate, type TrimRow } from "../components/RunningLate";
import "../app/globals.css";

/**
 * The running-late list (21 Oct, Robert's iPad: "a lot of empty space with
 * nothing in it"). It was centred with a CSS transform, and a transform makes
 * an ancestor the containing block for `position: fixed` — so every button's
 * hover tip, placed in SCREEN coordinates by keepTipsOnScreen, landed inside
 * the list instead, invisible but still widening what it scrolls. The list
 * scrolled sideways, cut its first letters off and showed blank space.
 */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const trims: TrimRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: String(i),
  title: i % 3 ? "Rehearsals | collect comms and in ears for everyone on the field" : "",
  durationSec: 600 + i,
  canDrop: i === 2,
  locked: false,
  struck: false,
}));

const H = 3600;
const target = (index: number, name: string, atSec: number, game: number) => ({ index, name, atSec, game });
/** Game 1's two halves and game 2's first, the next one `overSec` late or early. */
const arrivalsFor = (overSec: number) => [
  { target: target(5, "1st half", 17 * H + 40 * 60, 1), arrivesSec: 17 * H + 40 * 60 + overSec, overSec, untilSec: 600 },
  { target: target(9, "2nd half", 18 * H + 35 * 60, 1), arrivesSec: 18 * H + 35 * 60 + Math.max(0, overSec), overSec: Math.max(0, overSec), untilSec: 3900 },
  { target: target(30, "1st half", 20 * H, 2), arrivesSec: 20 * H, overSec: 0, untilSec: 9000 },
];

const draw = (overSec: number, onStrike: (id: string, t: number) => void = () => undefined) => {
  const el = document.createElement("div");
  el.style.cssText = "width: 560px; margin: 0 auto;";
  document.body.appendChild(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      <RunningLate
        arrivals={arrivalsFor(overSec) as never}
        level={(overSec > 0 ? "over" : "spare") as never}
        use24h={false}
        manyGames
        trimsFor={() => trims}
        canEdit
        onStrike={onStrike}
        onTrim={() => undefined}
      />,
    ),
  );
  act(() => el.querySelector<HTMLButtonElement>(".rl-pill")!.click());
  return el.querySelector<HTMLElement>(".rl-list")!;
};

describe("running late — the list of what could be trimmed", () => {
  it("never scrolls sideways, wherever the buttons' tips have been placed", () => {
    const list = draw(80);
    // Where keepTipsOnScreen would put each tip: far across the screen.
    for (const b of list.querySelectorAll<HTMLElement>("[data-tip]")) b.style.setProperty("--tip-left", "1500px");
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + 1);
  });

  it("keeps a 'can drop' tag inside the list beside a long title", () => {
    const list = draw(80);
    const tag = list.querySelector<HTMLElement>(".rl-tag")!;
    expect(tag.getBoundingClientRect().right).toBeLessThanOrEqual(list.getBoundingClientRect().right);
  });

  it("lists nothing to trim when there is time to spare", () => {
    const list = draw(-900);
    expect(list.querySelectorAll(".rl-actions").length).toBe(0);
    expect(list.textContent).toContain("15:00 to spare");
  });

  it("says how long until the next fixed time, on the line itself", () => {
    const list = draw(-900);
    const pill = list.parentElement!.querySelector(".rl-pill")!.textContent!;
    expect(pill).toContain("Game 1 · 1st half");
    expect(pill).toContain("in 10:00");
  });

  it("lists every half of every game ahead, with its time and how it will arrive", () => {
    const list = draw(80);
    const lines = [...list.querySelectorAll(".rl-target")].map((b) => b.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("Game 1 · 1st half");
    expect(lines[0]).toContain("1:20 over");
    expect(lines[1]).toContain("Game 1 · 2nd half");
    expect(lines[2]).toContain("Game 2 · 1st half");
    expect(lines[2]).toContain("on time");
  });

  it("trims before whichever one is picked", () => {
    const struck: [string, number][] = [];
    const list = draw(80, (id, t) => void struck.push([id, t]));
    act(() => list.querySelectorAll<HTMLButtonElement>(".rl-target")[1]!.click());
    expect(list.querySelector(".rl-head")!.textContent).toContain("Game 1 · 2nd half must start");
    act(() => [...list.querySelectorAll<HTMLButtonElement>(".rl-actions button")].find((b) => b.textContent === "Strike")!.click());
    expect(struck).toEqual([["0", 9]]);
  });
});
