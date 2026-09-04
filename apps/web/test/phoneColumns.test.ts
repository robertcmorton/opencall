import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COL_W_PHONE, PHONE_MEDIA } from "../lib/phoneColumns";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

/** The pixel width a forced narrow-screen rule gives `selector`, or null. */
function forced(selector: string): number | null {
  const at = css.indexOf(`@media ${PHONE_MEDIA}`);
  expect(at, "the phone media block exists with exactly this query").toBeGreaterThan(-1);
  const block = css.slice(at);
  const m = new RegExp(selector.replace(/[.[\]"()]/g, (c) => `\\${c}`) + String.raw`\s*\{[^}]*?width:\s*(\d+)px !important`).exec(block);
  return m ? Number(m[1]) : null;
}

describe("the phone layout's widths are the stylesheet's widths", () => {
  it("row number, time, duration and role columns", () => {
    expect(forced('th[data-colkey="rownum"]')).toBe(COL_W_PHONE.rownum);
    expect(forced('th[data-colkey="start"]')).toBe(COL_W_PHONE.time);
    expect(forced('th[data-colkey="duration"]')).toBe(COL_W_PHONE.dur);
    expect(forced("th.col-role")).toBe(COL_W_PHONE.role);
  });

  it("does not try to hand the remainder to the item column from CSS — Chrome ignores it", () => {
    expect(css).not.toMatch(/data-colkey="title"\]\s*\{[^}]*width:\s*auto/);
  });
});
