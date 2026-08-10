import { describe, expect, it } from "vitest";
import {
  EDIT_LOCK_STALE_MS,
  describeLock,
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
