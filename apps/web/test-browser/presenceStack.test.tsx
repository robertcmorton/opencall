import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import type { PresencePerson } from "@opencall/protocol";
import { PresenceStack } from "../components/PresenceStack";

/** Who is on the sheet, as faces at the top right (20 Oct). */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const person = (id: string, name: string, extra: Partial<PresencePerson> = {}): PresencePerson => ({ id, ids: [id], name, role: "follower", screens: 1, ...extra });

const mount = (people: PresencePerson[], me: string | null, max = 4) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(<PresenceStack people={people} me={me} photoBase="http://sync" max={max} />));
  return el;
};

describe("faces of the people on a sheet", () => {
  it("leaves you out — this screen, and any other screen of yours", () => {
    const el = mount([person("c1", "Robert Morton", { role: "caller", ids: ["c1", "c2"], screens: 2 }), person("s1", "Sam, Camera 2")], "c2");
    const tips = [...el.querySelectorAll<HTMLElement>(".pf-slot")].map((s) => s.dataset.tip);
    expect(tips).toEqual(["Sam, Camera 2 · Crew"]);
  });
  it("shows a photo when there is one, initials when not", () => {
    const el = mount([person("a", "Lee Audio", { photo: "/users/u1/photo?v=1" }), person("b", "Sam Cole")], null);
    expect(el.querySelector("img")?.getAttribute("src")).toBe("http://sync/users/u1/photo?v=1");
    expect([...el.querySelectorAll(".pf-face")].map((f) => f.textContent)).toContain("SC");
  });
  it("past the limit, the last place says +N", () => {
    const el = mount(["A B", "C D", "E F", "G H", "I J", "K L"].map((n, i) => person(String(i), n)), null, 4);
    const faces = [...el.querySelectorAll(".pf-face")].map((f) => f.textContent);
    expect(faces).toHaveLength(4);
    expect(faces.at(-1)).toBe("+3");
  });
  it("pressing it lists everyone, you last; Escape closes it", () => {
    const el = mount([person("a", "Lee Audio", { role: "editor" })], "me");
    act(() => el.querySelector<HTMLButtonElement>(".pf-faces")!.click());
    const rows = [...el.querySelectorAll(".pf-list li")].map((l) => l.textContent);
    expect(rows[0]).toContain("Lee Audio");
    expect(rows[0]).toContain("Producer");
    expect(rows.at(-1)).toContain("This screen");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(el.querySelector(".pf-list")).toBeNull();
  });
  it("nobody else here: nothing at all", () => {
    expect(mount([person("me", "Me")], "me").querySelector(".presence-stack")).toBeNull();
  });
});
