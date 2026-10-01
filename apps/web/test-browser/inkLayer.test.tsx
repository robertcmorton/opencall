import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act, useRef, useState } from "react";
import type { InkMode, Stroke } from "@opencall/core";
import "../app/globals.css";
import { InkLayer } from "../components/InkLayer";

/** A three-row sheet, laid out for real, with the ink layer over it. */
function Sheet(props: { mode: InkMode; touchDraws?: boolean; onStroke: (rowId: string, s: Stroke) => void }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  return (
    <div ref={setContainer} style={{ position: "relative", width: 600 }}>
      <table style={{ width: 600, borderCollapse: "collapse" }}>
        <tbody ref={tbody}>
          {["r1", "r2", "r3"].map((id) => (
            <tr key={id} data-rowid={id} style={{ height: 40 }}>
              <td>{id}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <InkLayer
        container={container}
        tbody={tbody}
        doc={{}}
        mode={props.mode}
        colour="red"
        touchDraws={props.touchDraws}
        onStroke={props.onStroke}
        onErase={() => {}}
      />
    </div>
  );
}

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

const mount = async (ui: React.ReactNode) => {
  const el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  act(() => root!.render(ui));
  // Let the layer measure the rows it sits on.
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const svg = document.querySelector("svg.ink-layer") as SVGSVGElement | null;
  if (!svg) throw new Error("ink layer did not mount");
  return svg;
};

/** A line drawn across the middle of the second row, as real pointer events. */
const drawAcrossRow2 = (svg: SVGSVGElement, pointerType: "mouse" | "pen" | "touch") => {
  const box = svg.getBoundingClientRect();
  const y = box.top + 60; // row 2 spans 40–80
  const fire = (type: string, x: number) =>
    act(() => {
      svg.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType, clientX: box.left + x, clientY: y, buttons: type === "pointerup" ? 0 : 1 }));
    });
  fire("pointerdown", 50);
  for (let x = 60; x <= 300; x += 20) fire("pointermove", x);
  fire("pointerup", 300);
};

describe("ink on the sheet, in a real browser", () => {
  it("a pen stroke lands on the row it was drawn on, in that row's own coordinates", async () => {
    const onStroke = vi.fn();
    const svg = await mount(<Sheet mode="pen" onStroke={onStroke} />);
    drawAcrossRow2(svg, "pen");
    expect(onStroke).toHaveBeenCalledTimes(1);
    const [rowId, stroke] = onStroke.mock.calls[0]!;
    expect(rowId).toBe("r2");
    expect(stroke.c).toBe("red");
    // x as a fraction of the row's width, y in pixels from the row's top.
    const xs = stroke.p.filter((_: number, i: number) => i % 2 === 0);
    const ys = stroke.p.filter((_: number, i: number) => i % 2 === 1);
    expect(Math.min(...xs)).toBeCloseTo(50 / 600, 1);
    expect(Math.max(...xs)).toBeCloseTo(300 / 600, 1);
    for (const y of ys) expect(y).toBeCloseTo(20, 0);
  });

  it("a finger scrolls instead of drawing, unless finger drawing is on", async () => {
    const off = vi.fn();
    const svg = await mount(<Sheet mode="pen" onStroke={off} />);
    drawAcrossRow2(svg, "touch");
    expect(off).not.toHaveBeenCalled();
    act(() => root!.unmount());
    root = null;
    document.body.innerHTML = "";

    const on = vi.fn();
    const svg2 = await mount(<Sheet mode="pen" touchDraws onStroke={on} />);
    drawAcrossRow2(svg2, "touch");
    expect(on).toHaveBeenCalledTimes(1);
  });

  it("does nothing while ink is off", async () => {
    const onStroke = vi.fn();
    const svg = await mount(<Sheet mode="off" onStroke={onStroke} />);
    drawAcrossRow2(svg, "mouse");
    expect(onStroke).not.toHaveBeenCalled();
  });
});
