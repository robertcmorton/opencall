import { describe, expect, it } from "vitest";
import { resolveTheme, THEME_BOOT_SCRIPT, THEME_KEY } from "../lib/theme";

/** Run the inline boot script against a pretend browser and report what it stamped. */
function boot(stored: string | null, prefersLight: boolean): { theme: string | null; bar: string } {
  const root = {
    attr: null as string | null,
    setAttribute(_: string, v: string) {
      this.attr = v;
    },
  };
  const meta = {
    bar: "#0b0d10",
    setAttribute(_: string, v: string) {
      this.bar = v;
    },
  };
  const fn = new Function("localStorage", "window", "document", THEME_BOOT_SCRIPT);
  fn(
    { getItem: (k: string) => (k === THEME_KEY ? stored : null) },
    { matchMedia: () => ({ matches: prefersLight }) },
    { documentElement: root, querySelector: () => meta },
  );
  return { theme: root.attr, bar: meta.bar };
}

describe("resolveTheme", () => {
  it("dark unless asked otherwise, and 'system' asks the machine", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
    expect(resolveTheme("nonsense", true)).toBe("dark");
  });
});

describe("the boot script agrees with resolveTheme", () => {
  for (const stored of [null, "dark", "light", "system", "nonsense"]) {
    for (const prefersLight of [true, false]) {
      it(`stored=${stored} prefersLight=${prefersLight}`, () => {
        const want = resolveTheme(stored, prefersLight);
        const got = boot(stored, prefersLight);
        expect(got.theme).toBe(want === "light" ? "light" : null);
        expect(got.bar).toBe(want === "light" ? "#f4f5f8" : "#0b0d10");
      });
    }
  }
  it("a browser with no storage stamps nothing and throws nothing", () => {
    const fn = new Function("localStorage", "window", "document", THEME_BOOT_SCRIPT);
    expect(() => fn(undefined, {}, { documentElement: {}, querySelector: () => null })).not.toThrow();
  });
});
