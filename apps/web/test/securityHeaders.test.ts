import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, syncOrigins } from "../lib/csp";
import config from "../next.config.mjs";

// The config is plain .mjs; give the test the two members it reads.
const nextConfig = config as unknown as { headers: () => Promise<any[]>; poweredByHeader: boolean };

const directive = (policy: string, name: string) =>
  policy.split(";").map((p) => p.trim()).find((p) => p.startsWith(name + " "))?.slice(name.length + 1).split(" ") ?? [];

describe("content security policy", () => {
  const prod = contentSecurityPolicy({ nonce: "abc123", dev: false, https: true, connect: ["https://sync.example", "wss://sync.example"] });
  const dev = contentSecurityPolicy({ nonce: "abc123", dev: true, https: false, connect: [] });

  it("runs only scripts carrying this request's nonce — never inline script or eval in production", () => {
    const script = directive(prod, "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });
  it("allows eval only in development (hot reloading needs it)", () => {
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });
  it("connects only to this site and the sync server in production", () => {
    expect(directive(prod, "connect-src")).toEqual(["'self'", "https://sync.example", "wss://sync.example"]);
  });
  it("cannot be framed, embeds nothing, and posts forms nowhere else", () => {
    expect(directive(prod, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(prod, "object-src")).toEqual(["'none'"]);
    expect(directive(prod, "form-action")).toEqual(["'self'"]);
    expect(directive(prod, "base-uri")).toEqual(["'self'"]);
    expect(prod).toContain("upgrade-insecure-requests");
  });
  it("reduces sync URLs to their origins", () => {
    expect(syncOrigins(["https://sync.example/doc", "wss://sync.example", undefined, "nope"])).toEqual(["https://sync.example", "wss://sync.example"]);
  });
});

describe("static security headers", () => {
  it("are set on every path", async () => {
    const rules = await nextConfig.headers();
    const all = rules.find((r: { source: string }) => r.source === "/:path*");
    const names = Object.fromEntries(all.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(names["X-Frame-Options"]).toBe("DENY");
    expect(names["X-Content-Type-Options"]).toBe("nosniff");
    expect(names["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(names["Permissions-Policy"]).toMatch(/camera=\(\)/);
    expect(names["Permissions-Policy"]).toMatch(/screen-wake-lock=\(self\)/);
    expect(names["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(nextConfig.poweredByHeader).toBe(false);
  });
  it("keeps /api answers out of shared caches", async () => {
    const rules = await nextConfig.headers();
    const api = rules.find((r: { source: string }) => r.source === "/api/:path*");
    expect(api.headers).toContainEqual({ key: "Cache-Control", value: "no-store" });
  });
});
