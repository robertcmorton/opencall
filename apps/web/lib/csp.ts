/**
 * The Content Security Policy: which scripts, connections and resources a
 * page may use. The point is that injected HTML (a crafted cell, a tampered
 * dependency) cannot run script: only scripts carrying this request's nonce
 * run, and what they load is trusted through 'strict-dynamic'.
 *
 * Built per request by proxy.ts, which issues the nonce. Same shape as
 * Kitshare's, adjusted for what OpenCall talks to: the sync server (HTTP and
 * two WebSockets), the PDF reader's worker, and embedded images.
 */
export interface CspOptions {
  nonce: string;
  dev: boolean;
  https: boolean;
  /** Origins the browser connects to besides this site (the sync server). */
  connect: string[];
}

export function contentSecurityPolicy({ nonce, dev, https, connect }: CspOptions): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next's own scripts carry the nonce; 'strict-dynamic' lets them load the
    // chunks they need. The PDF reader may compile WebAssembly. Development
    // needs eval for hot reloading, and nowhere else does.
    "script-src": ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'wasm-unsafe-eval'", ...(dev ? ["'unsafe-eval'"] : [])],
    // React and the sheet set inline styles everywhere; style injection cannot run script.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    // In development a phone on the same network reaches the dev sync server
    // at the computer's own address, so any local origin is allowed there.
    "connect-src": ["'self'", ...connect, ...(dev ? ["http:", "ws:", "https:", "wss:"] : [])],
    "worker-src": ["'self'", "blob:"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
    "manifest-src": ["'self'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (https && !dev) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** The origins (scheme://host[:port]) of the configured sync URLs. */
export function syncOrigins(urls: (string | undefined)[]): string[] {
  const out = new Set<string>();
  for (const u of urls) {
    if (!u) continue;
    try {
      const url = new URL(u);
      out.add(`${url.protocol}//${url.host}`);
    } catch {
      /* not a URL: nothing to allow */
    }
  }
  return [...out];
}
