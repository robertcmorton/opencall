import { describe, expect, it } from "vitest";
import { pickTeamLogos, type PlacedImage } from "../lib/teamLogos";

/** Finding the two team logos on an imported PDF (20 Oct). Shapes taken from real sheets. */
const at = (id: string, x: number, y: number, w: number, h: number, page = 0): PlacedImage => ({ id, page, x, y, w, h });
const A4_WIDE = 842;

describe("finding the team logos", () => {
  it("picks the pair either side of the title, left as home", () => {
    const pair = pickTeamLogos([at("b", 591, 469, 55, 58), at("a", 170, 468, 45, 58)], 3, A4_WIDE);
    expect(pair?.home.id).toBe("a");
    expect(pair?.away.id).toBe("b");
  });
  it("counts a header that repeats them on every page", () => {
    const imgs = [0, 1, 2].flatMap((p) => [at("a", 65, 547, 47, 44, p), at("b", 677, 544, 47, 48, p)]);
    expect(pickTeamLogos(imgs, 3, A4_WIDE)?.away.id).toBe("b");
  });
  it("ignores the same picture drawn on both sides — one club's own branding, not a fixture", () => {
    expect(pickTeamLogos([at("club", 185, 497, 47, 45), at("club", 577, 497, 47, 45)], 16, A4_WIDE)).toBeNull();
  });
  it("ignores a wide banner and icons repeated on every row", () => {
    const icons = Array.from({ length: 50 }, (_, i) => at("icon", 30, 700 - i * 12, 10, 10, Math.floor(i / 20)));
    const imgs = [at("banner", 0, 760, 600, 180), ...icons, at("icon2", 400, 700, 10, 10)];
    expect(pickTeamLogos(imgs, 3, A4_WIDE)).toBeNull();
  });
  it("leaves a single picture alone", () => {
    expect(pickTeamLogos([at("one", 526, 712, 45, 69)], 8, 595)).toBeNull();
  });
  it("does not pair two pictures of very different sizes, or stacked ones", () => {
    expect(pickTeamLogos([at("big", 100, 400, 200, 200), at("small", 500, 450, 40, 40)], 1, A4_WIDE)).toBeNull();
    expect(pickTeamLogos([at("top", 100, 500, 50, 50), at("under", 100, 400, 50, 50)], 1, A4_WIDE)).toBeNull();
  });
  it("only looks at the first page", () => {
    expect(pickTeamLogos([at("a", 100, 500, 50, 50, 1), at("b", 600, 500, 50, 50, 1)], 2, A4_WIDE)).toBeNull();
  });
});
