import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import "../app/globals.css";
import { DialogHost } from "../components/DialogHost";
import { ask, askText, say } from "../lib/dialogs";

/** The app's own notes, questions and type-in boxes, in place of the browser's (6 Oct). */

let root: Root | null = null;
const mount = () => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<DialogHost />));
};
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("app dialogs", () => {
  it("a question answers yes or no; a dangerous one starts on Cancel", async () => {
    mount();
    let p!: Promise<boolean>;
    act(() => void (p = ask({ title: "End this event?", confirmLabel: "End event", danger: true })));
    await act(tick);
    const d = document.querySelector("dialog.app-dialog") as HTMLDialogElement;
    expect(d.open).toBe(true);
    expect(document.activeElement?.textContent).toBe("Cancel");
    act(() => (d.querySelector("button[type=submit]") as HTMLButtonElement).click());
    expect(await p).toBe(true);
  });

  it("Escape is a no", async () => {
    mount();
    let p!: Promise<boolean>;
    act(() => void (p = ask({ title: "Sure?" })));
    await act(tick);
    act(() => void document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(await p).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("a type-in box will not close on something it cannot use, and says why", async () => {
    mount();
    let p!: Promise<string | null>;
    act(() => void (p = askText({ title: "Start time", label: "Time", value: "soon", validate: (v) => (/\d/.test(v) ? null : "That isn't a time.") })));
    await act(tick);
    const d = document.querySelector("dialog") as HTMLDialogElement;
    act(() => (d.querySelector("button[type=submit]") as HTMLButtonElement).click());
    expect(d.open).toBe(true);
    expect(d.querySelector(".app-dialog-problem")?.textContent).toBe("That isn't a time.");
    const input = d.querySelector("input")!;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "7:30 pm");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => (d.querySelector("button[type=submit]") as HTMLButtonElement).click());
    expect(await p).toBe("7:30 pm");
  });

  it("a note shows, and an error says so to a screen reader", async () => {
    mount();
    act(() => say("Template saved.", "success"));
    act(() => say("It wasn't saved.", "error"));
    const notes = [...document.querySelectorAll(".app-note")];
    expect(notes.map((n) => n.textContent?.replace(/\s+$/, ""))).toEqual(["Template saved.", "It wasn't saved."]);
    expect(notes[1]!.getAttribute("role")).toBe("alert");
  });
});
