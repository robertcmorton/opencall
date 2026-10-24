import { NextResponse, type NextRequest } from "next/server";
import { TRAP_PATH } from "@opencall/core/trap";
import { contentSecurityPolicy, syncOrigins } from "./lib/csp";

/**
 * Issues each page request a fresh nonce and the policy that names it.
 *
 * The nonce goes on the REQUEST too: Next reads the policy from there to put
 * the nonce on its own scripts, and the root layout reads `x-nonce` for the
 * one inline script of ours (the theme boot). Static files and images are not
 * pages and are skipped.
 */
export function proxy(request: NextRequest) {
  // The trap (24 Oct 2026): a probe for a weakness gets "not found", and the
  // sync server — which keeps the record — is told, with the prober's address.
  if (TRAP_PATH.test(request.nextUrl.pathname)) {
    const base = process.env.SYNC_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SYNC_HTTP_URL;
    if (base)
      void fetch(base + request.nextUrl.pathname, {
        headers: { "x-real-ip": request.headers.get("x-real-ip") ?? "", "user-agent": request.headers.get("user-agent") ?? "" },
        signal: AbortSignal.timeout(3000),
      }).catch(() => undefined);
    return new NextResponse("Not found", { status: 404 });
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV !== "production";
  const https = request.headers.get("x-forwarded-proto") === "https" || request.nextUrl.protocol === "https:";
  const policy = contentSecurityPolicy({
    nonce,
    dev,
    https,
    connect: syncOrigins([
      process.env.NEXT_PUBLIC_SYNC_HTTP_URL,
      process.env.NEXT_PUBLIC_SYNC_WS_URL,
      process.env.NEXT_PUBLIC_DOC_WS_URL,
      // The local defaults the client falls back to (lib/api.ts, showChannel, useRundownDoc).
      ...(dev ? ["http://localhost:8787", "ws://localhost:8787"] : []),
    ]),
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", policy);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|icon-.*\\.png).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
