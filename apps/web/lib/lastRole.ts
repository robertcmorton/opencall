/**
 * The role this browser last saw for its sign-in (23 Oct).
 *
 * Pages that show an administrator-only list — Users, Account activity — used
 * to ask "who am I?" and only then ask for the list, two round trips in a row
 * before anything appeared: 2.2–2.5 s from Sydney. With this they ask for both
 * at once when the last answer was "administrator".
 *
 * A hint, never a permission: the server decides who sees what, and a stale
 * guess costs one refused request. Written by `api.me()`.
 */
const KEY = "oc:lastrole";

export const lastRole = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const rememberRole = (role: string | null | undefined): void => {
  try {
    if (role) localStorage.setItem(KEY, role);
    else localStorage.removeItem(KEY);
  } catch {
    /* no storage: every page simply asks in turn, as before */
  }
};

/**
 * A request started before anything is ready to use its answer. Its failure
 * is dealt with by whoever reads it; until then it must not count as an
 * unhandled rejection, which the error reporter would journal.
 */
export const early = <T,>(p: Promise<T>): Promise<T> => {
  p.catch(() => undefined);
  return p;
};
