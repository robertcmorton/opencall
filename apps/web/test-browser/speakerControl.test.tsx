import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { SpeakerControl } from "../components/SpeakerMessage";

/** The Message stage box closes on Escape, not only on a press elsewhere (6 Oct). */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("Message stage", () => {
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
});
