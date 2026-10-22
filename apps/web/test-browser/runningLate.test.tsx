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

  it("reads 'on time', not amber, a few seconds either side (21 Oct: it flashed orange every update)", () => {
    for (const wobble of [2, -2, 15]) {
      const list = draw(wobble);
      const pill = list.parentElement!.querySelector(".rl-pill")!;
      expect(pill.textContent).toContain("on time");
      expect(list.querySelector(".rl-target")!.className).not.toContain("is-over");
      act(() => root?.unmount());
      root = null;
      document.body.innerHTML = "";
    }
  });

  it("hangs centred under the line, even when it is wider than the line (21 Oct)", () => {
    const list = draw(80);
    // Make the line narrower than the list, as it is beside the cue timer.
    (list.parentElement as HTMLElement).style.width = "360px";
    const pill = list.parentElement!.querySelector(".rl-pill")!.getBoundingClientRect();
    const box = list.getBoundingClientRect();
    expect(Math.abs(box.left + box.width / 2 - (pill.left + pill.width / 2))).toBeLessThanOrEqual(1);
  });

  it("keeps a struck item in the list, crossed out, with Undo strike — and the rest beside it — once it is on time (21 Oct)", () => {
    const unstruck: [string, number][] = [];
    const el = document.createElement("div");
    el.style.cssText = "width: 560px; margin: 0 auto;";
    document.body.appendChild(el);
    root = createRoot(el);
    const list: TrimRow[] = [
      { id: "a", number: "23", title: "Wrap the scores", durationSec: 30, canDrop: false, locked: false, struck: true },
      { id: "b", number: "24", title: "Reel", durationSec: 60, canDrop: false, locked: false, struck: false },
    ];
    act(() =>
      root!.render(
        <RunningLate
          arrivals={arrivalsFor(-60) as never}
          level={"spare" as never}
          use24h={false}
          manyGames
          trimsFor={() => list}
          canEdit
          onStrike={() => undefined}
          onUnstrike={(id, t) => void unstruck.push([id, t])}
          onTrim={() => undefined}
        />,
      ),
    );
    act(() => el.querySelector<HTMLButtonElement>(".rl-pill")!.click());
    const items = [...el.querySelectorAll(".rl-list li.is-struck")];
    // On time: the struck one, with its number, to be put back…
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("23");
    // …and the other, still there to strike instead (22 Oct).
    expect(el.querySelectorAll(".rl-list ul:not(.rl-targets) > li")).toHaveLength(2);
    act(() => [...el.querySelectorAll<HTMLButtonElement>(".rl-actions button")].find((b) => b.textContent === "Undo strike")!.click());
    expect(unstruck).toEqual([["a", 5]]);
  });

  /**
   * 22 Oct, Robert: "if I select something that brings it on time, it removes
   * all the options that are available to me." Strike or trim until on time,
   * and every option is still there to change your mind or take more.
   */
  it("keeps every option once a strike or a trim brings it on time", () => {
    const el = document.createElement("div");
    el.style.cssText = "width: 560px; margin: 0 auto;";
    document.body.appendChild(el);
    root = createRoot(el);
    const list: TrimRow[] = [
      { id: "a", number: "23", title: "Wrap the scores", durationSec: 30, canDrop: false, locked: false, struck: false },
      { id: "b", number: "24", title: "Reel", durationSec: 60, canDrop: false, locked: false, struck: false },
      { id: "c", number: "25", title: "Crowd cam", durationSec: 45, canDrop: false, locked: false, struck: false },
    ];
    const show = (overSec: number) =>
      act(() =>
        root!.render(
          <RunningLate
            arrivals={arrivalsFor(overSec) as never}
            level={(overSec > 0 ? "over" : "spare") as never}
            use24h={false}
            manyGames
            trimsFor={() => list}
            canEdit
            onStrike={() => undefined}
            onTrim={() => undefined}
          />,
        ),
      );
    const rows = () => el.querySelectorAll(".rl-list ul:not(.rl-targets) > li").length;
    show(40);
    act(() => el.querySelector<HTMLButtonElement>(".rl-pill")!.click());
    expect(rows()).toBe(3);
    // −30 s on the reel: 40 s over becomes 10 s, inside the allowance — on time.
    act(() => [...el.querySelectorAll<HTMLButtonElement>(".rl-actions button")].filter((b) => b.textContent === "−30 s")[1]!.click());
    show(10);
    expect(el.querySelector(".rl-head")!.textContent).toContain("On time now");
    expect(rows()).toBe(3);
  });

  it("still lists nothing when it is on time and nothing has been done", () => {
    const list = draw(-300); // opens the list
    expect(list.querySelectorAll("ul:not(.rl-targets) > li")).toHaveLength(0);
    expect(list.querySelector(".rl-head")!.textContent).toContain("nothing to trim");
  });
});