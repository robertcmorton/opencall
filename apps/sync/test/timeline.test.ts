import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, ensureSchema, type DbHandle } from "@opencall/db";
import { readTimeline } from "../src/timeline";
import { placeOf, usePlaceTable } from "../src/place";

/** One person's story, read from the five places it is kept (24 Oct). */
describe("the timeline", () => {
  it("merges pages, connections, show actions, sign-ins, edits and errors in time order, and filters by person, device and sheet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-timeline-"));
    const handle: DbHandle = await createDb(undefined, dir);
    try {
      await ensureSchema(handle.db);
      const db = handle.db;
      const t = (min: number) => new Date(Date.UTC(2026, 9, 24, 3, min)).toISOString();
      await db.execute(sql`INSERT INTO users (id, email, name) VALUES ('u1', 'sam@example.com', 'Sam'), ('u2', 'lee@example.com', 'Lee')`);
      await db.execute(sql`INSERT INTO teams (id, name, slug) VALUES ('t', 'T', 't')`);
      await db.execute(sql`INSERT INTO events (id, team_id, name, start_date, end_date, timezone) VALUES ('e', 't', 'E', '2026-10-24', '2026-10-24', 'Australia/Sydney')`);
      await db.execute(sql`INSERT INTO rundowns (id, event_id, name) VALUES ('r', 'e', 'Match day')`);
      await db.execute(sql`INSERT INTO audit_log (id, created_at, actor, action, ip) VALUES ('a1', ${t(0)}, 'u1', 'login.ok', '203.0.113.9')`);
      await db.execute(sql`INSERT INTO activity (id, created_at, kind, user_id, who, device_id, device, rundown_id, detail) VALUES
        ('v1', ${t(1)}, 'page', 'u1', 'Sam', 'devSam01', 'iPad · Safari', 'r', ${JSON.stringify({ path: "/show/r" })}::jsonb),
        ('v2', ${t(2)}, 'connect', 'u1', 'Sam', 'devSam01', 'iPad · Safari', 'r', ${JSON.stringify({ page: "show" })}::jsonb),
        ('v3', ${t(6)}, 'disconnect', 'u1', 'Sam', 'devSam01', 'iPad · Safari', 'r', ${JSON.stringify({ page: "show", code: 1006, seconds: 240 })}::jsonb),
        ('v4', ${t(3)}, 'page', 'u2', 'Lee', 'devLee01', 'Mac · Chrome', NULL, ${JSON.stringify({ path: "/admin" })}::jsonb)`);
      await db.execute(sql`INSERT INTO show_sessions (id, rundown_id, state, started_at) VALUES ('s', 'r', 'running', ${t(4)})`);
      await db.execute(sql`INSERT INTO show_transitions (id, session_id, at, type, row_id, actor_user_id, who, device_id, device) VALUES
        ('x1', 's', ${t(4)}, 'start', 'row1', 'u1', 'Sam', 'devSam01', 'iPad · Safari'),
        ('x2', 's', ${t(5)}, 'jump', 'row2', NULL, NULL, NULL, NULL)`);
      await db.execute(sql`INSERT INTO error_logs (id, at, source, message, context) VALUES ('err1', ${t(7)}, 'client', 'Something broke', ${JSON.stringify({ userId: "u1", deviceId: "devSam01", trail: [{ at: 1, kind: "click", what: "Start show" }] })}::jsonb)`);

      const sam = await readTimeline(handle, { userId: "u1" });
      expect(sam.map((e) => e.what)).toEqual([
        "Error: Something broke",
        "Lost the show link on the show page after 4 min — the network dropped or the device slept",
        "Pressed Start show",
        "Connected the show page to the show",
        "Opened the show page",
        "Signed in",
      ]);
      expect(sam.every((e) => e.who === "Sam")).toBe(true);
      expect(sam.find((e) => e.source === "show")?.sheet).toBe("Match day");
      expect(sam.find((e) => e.source === "error")?.detail?.trail).toEqual([{ at: 1, kind: "click", what: "Start show" }]);

      // A device: only what that browser did — no sign-ins, which have no device id.
      const ipad = await readTimeline(handle, { deviceId: "devSam01" });
      expect(ipad.map((e) => e.source)).toEqual(["error", "activity", "show", "activity", "activity"]);

      // A sheet: everyone on it, and the clock's move too.
      const sheet = await readTimeline(handle, { rundownId: "r", withClock: true });
      expect(sheet.map((e) => `${e.who}: ${e.what}`)).toContain("The clock: The clock moved the cue on");
      // …which is left out unless asked for: many a show, noise when looking for a person.
      expect((await readTimeline(handle, { rundownId: "r" })).some((e) => e.who === "The clock")).toBe(false);
      expect(sheet.some((e) => e.who === "Lee")).toBe(false);

      // A time window.
      const window = await readTimeline(handle, { from: new Date(t(3)), to: new Date(t(5)), withClock: true });
      expect(window.map((e) => e.at)).toEqual([t(5), t(4), t(3)].map((x) => new Date(x).toISOString()));
    } finally {
      await handle.close?.();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000); // a fresh test database and every migration: slow on the CI machines
});

describe("where an address is", () => {
  it("is blank without the table, and never looked up for private addresses", () => {
    usePlaceTable(null);
    expect(placeOf("8.8.8.8")).toBeNull();
    const fake = { get: () => ({ country: { iso_code: "AU", names: { en: "Australia" } }, city: { names: { en: "Sydney" } } }) };
    usePlaceTable(fake as never);
    expect(placeOf("203.0.113.9")).toEqual({ place: "Sydney, Australia", country: "AU" });
    expect(placeOf("::ffff:203.0.113.9")).toEqual({ place: "Sydney, Australia", country: "AU" });
    for (const local of ["10.1.2.3", "192.168.0.4", "172.16.0.1", "127.0.0.1", "100.64.0.1", "::1", "fe80::1", "fd00::1", "not an address"]) expect(placeOf(local)).toBeNull();
    usePlaceTable(null);
  });
});
