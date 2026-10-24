import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, ensureSchema, schema, type DbHandle } from "@opencall/db";
import { onAdminCode, onFailedSignIn, onSheetOpened, onSignIn, onTrap } from "../src/watch";
import { usePlaceTable } from "../src/place";

/** What an administrator is told about (24 Oct). */
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1";
const places: Record<string, [string, string, string]> = { "1.1.1": ["Sydney", "Australia", "AU"], "5.5.5": ["London", "United Kingdom", "GB"] };
const fake = {
  get: (ip: string) => {
    const p = places[ip.split(".").slice(0, 3).join(".")];
    return p ? { city: { names: { en: p[0] } }, country: { names: { en: p[1] }, iso_code: p[2] } } : null;
  },
};

let dir = "";
let handle: DbHandle;
const settle = () => new Promise((r) => setTimeout(r, 250));
const notices = async () => (await handle.db.select().from(schema.notifications)).map((n) => `${n.kind}${n.urgent ? "!" : ""}: ${n.title}`);
const signedIn = async (user: string, ip: string, ua: string, minutesAgo: number) =>
  handle.db.execute(sql`INSERT INTO audit_log (id, created_at, actor, action, ip, detail) VALUES (${`a${Math.random()}`}, ${new Date(Date.now() - minutesAgo * 60_000).toISOString()}, ${user}, 'login.ok', ${ip}, ${JSON.stringify({ ua })}::jsonb)`);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "oc-watch-"));
  handle = await createDb(undefined, dir);
  await ensureSchema(handle.db);
  usePlaceTable(fake as never);
}, 30_000); // a fresh test database and every migration: slow on the CI machines
afterAll(async () => {
  usePlaceTable(null);
  await handle.close?.();
  rmSync(dir, { recursive: true, force: true });
});

describe("sign-ins", () => {
  it("says nothing about a first sign-in, or a usual one", async () => {
    await signedIn("u1", "1.1.1.10", MAC, 0);
    onSignIn(handle, { id: "u1", name: "Sam" }, "1.1.1.10", MAC);
    await settle();
    expect(await notices()).toEqual([]);
    await signedIn("u1", "1.1.1.11", MAC, 0);
    onSignIn(handle, { id: "u1", name: "Sam" }, "1.1.1.11", MAC);
    await settle();
    expect(await notices()).toEqual([]);
  });

  it("notes a new device, and alerts on a new country and on two countries within two hours", async () => {
    await handle.db.execute(sql`UPDATE audit_log SET created_at = now() - interval '3 hours'`);
    await signedIn("u1", "1.1.1.12", IPHONE, 0);
    onSignIn(handle, { id: "u1", name: "Sam" }, "1.1.1.12", IPHONE);
    await settle();
    expect(await notices()).toEqual(["signin.new_device: Sam signed in on a new device: iPhone · Safari"]);
    await handle.db.execute(sql`UPDATE audit_log SET created_at = now() - interval '30 minutes' WHERE ip = '1.1.1.12'`);
    await signedIn("u1", "5.5.5.5", MAC, 0);
    onSignIn(handle, { id: "u1", name: "Sam" }, "5.5.5.5", MAC);
    await settle();
    const now = await notices();
    expect(now).toContain("signin.new_country!: Sam signed in from a country they haven't before: London, United Kingdom");
    expect(now).toContain("unusual.travel!: Sam signed in from London, United Kingdom and from Sydney, Australia within two hours");
  });
});

describe("guessing and the admin code", () => {
  it("alerts when one address tries five different accounts", async () => {
    for (const email of ["a", "b", "c", "d", "e"])
      await handle.db.execute(sql`INSERT INTO audit_log (id, actor, action, target, ip) VALUES (${`f${email}`}, NULL, 'login.failed', ${`email:${email}@x.com`}, '1.1.1.99')`);
    onFailedSignIn(handle, "1.1.1.99");
    await settle();
    expect(await notices()).toContain("unusual.many_accounts!: One address tried 5 different accounts in a quarter of an hour (Sydney, Australia)");
  });

  it("alerts once per new address for the admin code, and remembers it", async () => {
    onAdminCode(handle, "5.5.5.77", IPHONE);
    onAdminCode(handle, "5.5.5.77", IPHONE);
    await settle();
    expect((await notices()).filter((n) => n.startsWith("admin_code"))).toEqual(["admin_code.new_address!: The administrator code was used from a new address: London, United Kingdom"]);
  });

  it("notes the trap once a day per address", async () => {
    onTrap(handle, "/wp-login.php", "5.5.5.8", null);
    onTrap(handle, "/.env", "5.5.5.8", null);
    await settle();
    expect((await notices()).filter((n) => n.startsWith("trap"))).toEqual(["trap: Something tried /wp-login.php from London, United Kingdom"]);
  });
});

describe("reading everything, fast", () => {
  it("alerts when one account opens ten sheets in five minutes", async () => {
    for (let i = 0; i < 10; i++)
      await handle.db.execute(sql`INSERT INTO activity (id, kind, user_id, who, rundown_id) VALUES (${`s${i}`}, 'connect', 'u2', 'Lee', ${`sheet${i}`})`);
    onSheetOpened(handle, { userId: "u2", who: "Lee" }, null);
    await settle();
    expect(await notices()).toContain("unusual.many_sheets!: Lee opened 10 different sheets in five minutes");
  });
});
