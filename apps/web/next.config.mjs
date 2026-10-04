import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The app version comes from the ROOT package.json (single source of truth,
// bumped per release batch alongside its CHANGELOG section); the build sha
// and date are stamped here at build time so every deployment can tell you
// exactly what it is (bottom-right of the dashboard).
const rootPkg = JSON.parse(readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"));

function buildSha() {
  if (process.env.RAILWAY_GIT_COMMIT_SHA) return process.env.RAILWAY_GIT_COMMIT_SHA.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

/**
 * Headers on every response, as Kitshare sets them. The Content Security
 * Policy is per request (it carries a nonce) and is set in proxy.ts.
 * - no framing anywhere (a run sheet inside somebody else's page is how a
 *   click gets tricked onto a Stop button);
 * - no MIME sniffing; referrers trimmed to the origin when leaving the site;
 * - camera, microphone, location and payments off; fullscreen and keeping
 *   the screen awake stay on, because the timer and prompter use them;
 * - HTTPS remembered for a year in production.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self), screen-wake-lock=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Nothing this app answers from /api is for a shared cache.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
  transpilePackages: ["@opencall/core", "@opencall/protocol", "@opencall/db"],
  env: {
    NEXT_PUBLIC_APP_VERSION: rootPkg.version,
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
    NEXT_PUBLIC_BUILD_DATE: new Date().toISOString().slice(0, 10),
  },
};

export default nextConfig;
