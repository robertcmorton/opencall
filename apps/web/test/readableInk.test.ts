import { describe, expect, it } from "vitest";
import { ROLE_COLORS, PROMPTER_COLOR } from "@opencall/core";
import { blend, contrast, LIGHT_CHIP_ALPHA, readableInk } from "../lib/readableInk";

const rgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number];
};

describe("role colours on the light theme", () => {
  for (const colour of [...ROLE_COLORS, PROMPTER_COLOR]) {
    it(`${colour} reads at AA (4.5:1) on its own chip and on a tinted row`, () => {
      const ink = rgb(readableInk(colour));
      const chip = blend(rgb(colour), LIGHT_CHIP_ALPHA, [255, 255, 255]);
      expect(contrast(ink, chip)).toBeGreaterThanOrEqual(4.5);
      // The live row is tinted blue (#eaf2ff); a chip on it must still read.
      const onLiveRow = blend(rgb(colour), LIGHT_CHIP_ALPHA, rgb("#eaf2ff"));
      expect(contrast(ink, onLiveRow)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("leaves a colour that already reads well alone", () => {
    expect(readableInk("#1f2129")).toBe("#1f2129");
  });

  it("passes through anything that is not a #rrggbb colour", () => {
    expect(readableInk("tomato")).toBe("tomato");
  });
});
