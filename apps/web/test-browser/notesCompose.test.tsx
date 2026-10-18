import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { NotesPanel } from "../components/NotesPanel";

/** A view-only phone could open the note box and never type in it (18 Oct). */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const mount = (rowId: string | null, sent: string[]) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  const render = (id: string | null) =>
    act(() =>
      root!.render(
        <NotesPanel
          notes={[]}
          titleOf={() => null}
          numberOf={() => ""}
          onResolve={() => undefined}
          onGoToRow={() => undefined}
          onClose={() => undefined}
          compose={{ rowId: id, rowLabel: id ? "Kick off" : null, onSend: async (body) => void sent.push(body) }}
        />,
      ),
    );
  render(rowId);
  return { el, render };
};

const type = (ta: HTMLTextAreaElement, text: string) => {
  // React tracks the value; set it the way the browser does, then announce it.
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(ta, text);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("a note from a view-only link", () => {
  it("can be typed before a row is picked; sending waits for the row", async () => {
    const sent: string[] = [];
    const { el, render } = mount(null, sent);
    const ta = el.querySelector("textarea")!;
    expect(ta.disabled).toBe(false);
    act(() => type(ta, "Wrong name"));
    expect(ta.value).toBe("Wrong name");
    expect(el.querySelector<HTMLButtonElement>("button[type=submit]")!.disabled).toBe(true);
    render("row-1");
    expect(el.textContent).toContain("About Kick off");
    await act(async () => el.querySelector<HTMLButtonElement>("button[type=submit]")!.click());
    expect(sent).toEqual(["Wrong name"]);
    expect(el.querySelector(".note-sent")?.textContent).toContain("Sent");
    // The list is the showcaller's: nothing about "No notes right now" here.
    expect(el.textContent).not.toContain("No notes right now");
    expect(el.textContent).toContain("Note to the showcaller");
  });
});
