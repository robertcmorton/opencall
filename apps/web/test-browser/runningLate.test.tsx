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

const draw = (overSec: number) => {
  const el = document.createElement("div");
  el.style.cssText = "width: 560px; margin: 0 auto;";
  document.body.appendChild(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      <RunningLate
        arrival={{ target: { name: "1st half", atSec: 63600 }, overSec, arrivesSec: 63600 + overSec, untilSec: 600 } as never}
        level={(overSec > 0 ? "over" : "spare") as never}
        use24h={false}
        trims={trims}
        canEdit
        onStrike={() => undefined}
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
    expect(list.querySelectorAll("li").length).toBe(0);
    expect(list.textContent).toContain("15:00 to spare");
  });
});
