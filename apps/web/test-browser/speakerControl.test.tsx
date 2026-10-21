import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { CrewMessage, SpeakerBanner, SpeakerControl } from "../components/SpeakerMessage";
import type { SpeakerMessage } from "@opencall/protocol";

/** The Message box closes on Escape, not only on a press elsewhere (6 Oct). */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Message", () => {
  it("Escape closes the box and hands focus back to the button", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => root!.render(<SpeakerControl message={null} onSay={() => undefined} />));
    const toggle = el.querySelector("button")!;
    act(() => toggle.click());
    expect(el.querySelector("[data-popover]")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(el.querySelector("[data-popover]")).toBeNull();
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps one width whether or not a message is up (21 Oct)", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => root!.render(<SpeakerControl message={null} onSay={() => undefined} />));
    const w0 = el.querySelector<HTMLElement>(".speaker-toggle")!.className;
    const up: SpeakerMessage = { text: "Hold the walk-out for two minutes, the anthem singer is not ready", from: "Showcaller", atMs: 1, to: "all" };
    act(() => root!.render(<SpeakerControl message={up} onSay={() => undefined} />));
    const b = el.querySelector<HTMLElement>(".speaker-toggle")!;
    // Same button, same class that fixes its width; the words are in its label.
    expect(w0).toContain("speaker-toggle");
    expect(el.querySelectorAll("button").length).toBe(1);
    expect(b.getAttribute("aria-label")).toContain("everyone");
  });

  it("sends to whoever is chosen, and remembers what was typed as a one-tap button", () => {
    localStorage.removeItem("oc:recentmessages");
    localStorage.removeItem("oc:messageto");
    const sent: [string | null, string | undefined][] = [];
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => root!.render(<SpeakerControl message={null} onSay={(t, to) => void sent.push([t, to])} />));
    act(() => el.querySelector<HTMLButtonElement>(".speaker-toggle")!.click());
    // No fixed list any more: nothing to tap until something has been sent.
    expect(el.querySelector(".speaker-quick")).toBeNull();
    act(() => [...el.querySelectorAll<HTMLButtonElement>('.speaker-to [role="radio"]')].find((b) => b.textContent === "Crew")!.click());
    const input = el.querySelector<HTMLInputElement>(".speaker-pop input")!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "Two minutes to doors");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => el.querySelector<HTMLButtonElement>(".speaker-pop button[type=submit]")!.click());
    expect(sent).toEqual([["Two minutes to doors", "crew"]]);
    act(() => el.querySelector<HTMLButtonElement>(".speaker-toggle")!.click());
    expect([...el.querySelectorAll(".speaker-quick button")].map((b) => b.textContent)).toEqual(["Two minutes to doors"]);
  });

  it("puts each message only where it is meant to go", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    const m = (to: "stage" | "crew" | "all" | undefined): SpeakerMessage => ({ text: "Wrap", from: "SC", atMs: 2, ...(to ? { to } : {}) });
    const where = (msg: SpeakerMessage) => {
      act(() =>
        root!.render(
          <>
            <SpeakerBanner message={msg} />
            <CrewMessage message={msg} />
          </>,
        ),
      );
      return [!!el.querySelector(".speaker-banner"), !!el.querySelector(".crew-message")];
    };
    expect(where(m(undefined))).toEqual([true, false]);
    expect(where(m("stage"))).toEqual([true, false]);
    expect(where(m("crew"))).toEqual([false, true]);
    expect(where(m("all"))).toEqual([true, true]);
  });
});
