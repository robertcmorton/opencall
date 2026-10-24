import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDb, ensureSchema, schema, type DbHandle } from "@opencall/db";
import { codeGuessLimit, loginTryLimit, noteCodeMiss, noteLoginFailure, SWARM } from "../src/swarm";

/** Guessing from many addresses at once (24 Oct). */
describe("a guessing swarm", () => {
  it("tightens every address's allowance once wrong guesses from everywhere pass the threshold, and alerts once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-swarm-"));
    const handle: DbHandle = await createDb(undefined, dir);
    try {
      await ensureSchema(handle.db);
      expect(await codeGuessLimit(handle, 30)).toBe(30);
      for (let i = 0; i < SWARM.codeMisses - 1; i++) await noteCodeMiss(handle);
      expect(await codeGuessLimit(handle, 30)).toBe(30); // one short: still normal
      await noteCodeMiss(handle);
      expect(await codeGuessLimit(handle, 30)).toBe(SWARM.tightPerIp);
      for (let i = 0; i < 20; i++) await noteCodeMiss(handle); // the spike carries on
      await new Promise((r) => setTimeout(r, 200)); // notices are written in the background
      const notices = await handle.db.select().from(schema.notifications);
      expect(notices.filter((n) => n.kind === "swarm.codes")).toHaveLength(1);
      expect(notices[0]!.urgent).toBe(true);
      expect(notices[0]!.audience).toBe("admins");

      // Passwords are counted separately.
      expect(await loginTryLimit(handle, 20)).toBe(20);
      for (let i = 0; i < SWARM.loginFailures; i++) await noteLoginFailure(handle);
      expect(await loginTryLimit(handle, 20)).toBe(SWARM.tightPerIp);
    } finally {
      await handle.close?.();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
