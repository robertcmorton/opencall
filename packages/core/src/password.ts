/**
 * What a new password must be — one rule, used by the server that enforces it
 * and the screens that explain it, so the two can never disagree.
 *
 * Applied when a password is SET (invitation, change, admin reset or create);
 * existing passwords keep working until they are next changed. It is the rule
 * Kitshare applies to its admins, because an OpenCall account can run a live
 * show: at least 12 characters, at most 200, at least 5 different characters,
 * and not containing the name part of the email address.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 200;

/** The problem with `password`, in words for the person choosing it, or null. */
export function passwordProblem(password: string, email?: string | null): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (new Set(password).size < 5) return "Use at least 5 different characters.";
  const local = (email ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "Do not use the name part of your email address in the password.";
  return null;
}

/** The rule as a hint under a password field. */
export const PASSWORD_HINT = `At least ${PASSWORD_MIN} characters, not your email name`;
