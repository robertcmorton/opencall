import { describe, expect, it } from "vitest";
import { webhookProblem } from "../src/cueSignals";

describe("which addresses fire-on-cue may call", () => {
  it("only https", async () => {
    expect(await webhookProblem("http://1.1.1.1/hook")).toMatch(/https/);
    expect(await webhookProblem("ftp://1.1.1.1/")).toMatch(/https/);
    expect(await webhookProblem("not a url")).toMatch(/not a web address/);
  });

  it("never a private, loopback, link-local or internal address", async () => {
    for (const u of [
      "https://localhost/x",
      "https://127.0.0.1/x",
      "https://10.1.2.3/x",
      "https://172.20.0.1/x",
      "https://192.168.1.10/x",
      "https://169.254.169.254/latest/meta-data",
      "https://100.64.0.1/x",
      "https://[::1]/x",
      "https://[fd00::1]/x",
      "https://[::ffff:10.0.0.1]/x",
      "https://[::ffff:a9fe:a9fe]/x",
      "https://[64:ff9b::10.0.0.1]/x",
      "https://postgres.railway.internal/x",
      "https://printer.local/x",
    ])
      expect(await webhookProblem(u), u).toMatch(/private network/);
  });

  it("a public address is fine, and credentials go in the path", async () => {
    expect(await webhookProblem("https://1.1.1.1/hook?key=abc")).toBeNull();
    expect(await webhookProblem("https://[::ffff:1.1.1.1]/hook")).toBeNull();
    expect(await webhookProblem("https://user:pw@1.1.1.1/hook")).toMatch(/credentials/);
  });
});

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { buildRundownDoc, createDb, encodeDoc, ensureSchema, projectRundownDoc, type DbHandle } from "@opencall/db";
import { createCueSignals } from "../src/cueSignals";

describe("firing on cue", () => {
  it("posts once when a new row goes on air, with that row and the next", async () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-cue-"));
    const handle: DbHandle = await createDb(undefined, dir);
    try {
      await ensureSchema(handle.db);
      const doc = buildRundownDoc(
        [
          { type: "cue", title: "Doors", durationSec: 60, cells: { audio: "Walk-in" } },
          { type: "cue", title: "Welcome", durationSec: 60 },
        ],
        { name: "Cue test", plannedStartSec: 0 },
      );
      const [a, b] = projectRundownDoc(doc).rows.map((r) => r.id) as [string, string];
      await handle.db.execute(sql`INSERT INTO teams (id, name, slug) VALUES ('t', 'T', 't')`);
      await handle.db.execute(sql`INSERT INTO events (id, team_id, name, start_date, end_date, timezone) VALUES ('e', 't', 'E', '2026-10-05', '2026-10-05', 'Australia/Sydney')`);
      await handle.db.execute(sql`INSERT INTO rundowns (id, event_id, name, doc, cue_webhooks) VALUES ('r', 'e', 'Cue test', ${encodeDoc(doc)}, ${JSON.stringify(["https://hooks.example.test/cue"])}::jsonb)`);
      const calls: { url: string; body: any; event: string | null }[] = [];
      let live = { state: "running", activeRowId: a as string | null };
      const cues = createCueSignals(handle, { documents: new Map() } as never, async () => live, {
        check: async () => null,
        fetch: (async (url: string, init: RequestInit) => {
          calls.push({ url, body: JSON.parse(String(init.body)), event: (init.headers as Record<string, string>)["x-opencall-event"] ?? null });
          return new Response("ok", { status: 200 });
        }) as never,
      });
      cues.onShowState("r", live);
      cues.onShowState("r", live); // the same row again: no second call
      await new Promise((r) => setTimeout(r, 200));
      expect(calls).toHaveLength(1);
      expect(calls[0]!.event).toBe("on_air");
      expect(calls[0]!.body.onAir).toMatchObject({ title: "Doors", cells: { Audio: "Walk-in" } });
      expect(calls[0]!.body.next).toMatchObject({ title: "Welcome" });
      live = { state: "running", activeRowId: b };
      cues.onShowState("r", live);
      await new Promise((r) => setTimeout(r, 200));
      expect(calls.map((c) => c.body.onAir?.title)).toEqual(["Doors", "Welcome"]);
      expect(cues.deliveries("r")[0]).toMatchObject({ host: "hooks.example.test", ok: true, status: 200 });
      expect((await cues.now("r"))?.onAir?.title).toBe("Welcome");
    } finally {
      await handle.close();
      rmSync(dir, { recursive: true, force: true });
    }
    // The database is built inside this test — every migration, on a fresh
    // PGlite — which took over the default 5 s on a CI runner (6 Oct) though
    // well under it here. The other database tests do it in beforeAll, which
    // has a longer allowance.
  }, 30_000);
});
