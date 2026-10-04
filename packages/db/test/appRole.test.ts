import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { ensureSchema } from "../src/migrate";
import * as schema from "../src/schema";
import { roleStatements } from "../scripts/setup-app-role";

/**
 * The restricted login can do the app's work and nothing more. Checked on an
 * embedded Postgres by switching to the role after setting it up.
 */
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  await ensureSchema(drizzle(pg, { schema }) as never);
  // PGlite logs in as a superuser; the verifier is irrelevant here.
  for (const s of roleStatements("opencall_app", "md5ignored", "postgres")) await pg.exec(s);
  await pg.exec("SET ROLE opencall_app");
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

const refused = async (sql: string) => {
  try {
    await pg.exec(sql);
    return false;
  } catch {
    return true;
  }
};

describe("restricted database role", () => {
  it("reads and writes rows", async () => {
    await pg.exec(`INSERT INTO throttles (key, count) VALUES ('role-test', 1)`);
    const r = await pg.query<{ count: number }>(`SELECT count FROM throttles WHERE key = 'role-test'`);
    expect(r.rows[0]?.count).toBe(1);
    await pg.exec(`UPDATE throttles SET count = 2 WHERE key = 'role-test'`);
    await pg.exec(`DELETE FROM throttles WHERE key = 'role-test'`);
  });
  it("cannot create, alter, drop or truncate", async () => {
    expect(await refused("CREATE TABLE evil (x int)")).toBe(true);
    expect(await refused("ALTER TABLE users ADD COLUMN evil text")).toBe(true);
    expect(await refused("DROP TABLE throttles")).toBe(true);
    expect(await refused("TRUNCATE users")).toBe(true);
  });
  it("cannot read files off the server or run programs", async () => {
    expect(await refused("SELECT pg_read_file('/etc/passwd')")).toBe(true);
    expect(await refused("COPY users TO PROGRAM 'cat'")).toBe(true);
  });
});
