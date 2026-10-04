import { describe, expect, it } from "vitest";
import { safeNext, signInPath } from "../lib/session";

describe("the way back after signing in", () => {
  it("remembers a page inside the site, with its query string", () => {
    expect(signInPath("/admin/users", "")).toBe("/?next=%2Fadmin%2Fusers");
    expect(signInPath("/show/01ABC", "?code=DEV123")).toBe("/?next=%2Fshow%2F01ABC%3Fcode%3DDEV123");
  });

  it("does not bother remembering the sign-in screen or the dashboard root", () => {
    expect(signInPath("/", "")).toBe("/");
    expect(signInPath("/admin", "")).toBe("/");
    expect(signInPath(null)).toBe("/");
  });

  it("refuses to send anyone off the site", () => {
    expect(safeNext("//evil.example/phish")).toBeNull();
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("/admin/users")).toBe("/admin/users");
    expect(signInPath("//evil.example", "")).toBe("/");
  });

  it("refuses the tricks a plain starts-with-slash check let through", () => {
    // Browsers read a backslash as a slash: this is //evil.example.
    expect(safeNext("/\\evil.example")).toBeNull();
    expect(safeNext("/\\/evil.example")).toBeNull();
    // Control characters (a tab or newline is stripped by URL parsers).
    expect(safeNext("/\t/evil.example")).toBeNull();
    expect(safeNext("/admin\n")).toBeNull();
    // Ordinary paths with queries survive.
    expect(safeNext("/show/01ABC?code=X7KQ2M")).toBe("/show/01ABC?code=X7KQ2M");
  });
});
