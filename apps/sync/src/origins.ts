/**
 * Which websites may call this server from a browser.
 *
 * The web app and this server are separate hosts, so the browser asks before
 * every cross-site call. Until now the answer was "anyone": harmless for
 * credentials (they travel in a header a foreign page cannot read), but there
 * is no reason for another site's script to talk to this API or open its
 * sockets at all. The allowlist is PUBLIC_WEB_URL (already set for invitation
 * links) plus anything in WEB_ORIGINS (comma-separated). With neither set —
 * local development — every origin is allowed, as before.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const out = new Set<string>();
  for (const raw of [env.PUBLIC_WEB_URL, ...(env.WEB_ORIGINS ?? "").split(",")]) {
    const v = raw?.trim();
    if (!v) continue;
    try {
      out.add(new URL(v).origin);
    } catch {
      /* not a URL: ignored */
    }
  }
  return out;
}

/** May a request carrying this Origin header proceed? No Origin means not a browser page. */
export function originAllowed(origin: string | undefined, allowed: Set<string>): boolean {
  if (allowed.size === 0 || !origin) return true;
  return allowed.has(origin.replace(/\/$/, ""));
}
