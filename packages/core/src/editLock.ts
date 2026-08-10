/**
 * One person edits a run sheet at a time.
 *
 * The document underneath is a CRDT, so two people typing at once does not
 * corrupt anything — it merges. That is not the problem this solves. The
 * problem is a run sheet being a shared statement of what is going to happen:
 * two producers quietly rewriting the same block half an hour before doors
 * both believe theirs is the sheet, and the crew gets whichever merged last.
 * A lock makes that visible instead of silent.
 *
 * Deliberately NOT a lock on the show. Calling a show is not editing — the
 * transport, the result chooser and clock-follow stay open to whoever is
 * running it, or a locked sheet would take the console down with it.
 *
 * The whole design turns on one question: what happens when the holder
 * vanishes. Laptops close, batteries die, venue wifi drops. A lock that
 * needed releasing by hand would strand sheets permanently, and a show that
 * cannot be edited because somebody went home is worse than two people
 * editing. So the lock is a HEARTBEAT, not a flag: it lives only as long as
 * somebody keeps saying they are still there.
 */

/** How often the holder tells the server it is still editing. */
export const EDIT_LOCK_HEARTBEAT_MS = 15_000;

/**
 * How long silence lasts before the lock is anyone's.
 *
 * Three missed heartbeats. Long enough to ride out a laptop sleeping for a
 * moment, a tunnel, or a browser throttling timers in a background tab; short
 * enough that somebody who genuinely walked away is not holding the sheet
 * hostage while a show is being prepared.
 */
export const EDIT_LOCK_STALE_MS = 45_000;

export interface EditLock {
  /** Who holds it, as a name to show. Null when nobody does. */
  heldBy: string | null;
  /** Their account, when they have one — so "is this me?" survives a rename. */
  heldByUserId: string | null;
  /** When they took it. */
  sinceMs: number | null;
  /** When they last said they were still there. */
  lastSeenMs: number | null;
}

/** Nobody is editing: either never taken, or gone quiet for long enough. */
export function lockIsFree(lock: EditLock, nowMs: number, staleMs = EDIT_LOCK_STALE_MS): boolean {
  if (lock.heldBy == null || lock.lastSeenMs == null) return true;
  return nowMs - lock.lastSeenMs > staleMs;
}

/**
 * Held, but the holder has gone quiet.
 *
 * Distinct from free, because the two want different words on screen. A free
 * sheet says nothing; a stale one says who had it and offers to take it —
 * which is the honest version of "they have probably closed their laptop".
 */
export function lockIsStale(lock: EditLock, nowMs: number, staleMs = EDIT_LOCK_STALE_MS): boolean {
  return lock.heldBy != null && lock.lastSeenMs != null && nowMs - lock.lastSeenMs > staleMs;
}

/**
 * May this person start editing?
 *
 * `token` is what the holder was given when they took it, and is the only
 * thing that proves a request comes from them rather than from a second tab
 * that merely knows their name. Re-claiming with a valid token is how a
 * heartbeat that arrived late still works.
 */
export function mayClaim(lock: EditLock, token: string | null, heldToken: string | null, nowMs: number): boolean {
  if (token != null && heldToken != null && token === heldToken) return true;
  return lockIsFree(lock, nowMs);
}

/** What the person looking at the sheet should be told. */
export type EditLockView =
  | { kind: "yours" }
  | { kind: "free" }
  | { kind: "held"; by: string; sinceMs: number | null }
  | { kind: "stale"; by: string; lastSeenMs: number };

export function describeLock(
  lock: EditLock,
  myToken: string | null,
  heldToken: string | null,
  nowMs: number,
  staleMs = EDIT_LOCK_STALE_MS,
): EditLockView {
  if (myToken != null && heldToken != null && myToken === heldToken) return { kind: "yours" };
  if (lock.heldBy == null || lock.lastSeenMs == null) return { kind: "free" };
  if (nowMs - lock.lastSeenMs > staleMs) return { kind: "stale", by: lock.heldBy, lastSeenMs: lock.lastSeenMs };
  return { kind: "held", by: lock.heldBy, sinceMs: lock.sinceMs };
}
