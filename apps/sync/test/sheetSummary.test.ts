import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { buildRundownDoc, createDb, encodeDoc, ensureSchema, projectRundownDoc, type DbHandle } from "@opencall/db";
import { sheetSummaries } from "../src/sheetSummary";

/** What a show's card on the dashboard says at a glance (6 Oct). */
describe("a sheet's summary for the dashboard", () => {
  it("start, end, rows, last change and how the last show ran — and re-reads only a changed sheet", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-summary-"));
    const handle: DbHandle = await createDb(undefined, dir);
    try {
      await ensureSchema(handle.db);
      const start = 19 * 3600; // 7:00 pm
      const doc = buildRundownDoc(
        [
          { type: "group", title: "Pre-show" },
          { type: "cue", title: "Doors", durationSec: 60 },
          { type: "cue", title: "Welcome", durationSec: 120 },
          { type: "cue", title: "Pre-record", durationSec: 30, parallel: true },
        ],
        { name: "Summary test", plannedStartSec: start },
      );
      const [, doors, welcome] = projectRundownDoc(doc).rows.map((r) => r.id) as [string, string, string];
      const edited = new Date("2026-10-06T08:00:00Z");
      await handle.db.execute(sql`INSERT INTO teams (id, name, slug) VALUES ('t', 'T', 't')`);
      await handle.db.execute(sql`INSERT INTO events (id, team_id, name, start_date, end_date, timezone) VALUES ('e', 't', 'E', '2026-10-06', '2026-10-06', 'Australia/Sydney')`);
      await handle.db.execute(sql`INSERT INTO rundowns (id, event_id, name, doc, doc_updated_at) VALUES ('r', 'e', 'Summary test', ${encodeDoc(doc)}, ${edited.toISOString()})`);
      await handle.db.execute(sql`INSERT INTO rundowns (id, event_id, name) VALUES ('empty', 'e', 'Nothing yet')`);
      // Doors ran 90 s (30 over), Welcome 100 s (20 under): +10 overall.
      const t = (sec: number) => new Date(Date.UTC(2026, 9, 6, 9, 0, sec)).toISOString();
      await handle.db.execute(sql`INSERT INTO show_sessions (id, rundown_id, state, started_at, ended_at) VALUES ('s', 'r', 'ended', ${t(0)}, ${t(190)})`);
      await handle.db.execute(sql`INSERT INTO show_transitions (id, session_id, at, type, row_id) VALUES
        ('x1', 's', ${t(0)}, 'start', ${doors}), ('x2', 's', ${t(90)}, 'next', ${welcome}), ('x3', 's', ${t(190)}, 'stop', NULL)`);

      const got = await sheetSummaries(handle.db, ["r", "empty"]);
      expect(got.get("r")).toEqual({
        rows: 3,
        startSec: start,
        endSec: start + 180,
        durationSec: expect.any(Number),
        editedAt: edited.toISOString(),
        lastRun: { startedAt: t(0), endedAt: t(190), ranSec: 10 },
      });
      expect(got.get("empty")).toMatchObject({ rows: 0, startSec: null, lastRun: null });

      // A changed sheet is read again: one more row, a new stamp.
      const longer = buildRundownDoc(
        [
          { type: "cue", title: "Doors", durationSec: 60 },
          { type: "cue", title: "Welcome", durationSec: 120 },
          { type: "cue", title: "Anthem", durationSec: 90 },
        ],
        { name: "Summary test", plannedStartSec: start },
      );
      await handle.db.execute(sql`UPDATE rundowns SET doc = ${encodeDoc(longer)}, doc_updated_at = ${new Date("2026-10-06T09:00:00Z").toISOString()} WHERE id = 'r'`);
      const again = await sheetSummaries(handle.db, ["r"]);
      expect(again.get("r")).toMatchObject({ rows: 3, endSec: start + 270, editedAt: "2026-10-06T09:00:00.000Z" });
    } finally {
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
