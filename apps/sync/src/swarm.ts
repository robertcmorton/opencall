import type { DbHandle } from "@opencall/db";
import { consume, peek } from "./throttle.ts";
import { notify, quarterHour } from "./notices.ts";

/**
 * Guessing from many addresses at once (24 Oct 2026).
 *
 * Every other limit counts per address, and a swarm — thousands of machines,
 * each trying a little — never trips one. So wrong codes and wrong passwords
 * are ALSO counted across everyone together. Past a threshold in a
 * quarter-hour the per-address allowance drops from 30 wrong codes to 3 (and
 * from 20 sign-in tries to 3), and administrators are alerted.
 *
 * Not a cut-off for everyone: an address that has made no wrong guesses still
 * gets its first tries, so the crew opening their links during an attack get
 * in. What it takes away is volume — a swarm's thousands of addresses each
 * get three guesses a quarter-hour instead of thirty.
 *
 * The thresholds sit far above anything ordinary: a show's whole crew
 * mistyping a code a few times is a dozen misses, not a hundred and fifty.
 */
export const SWARM = {
  windowSec: 15 * 60,
  codeMisses: 150,
  loginFailures: 100,
  tightPerIp: 3,
} as const;

const CODE_KEY = "swarm:code-misses";
const LOGIN_KEY = "swarm:login-failures";

/** The per-address allowance for code guesses right now. */
export async function codeGuessLimit(handle: DbHandle, normal: number): Promise<number> {
  return (await peek(handle, CODE_KEY, SWARM.windowSec)) >= SWARM.codeMisses ? Math.min(normal, SWARM.tightPerIp) : normal;
}

/** The per-address allowance for sign-in tries right now. */
export async function loginTryLimit(handle: DbHandle, normal: number): Promise<number> {
  return (await peek(handle, LOGIN_KEY, SWARM.windowSec)) >= SWARM.loginFailures ? Math.min(normal, SWARM.tightPerIp) : normal;
}

/** One wrong code, from anywhere. Alerts once, as the threshold is crossed. */
export async function noteCodeMiss(handle: DbHandle): Promise<void> {
  const c = await consume(handle, CODE_KEY, { max: Number.MAX_SAFE_INTEGER, windowSec: SWARM.windowSec });
  if (c.count === SWARM.codeMisses)
    notify(handle, {
      kind: "swarm.codes",
      urgent: true,
      title: `${SWARM.codeMisses} wrong view-only codes in a quarter of an hour, from many addresses`,
      body: "Someone may be trying to guess the codes on your view-only links. Each address now gets only 3 wrong tries a quarter-hour; links that work are unaffected. If it keeps up, switch off links you don't need, or use Lockdown.",
      key: `swarm.codes:${quarterHour()}`,
    });
}

/** One wrong password, from anywhere. Alerts once, as the threshold is crossed. */
export async function noteLoginFailure(handle: DbHandle): Promise<void> {
  const c = await consume(handle, LOGIN_KEY, { max: Number.MAX_SAFE_INTEGER, windowSec: SWARM.windowSec });
  if (c.count === SWARM.loginFailures)
    notify(handle, {
      kind: "swarm.logins",
      urgent: true,
      title: `${SWARM.loginFailures} wrong passwords in a quarter of an hour, across all accounts`,
      body: "Someone may be trying passwords against many accounts at once. Each address now gets only 3 tries a quarter-hour. Make sure everyone's password is long and not used anywhere else.",
      key: `swarm.logins:${quarterHour()}`,
    });
}
