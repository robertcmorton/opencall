import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import qrcode from "qrcode-generator";
import { QrCode } from "../components/QrCode";

/** The view-only link's QR code (21 Oct). */
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("QR code", () => {
  it("draws the code's own grid, dark on white, with a quiet margin of four", () => {
    const url = "https://example.test/view/01M5DZNJMEHNSSGSQ78K15R4KV?code=ABC123";
    const el = document.createElement("div");
    document.body.appendChild(el);
    root = createRoot(el);
    act(() => root!.render(<QrCode value={url} label="QR code" />));
    const svg = el.querySelector("svg")!;
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    expect(svg.getAttribute("viewBox")).toBe(`0 0 ${n + 8} ${n + 8}`);
    expect(svg.querySelector("rect")!.getAttribute("fill")).toBe("#fff");
    // One square per dark module, each offset by the margin.
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
    expect((svg.querySelector("path")!.getAttribute("d")!.match(/M/g) ?? []).length).toBe(dark);
    expect(svg.getAttribute("aria-label")).toBe("QR code");
  });
});
