import { describe, expect, it } from "vitest";
import {
  EDIT_LOCK_STALE_MS,
  describeLock,
  heldByMe,
  lockIsFree,
  lockIsStale,
  mayClaim,
  type EditLock,
} from "../src/editLock";

const NOW = 1_000_000;
const held = (lastSeenMs: number): EditLock => ({
  heldBy: "Sam Rivers",
  heldByUserId: "u1",
  sinceMs: lastSeenMs - 60_000,
  lastSeenMs,
});
const nobody: EditLock = { heldBy: null, heldByUserId: null, sinceMs: null, lastSeenMs: null };

describe("who may edit the sheet", () => {
  it("lets anyone in when nobody has it", () => {
    expect(lockIsFree(nobody, NOW)).toBe(true);
    expect(mayClaim(nobody, null, null, NOW)).toBe(true);
  });

  it("keeps everyone else out while the holder is still there", () => {
    const lock = held(NOW - 5_000);
    expect(lockIsFree(lock, NOW)).toBe(false);
    expect(mayClaim(lock, null, "tok", NOW)).toBe(false);
    expect(mayClaim(lock, "someone-elses-token", "tok", NOW)).toBe(false);
  });

  it("lets the holder carry on with their own token", () => {
    // A heartbeat that arrives late is still the holder saying they are there.
    expect(mayClaim(held(NOW - 5_000), "tok", "tok", NOW)).toBe(true);
  });

  /**
   * The case the whole design turns on: somebody shuts their laptop.
   *
   * A lock that needed releasing by hand would strand the sheet, and a show
   * that cannot be edited because a producer went home is worse than two
   * people editing.
   */
  it("frees the sheet when the holder goes quiet", () => {
    const gone = held(NOW - EDIT_LOCK_STALE_MS - 1);
    expect(lockIsFree(gone, NOW)).toBe(true);
    expect(mayClaim(gone, null, "tok", NOW)).toBe(true);
  });

  it("holds on right up to the deadline", () => {
    // Exactly at the limit is still theirs — a laptop asleep for one beat
    // must not lose the sheet.
    const edge = held(NOW - EDIT_LOCK_STALE_MS);
    expect(lockIsFree(edge, NOW)).toBe(false);
    expect(lockIsStale(edge, NOW)).toBe(false);
  });

  it("calls a quiet holder stale, not absent", () => {
    // Different words on screen: free says nothing, stale names who had it.
    const gone = held(NOW - EDIT_LOCK_STALE_MS - 1);
    expect(lockIsStale(gone, NOW)).toBe(true);
    expect(lockIsStale(nobody, NOW)).toBe(false);
  });
});

describe("what the person looking at it is told", () => {
  it("says it is theirs when the token matches", () => {
    expect(describeLock(held(NOW), "tok", "tok", NOW)).toEqual({ kind: "yours" });
  });

  it("names the holder while they are there", () => {
    const lock = held(NOW - 1_000);
    expect(describeLock(lock, null, "tok", NOW)).toMatchObject({ kind: "held", by: "Sam Rivers" });
  });

  it("offers a stale lock for the taking, and says who had it", () => {
    const lock = held(NOW - EDIT_LOCK_STALE_MS - 1);
    expect(describeLock(lock, null, "tok", NOW)).toMatchObject({ kind: "stale", by: "Sam Rivers" });
  });

  it("says nothing at all when the sheet is free", () => {
    expect(describeLock(nobody, null, null, NOW)).toEqual({ kind: "free" });
  });

  it("does not mistake a second tab for the holder", () => {
    // Knowing the holder's NAME is not holding the lock; only the token is.
    expect(describeLock(held(NOW), "another-tab", "tok", NOW)).toMatchObject({ kind: "held" });
  });
});

/**
 * You are not somebody else.
 *
 * Shipped and reported within the hour: "it's saying somebody is editing this
 * sheet when I am the one editing it." Each tab mints its own token, so one
 * person with the console on one screen and the sheet on another — or the
 * same tab after a reload — looked like two people and was locked out of
 * their own sheet.
 *
 * The lock exists to stop two PEOPLE editing. The token proves a request came
 * from a particular tab; identity is what decides whether it is your sheet.
 */
describe("one person, several windows", () => {
  it("does not treat your own second tab as a stranger", () => {
    // The bug: each tab has its own token, so the console and the editor open
    // side by side locked the same person out of their own sheet.
    expect(heldByMe("user:u1", "user:u1", held(NOW - 5_000), NOW)).toBe(true);
  });

  it("still keeps a genuinely different person out", () => {
    expect(heldByMe("user:u1", "user:u2", held(NOW - 5_000), NOW)).toBe(false);
  });

  it("does not call a stale lock of your own yours", () => {
    // It is free — anyone may take it — and pretending otherwise would hide
    // that from the person looking at it.
    expect(heldByMe("user:u1", "user:u1", held(NOW - EDIT_LOCK_STALE_MS - 1), NOW)).toBe(false);
  });

  it("says nothing is yours when nobody holds it", () => {
    expect(heldByMe(null, "user:u1", nobody, NOW)).toBe(false);
  });

  /**
   * The token still identifies a TAB, which is what a heartbeat needs: two of
   * your own tabs must not each take the other's heartbeat for their own.
   */
  it("keeps the token meaningful for heartbeats", () => {
    const lock = held(NOW - 5_000);
    expect(mayClaim(lock, "tab-one", "tab-one", NOW)).toBe(true);
    expect(mayClaim(lock, "tab-two", "tab-one", NOW)).toBe(false);
  });
});
