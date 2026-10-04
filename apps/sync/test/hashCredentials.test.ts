import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, ensureSchema, schema, type DbHandle } from "@opencall/db";
import { hashStoredCredentials, hashToken, resolveBearer } from "../src/auth";

let handle: DbHandle;
let dir: string;
const saved = process.env.ADMIN_TOKEN;
beforeAll(async () => {
  process.env.ADMIN_TOKEN = "test-admin-token-not-used-here";
  dir = mkdtempSync(join(tmpdir(), "oc-hash-"));
  handle = await createDb(undefined, dir);
  await ensureSchema(handle.db);
}, 60_000);
afterAll(async () => {
  process.env.ADMIN_TOKEN = saved;
  await handle?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("credentials stored before hashing", () => {
  it("are hashed in place at boot, and the originals still sign in", async () => {
    // As an older build stored them: the credential itself.
    await handle.db.insert(schema.teams).values({ id: "t1", name: "Legacy Co", slug: "legacy-co", companyToken: "co_legacyplaintext" });
    await handle.db.insert(schema.users).values({ id: "u1", name: "Legacy User", email: "legacy@example.com", accessToken: "usr_legacyplaintext" });
    await handle.db.insert(schema.authSessions).values({ id: "s1", userId: "u1", token: "ses_legacyplaintext", expiresAt: new Date(Date.now() + 86400_000), lastSeenAt: new Date() });

    await hashStoredCredentials(handle);
    await hashStoredCredentials(handle); // idempotent: a second boot changes nothing

    const team = await handle.db.query.teams.findFirst();
    const user = await handle.db.query.users.findFirst();
    const session = await handle.db.query.authSessions.findFirst();
    // Nothing in the database signs anybody in any more…
    expect(team?.companyToken).toBe(hashToken("co_legacyplaintext"));
    expect(user?.accessToken).toBe(hashToken("usr_legacyplaintext"));
    expect(session?.token).toBe(hashToken("ses_legacyplaintext"));
    // …but the credentials people are holding still do.
    expect((await resolveBearer(handle, "co_legacyplaintext"))?.kind).toBe("company");
    expect((await resolveBearer(handle, "usr_legacyplaintext"))?.kind).toBe("user");
    expect((await resolveBearer(handle, "ses_legacyplaintext"))?.kind).toBe("user");
    // And the stored hash itself is not a credential.
    expect(await resolveBearer(handle, hashToken("usr_legacyplaintext"))).toBeNull();
  });

  it("ends a session left unused for longer than the idle limit", async () => {
    await handle.db.insert(schema.authSessions).values({
      id: "s2",
      userId: "u1",
      token: hashToken("ses_idle"),
      expiresAt: new Date(Date.now() + 20 * 86400_000),
      lastSeenAt: new Date(Date.now() - 15 * 86400_000),
    });
    expect(await resolveBearer(handle, "ses_idle")).toBeNull();
    const row = await handle.db.execute(sql`SELECT revoked_at FROM auth_sessions WHERE id = 's2'`);
    const r = (Array.isArray(row) ? row : (row as { rows: unknown[] }).rows)[0] as { revoked_at: unknown };
    expect(r.revoked_at).not.toBeNull();
  });
});
