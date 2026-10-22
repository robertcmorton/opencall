import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { RunningLate, type TrimRow } from "../components/RunningLate";
import "../app/globals.css";

/**
 * The running-late list (22 Oct, option A): a dropdown under the line, up to
 * 720px. Measured on a test double-header the old one cut names to 300px of a
 * 520px box, opened on a half due now with nothing to trim, and led nowhere in
 * the sheet. Now: fixed times as chips, a line saying what there is to find,
 * whole names, and each item a link to its row. (Robert tried a side panel,
 * option B, and preferred the dropdown.)
 *
 * Kept from before: it never scrolls sideways (21 Oct, the transform that
 * trapped every button's tip inside it), it hangs centred under the line, on
 * time a few seconds either side, and the 21–22 Oct rules about what is listed
 * when.
 */

let root: Root | null = null;
afterEach(async () => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  await page.viewport(1280, 800);
});

const LONG = "Half-time highlights package with the pre-recorded interviews from both coaches and the HARBOUR captain";
const trims: TrimRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: String(i),
  number: String(20 + i),
  title: i % 3 ? LONG : "",
  durationSec: 600 + i,
  canDrop: i === 2,
  locked: false,
  struck: false,
}));

const H = 3600;
const target = (index: number, name: string, atSec: number, game: number) => ({ index, name, atSec, game });
const arrivalsFor = (overSec: number) => [
  { target: target(5, "1st half", 17 * H + 40 * 60, 1), arrivesSec: 17 * H + 40 * 60 + overSec, overSec, untilSec: 600 },
  { target: target(9, "2nd half", 18 * H + 35 * 60, 1), arrivesSec: 18 * H + 35 * 60 + Math.max(0, overSec), overSec: Math.max(0, overSec), untilSec: 3900 },
  { target: target(30, "1st half", 20 * H, 2), arrivesSec: 20 * H, overSec: 0, untilSec: 9000 },
];

const panelEl = () => document.querySelector<HTMLElement>(".rl-list");
const pillEl = () => document.querySelector<HTMLButtonElement>(".rl-pill")!;

const draw = (
  overSec: number,
  opts: { onStrike?: (id: string, t: number) => void; onShowRow?: (id: string) => void; onListing?: (ids: string[] | null) => void; arrivals?: unknown; list?: TrimRow[] } = {},
) => {
  const el = document.createElement("div");
  el.style.cssText = "width: 560px; margin: 0 auto;";
  document.body.appendChild(el);
  root = createRoot(el);
  const render = (o: number) =>
    act(() =>
      root!.render(
        <RunningLate
          arrivals={(opts.arrivals ?? arrivalsFor(o)) as never}
          level={(o > 0 ? "over" : "spare") as never}
          use24h={false}
          manyGames
          trimsFor={() => opts.list ?? trims}
          canEdit
          onStrike={opts.onStrike ?? (() => undefined)}
          onTrim={() => undefined}
          onShowRow={opts.onShowRow}
          onListing={opts.onListing}
        />,
      ),
    );
  render(overSec);
  act(() => pillEl().click());
  return { panel: panelEl()!, render };
};

describe("running late — the list of what could be trimmed", () => {
  it("never scrolls sideways, wherever the buttons' tips have been placed", () => {
    const { panel } = draw(80);
    // Where keepTipsOnScreen would put each tip: far across the screen.
    for (const b of panel.querySelectorAll<HTMLElement>("[data-tip]")) b.style.setProperty("--tip-left", "1500px");
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  });

  it("hangs centred under the line, even when it is wider than the line (21 Oct)", () => {
    const { panel } = draw(80);
    // Make the line narrower than the list, as it is beside the cue timer.
    (panel.parentElement as HTMLElement).style.width = "360px";
    const pill = pillEl().getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(pill.width);
    expect(Math.abs(box.left + box.width / 2 - (pill.left + pill.width / 2))).toBeLessThanOrEqual(1);
  });

  it("is up to 720px wide, and 16px clear of each edge on a phone", async () => {
    expect(Math.round(draw(80).panel.getBoundingClientRect().width)).toBe(720);
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    await page.viewport(390, 800);
    const { panel } = draw(80);
    // On a phone the line spans the screen, centred, as it does on the show page.
    (panel.parentElement!.parentElement as HTMLElement).style.cssText = "width: 100%; display: flex; justify-content: center;";
    const box = panel.getBoundingClientRect();
    expect(Math.round(box.width)).toBe(358);
    expect(Math.round(box.left)).toBe(16);
  });

  it("shows each name whole, wrapping, with a 'can drop' tag inside the list", () => {
    const { panel } = draw(80);
    const names = [...panel.querySelectorAll<HTMLElement>(".rl-text")].filter((t) => t.textContent === LONG);
    expect(names.length).toBeGreaterThan(0);
    for (const t of names) expect(t.scrollWidth).toBeLessThanOrEqual(t.clientWidth + 1);
    expect(names[0]!.getBoundingClientRect().height).toBeGreaterThan(30); // more than one line
    const tag = panel.querySelector<HTMLElement>(".rl-tag")!;
    expect(tag.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
  });

  it("lists nothing to trim when there is time to spare", () => {
    const { panel } = draw(-900);
    expect(panel.querySelectorAll(".rl-actions").length).toBe(0);
    expect(panel.textContent).toContain("15:00 to spare");
  });

  it("says how long until the next fixed time, on the line itself", () => {
    draw(-900);
    const pill = pillEl().textContent!;
    expect(pill).toContain("Game 1 · 1st half");
    expect(pill).toContain("in 10:00");
  });

  it("shows every half of every game ahead as a chip, with how it will arrive", () => {
    const { panel } = draw(80);
    const chips = [...panel.querySelectorAll(".rl-chip")].map((b) => b.textContent);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toContain("Game 1 · 1st half");
    expect(chips[0]).toContain("1:20 over");
    expect(chips[1]).toContain("Game 1 · 2nd half");
    expect(chips[2]).toContain("Game 2 · 1st half");
    expect(chips[2]).toContain("on time");
  });

  it("trims before whichever one is picked", () => {
    const struck: [string, number][] = [];
    const { panel } = draw(80, { onStrike: (id, t) => void struck.push([id, t]) });
    act(() => panel.querySelectorAll<HTMLButtonElement>(".rl-chip")[1]!.click());
    expect(panel.querySelector(".rl-head")!.textContent).toContain("Game 1 · 2nd half must start");
    act(() => [...panel.querySelectorAll<HTMLButtonElement>(".rl-actions button")].find((b) => b.textContent === "Strike")!.click());
    expect(struck).toEqual([["0", 9]]);
  });

  /** 22 Oct: it opened on a half due NOW, "nothing left to trim", while the next was 6:03 over. */
  it("opens on the first fixed time something can still be done about", () => {
    const arrivals = arrivalsFor(80);
    arrivals[0] = { ...arrivals[0]!, untilSec: 0 }; // the 1st half is due now
    const { panel } = draw(80, { arrivals });
    expect(panel.querySelector(".rl-chip.is-on")!.textContent).toContain("Game 1 · 2nd half");
  });

  it("says what there is to find, what has been found and what could go", () => {
    const list: TrimRow[] = [
      { id: "a", number: "23", title: "Reel", durationSec: 60, canDrop: false, locked: false, struck: false },
      { id: "b", number: "24", title: "Crowd cam", durationSec: 45, canDrop: false, locked: false, struck: false },
    ];
    const { panel, render } = draw(80, { list });
    expect(panel.querySelector(".rl-need")!.textContent).toBe("Find 1:20 before then · up to 1:45 could go");
    act(() => [...panel.querySelectorAll<HTMLButtonElement>(".rl-actions button")].find((b) => b.textContent === "Strike")!.click());
    render(20);
    expect(panelEl()!.querySelector(".rl-need")!.textContent).toContain("Found 1:00 of 1:20");
  });

  it("says when even everything left is not enough", () => {
    const list: TrimRow[] = [{ id: "a", number: "23", title: "Reel", durationSec: 30, canDrop: false, locked: false, struck: false }];
    const { panel } = draw(80, { list });
    expect(panel.querySelector(".rl-need")!.textContent).toContain("even all of it leaves 50 s over");
  });

  it("takes the sheet to an item's row from its name or its number, and closes", () => {
    const shown: string[] = [];
    const listed: (string[] | null)[] = [];
    draw(80, { onShowRow: (id) => void shown.push(id), onListing: (ids) => void listed.push(ids) });
    expect(listed.at(-1)).toEqual(trims.map((t) => t.id));
    const link = panelEl()!.querySelector<HTMLButtonElement>(".rl-num-link")!;
    expect(link.getAttribute("aria-label")).toBe("Show row 20 in the sheet");
    act(() => link.click());
    expect(shown).toEqual(["0"]);
    expect(panelEl()).toBeNull();
    expect(listed.at(-1)).toBeNull();
    act(() => pillEl().click());
    act(() => panelEl()!.querySelectorAll<HTMLButtonElement>(".rl-text-link")[1]!.click());
    expect(shown).toEqual(["0", "1"]);
    expect(panelEl()).toBeNull();
  });

  it("closes when you press outside it, or Escape", () => {
    draw(80);
    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(panelEl()).toBeNull();
    act(() => pillEl().click());
    expect(panelEl()).not.toBeNull();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(panelEl()).toBeNull();
  });

  it("reads 'on time', not amber, a few seconds either side (21 Oct: it flashed orange every update)", () => {
    for (const wobble of [2, -2, 15]) {
      const { panel } = draw(wobble);
      expect(pillEl().textContent).toContain("on time");
      expect(panel.querySelector(".rl-chip")!.className).not.toContain("is-over");
      act(() => root?.unmount());
      root = null;
      document.body.innerHTML = "";
    }
  });

  it("keeps a struck item, crossed out, with Undo strike — and the rest beside it — once it is on time (21 Oct)", () => {
    const unstruck: [string, number][] = [];
    const el = document.createElement("div");
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
    act(() => pillEl().click());
    const panel = panelEl()!;
    const items = [...panel.querySelectorAll(".rl-items li.is-struck")];
    // On time: the struck one, with its number, to be put back…
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("23");
    // …and the other, still there to strike instead (22 Oct).
    expect(panel.querySelectorAll(".rl-items > li")).toHaveLength(2);
    act(() => [...panel.querySelectorAll<HTMLButtonElement>(".rl-actions button")].find((b) => b.textContent === "Undo strike")!.click());
    expect(unstruck).toEqual([["a", 5]]);
  });

  /**
   * 22 Oct, Robert: "if I select something that brings it on time, it removes
   * all the options that are available to me." Strike or trim until on time,
   * and every option is still there to change your mind or take more.
   */
  it("keeps every option once a strike or a trim brings it on time", () => {
    const list: TrimRow[] = [
      { id: "a", number: "23", title: "Wrap the scores", durationSec: 30, canDrop: false, locked: false, struck: false },
      { id: "b", number: "24", title: "Reel", durationSec: 60, canDrop: false, locked: false, struck: false },
      { id: "c", number: "25", title: "Crowd cam", durationSec: 45, canDrop: false, locked: false, struck: false },
    ];
    const { panel, render } = draw(40, { list });
    const rows = () => panelEl()!.querySelectorAll(".rl-items > li").length;
    expect(rows()).toBe(3);
    // −30 s on the reel: 40 s over becomes 10 s, inside the allowance — on time.
    act(() => [...panel.querySelectorAll<HTMLButtonElement>(".rl-actions button")].filter((b) => b.textContent === "−30 s")[1]!.click());
    render(10);
    expect(panelEl()!.querySelector(".rl-head")!.textContent).toContain("On time now");
    expect(rows()).toBe(3);
  });

  it("still lists nothing when it is on time and nothing has been done", () => {
    const { panel } = draw(-300);
    expect(panel.querySelectorAll(".rl-items > li")).toHaveLength(0);
    expect(panel.querySelector(".rl-head")!.textContent).toContain("nothing to trim");
  });
});
