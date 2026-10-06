import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { useZoomLock } from "../components/ViewportLock";

/** Pinch-zoom: allowed, except on the show page while a show is live (6 Oct). */

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function Probe({ live }: { live: boolean }) {
  useZoomLock(live);
  return null;
}

describe("zoom lock", () => {
  it("locks only while live, and puts the page back as it was", () => {
    const meta = document.querySelector('meta[name="viewport"]') ?? document.head.appendChild(Object.assign(document.createElement("meta"), { name: "viewport" }));
    (meta as HTMLMetaElement).content = "width=device-width, initial-scale=1, viewport-fit=cover";
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    const pinch = () => {
      const e = new Event("gesturestart", { cancelable: true });
      document.dispatchEvent(e);
      return e.defaultPrevented;
    };

    act(() => root!.render(<Probe live={false} />));
    expect((meta as HTMLMetaElement).content).not.toMatch(/user-scalable=no/);
    expect(pinch()).toBe(false);

    act(() => root!.render(<Probe live={true} />));
    expect((meta as HTMLMetaElement).content).toMatch(/maximum-scale=1, user-scalable=no/);
    expect(pinch()).toBe(true);

    act(() => root!.render(<Probe live={false} />));
    expect((meta as HTMLMetaElement).content).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
    expect(pinch()).toBe(false);
  });
});
