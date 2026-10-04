import { describe, expect, it } from "vitest";
import { allowedOrigins, originAllowed } from "../src/origins";

describe("browser origins allowed to call the sync server", () => {
  it("is open when nothing is configured (local development)", () => {
    const none = allowedOrigins({});
    expect(none.size).toBe(0);
    expect(originAllowed("https://anything.example", none)).toBe(true);
  });
  it("takes PUBLIC_WEB_URL and WEB_ORIGINS as origins, ignoring paths and junk", () => {
    const set = allowedOrigins({ PUBLIC_WEB_URL: "https://app.example/admin/", WEB_ORIGINS: " https://staging.example , not a url," });
    expect([...set].sort()).toEqual(["https://app.example", "https://staging.example"]);
  });
  it("refuses other sites, allows ours, and allows non-browser callers (no Origin)", () => {
    const set = allowedOrigins({ PUBLIC_WEB_URL: "https://app.example" });
    expect(originAllowed("https://evil.example", set)).toBe(false);
    expect(originAllowed("https://app.example", set)).toBe(true);
    expect(originAllowed(undefined, set)).toBe(true);
  });
});
