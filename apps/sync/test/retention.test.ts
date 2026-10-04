import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, ensureSchema, type DbHandle } from "@opencall/db";
import { applyRetention } from "../src/retention";

let handle: DbHandle;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "oc-ret-"));
  handle = await createDb(undefined, dir);
  await ensureSchema(handle.db);
}, 60_000);
afterAll(async () => {
  await handle?.close();
  rmSync(dir, { recursive: true, force: true });
});

const count = async (q: ReturnType<typeof sql>) => {
  const r = await handle.db.execute(q);
  const rows = Array.isArray(r) ? r : (r as unknown as { rows: { n: number }[] }).rows;
  return Number((rows[0] as { n: number }).n);
};

describe("retention", () => {
  it("removes only what has aged out", async () => {
    await handle.db.execute(sql`INSERT INTO users (id, email, name) VALUES ('u', 'u@example.com', 'U')`);
    await handle.db.execute(sql`INSERT INTO throttles (key, count, window_start, last_at) VALUES ('old', 3, now() - interval '5 days', now() - interval '5 days'), ('new', 1, now(), now())`);
    await handle.db.execute(sql`INSERT INTO auth_sessions (id, user_id, token, expires_at, revoked_at) VALUES
      ('s-old', 'u', 'h:1', now() - interval '60 days', NULL),
      ('s-revoked-old', 'u', 'h:2', now() + interval '1 day', now() - interval '40 days'),
      ('s-live', 'u', 'h:3', now() + interval '10 days', NULL)`);
    await handle.db.execute(sql`INSERT INTO audit_log (id, created_at, action) VALUES
      ('a1', now() - interval '100 days', 'login.failed'),
      ('a2', now() - interval '100 days', 'user.deleted'),
      ('a3', now() - interval '800 days', 'user.deleted'),
      ('a4', now(), 'login.failed')`);
    await applyRetention(handle);
    expect(await count(sql`SELECT count(*)::int AS n FROM throttles`)).toBe(1);
    expect(await count(sql`SELECT count(*)::int AS n FROM auth_sessions`)).toBe(1);
    // A 100-day-old failed sign-in goes; a 100-day-old deletion stays; a 2-year-plus one goes.
    expect(await count(sql`SELECT count(*)::int AS n FROM audit_log WHERE id IN ('a2', 'a4')`)).toBe(2);
    expect(await count(sql`SELECT count(*)::int AS n FROM audit_log`)).toBe(2);
  });
});
