import { api, getAdminToken, setAdminToken } from "./api";

/**
 * Where a signed-out person goes, and how they get back.
 *
 * There is ONE sign-in screen: the landing page, join code or token on top
 * and the account form beneath it. The dashboard used to carry a second one
 * of its own, laid out the other way round, shown inline whenever the
 * session had died — so the same person saw two different sign-in screens
 * depending on which page they were on when it happened. Now every surface
 * that finds no session sends them to the landing page with `?next=` set to
 * where they were, and the landing page brings them back once they are in.
 */

/**
 * Only same-site paths are honoured as a return address. `//host` would
 * leave the site entirely, so it is rejected, as is anything absolute.
 */
/**
 * A path on THIS site to go to after signing in, or null.
 *
 * Starting with "/" and not "//" was not enough: browsers read a backslash as
 * a slash, so "/\\evil.example" went to another site, and control characters
 * can split what a browser and a check each think the URL is. Now anything
 * with a backslash or a control character is refused, and the value has to
 * resolve to this same origin.
 */
export const safeNext = (value: string | null | undefined): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  try {
    const base = "http://opencall.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return null;
  } catch {
    return null;
  }
  return value;
};

/**
 * The sign-in screen, remembering `pathname` + `search` as the way back.
 * The landing page and the dashboard root are not worth remembering: the
 * landing page IS the sign-in screen, and the dashboard is where a sign-in
 * goes by default anyway.
 */
export function signInPath(pathname: string | null | undefined, search = ""): string {
  const here = safeNext(pathname ? `${pathname}${search}` : null);
  if (!here || here === "/" || here === "/admin") return "/";
  return `/?next=${encodeURIComponent(here)}`;
}

type Router = { replace: (href: string) => void };

/**
 * The session is dead: forget the credential that no longer works, and go
 * to the sign-in screen with the way back. Forgetting it matters — a stale
 * session token sent on every request is refused on every request, and the
 * landing page would otherwise read it as "signed in" and bounce.
 */
export function sendToSignIn(router: Router): void {
  setAdminToken(null);
  router.replace(signInPath(window.location.pathname, window.location.search));
}

/**
 * The surfaces that require a session. A 401 elsewhere — a follower on a
 * show page asking for something the code does not allow — is a refusal,
 * not a sign-out, and must not throw them off the sheet.
 */
const REQUIRES_SESSION = /^\/(admin|account|oauth)(\/|$)/;

let checking: Promise<void> | null = null;

/**
 * Called by the API client on any 401. Not every 401 is a dead session: a
 * company signed in with its own token is refused by admin-only reads, and
 * that is a permissions answer, not a sign-out. So the session is checked
 * before anyone is moved — `/me` answers a null role only when the credential
 * itself is no longer good. One check in flight at a time, because a page
 * that has just lost its session fires several refused requests at once.
 */
export function onUnauthorized(path: string): void {
  if (typeof window === "undefined") return;
  if (path === "/me" || checking) return;
  if (!REQUIRES_SESSION.test(window.location.pathname)) return;
  if (getAdminToken() == null) return; // never signed in here: the page's own gate handles it
  checking = api
    .me()
    .then((me) => {
      if (me.role == null) sendToSignIn({ replace: (href) => window.location.replace(href) });
    })
    .catch(() => undefined)
    .finally(() => {
      checking = null;
    });
}
