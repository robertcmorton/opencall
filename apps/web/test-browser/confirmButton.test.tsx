import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { ConfirmButton } from "../components/ConfirmButton";

/** Things that cannot be undone ask once, on the button itself (6 Oct). */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const mount = () => {
  let done = 0;
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<ConfirmButton className="btn" label="Delete account" confirmLabel="Press again to delete it" onConfirm={() => done++} />));
  return { done: () => done, button: el.querySelector("button")! };
};

describe("confirm button", () => {
  it("does nothing on the first press, acts on the second", () => {
    const m = mount();
    act(() => m.button.click());
    expect(m.done()).toBe(0);
    expect(m.button.textContent).toBe("Press again to delete it");
    act(() => m.button.click());
    expect(m.done()).toBe(1);
    expect(m.button.textContent).toBe("Delete account");
  });

  it("a press anywhere else, or Escape, takes the question back", () => {
    const m = mount();
    act(() => m.button.click());
    act(() => void document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
    expect(m.button.textContent).toBe("Delete account");
    act(() => m.button.click());
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    act(() => m.button.click());
    expect(m.done()).toBe(0);
  });
});
