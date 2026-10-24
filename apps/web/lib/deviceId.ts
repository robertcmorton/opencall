/**
 * A random id this browser keeps for itself (24 Oct 2026), sent with every
 * request and with the show link, so the activity trail can follow one
 * device's steps — "the iPad on the camera platform dropped at 7:42, then
 * reopened the timer" — without knowing anything else about it.
 *
 * It is not a sign-in and grants nothing: it only groups what one browser did.
 * Clearing the site's data makes a new one.
 */
let cached: string | null = null;

export function deviceId(): string | null {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem("oc:device");
    if (stored && /^[A-Za-z0-9_-]{8,40}$/.test(stored)) return (cached = stored);
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    const fresh = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    localStorage.setItem("oc:device", fresh);
    return (cached = fresh);
  } catch {
    return null; // private mode, storage off, or no browser at all
  }
}

/**
 * A page address fit for the record: never the query (that is where a view
 * link's code travels) and never the secret in a guest pass or invitation
 * address.
 */
export const safePath = (pathname: string): string => pathname.replace(/^\/(guest|invite)\/[^/]+/, "/$1/…").slice(0, 120);
