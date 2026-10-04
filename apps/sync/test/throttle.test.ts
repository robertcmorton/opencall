import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb, ensureSchema, type DbHandle } from "@opencall/db";
import { clearStartingWith, consume, peek, release } from "../src/throttle";

let handle: DbHandle;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "oc-throttle-"));
  handle = await createDb(undefined, dir);
  await ensureSchema(handle.db);
}, 60_000);
afterAll(async () => {
  await handle?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("attempt throttle", () => {
  it("allows up to the limit, then refuses", async () => {
    const lim = { max: 3, windowSec: 60 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push((await consume(handle, "t:a", lim)).ok);
    expect(results).toEqual([true, true, true, false, false]);
  });
  it("counts parallel attempts in full — none slip past the limit", async () => {
    const lim = { max: 5, windowSec: 60 };
    const all = await Promise.all(Array.from({ length: 12 }, () => consume(handle, "t:parallel", lim)));
    expect(all.filter((r) => r.ok).length).toBe(5);
  });
  it("gives an attempt back on release, so only failures accumulate", async () => {
    const lim = { max: 2, windowSec: 60 };
    await consume(handle, "t:rel", lim);
    await release(handle, "t:rel");
    await consume(handle, "t:rel", lim);
    expect((await consume(handle, "t:rel", lim)).ok).toBe(true);
    expect(await peek(handle, "t:rel", 60)).toBe(2);
  });
  it("forgets counters by prefix", async () => {
    await consume(handle, "login:email:x@example.com", { max: 1, windowSec: 60 });
    await clearStartingWith(handle, "login:email:x@");
    expect(await peek(handle, "login:email:x@example.com", 60)).toBe(0);
  });
  it("says how long to wait", async () => {
    const r = await consume(handle, "t:wait", { max: 0, windowSec: 600 });
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(590);
  });
});
