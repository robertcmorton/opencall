import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createDb, schema, type DbHandle } from "@opencall/db";
import { ulid } from "ulid";

/**
 * The one transaction in this repo, against a REAL Postgres.
 *
 * `sessions.ts` writes the session row and its as-run entry together, so that
 * nothing can end the process between them and leave a session claiming row 12
 * with nothing saying it was ever cued. That was reasoned about for both
 * drivers and, until 30 August, only ever RUN on the embedded one — production
 * would have been the first place it executed.
 *
 * Skipped unless DATABASE_URL points somewhere, because the point of the
 * embedded database is that `pnpm dev` and `pnpm test` need no infrastructure.
 * To run it:
 *
 *   docker run -d --name oc-pg -e POSTGRES_PASSWORD=pw -e POSTGRES_DB=opencall \
 *     -p 55432:5432 postgres:16-alpine
 *   DATABASE_URL=postgres://postgres:pw@localhost:55432/opencall pnpm --filter @opencall/sync test
 *
 * The schema has to exist first — booting the sync server against that URL once
 * creates it, which is itself the other half of what this proves.
 */
const url = process.env.DATABASE_URL;
const withPostgres = url ? describe : describe.skip;

withPostgres("the show-session transaction on Postgres", () => {
  let handle: DbHandle;
  let rundownId: string;

  beforeAll(async () => {
    handle = await createDb(url);
    const teamId = ulid();
    const eventId = ulid();
    rundownId = ulid();
    await handle.db.insert(schema.teams).values({ id: teamId, name: "tx test", slug: `tx-${teamId}`, createdAt: new Date() } as never);
    await handle.db.insert(schema.events).values({
      id: eventId, teamId, name: "tx test", startDate: "2026-01-01", endDate: "2026-01-01",
      timezone: "UTC", use24h: true, labels: [], createdAt: new Date(), updatedAt: new Date(),
    } as never);
    await handle.db.insert(schema.rundowns).values({ id: rundownId, eventId, name: "tx test" } as never);
  });
  afterAll(async () => handle?.close());

  const session = (id: string, seq: number) =>
    ({
      id, rundownId, state: "live", activeRowId: null, activeRowStartedAt: null, pausedAt: null,
      pausedAccumMs: 0, startedAt: new Date(), endedAt: null, callerUserId: null, seq, clockFollow: false,
    }) as never;

  it("is the real driver, not the embedded one", () => {
    expect(handle.driver).toBe("postgres");
  });

  it("writes the session and its as-run entry together", async () => {
    const id = ulid();
    await handle.db.transaction(async (tx) => {
      await tx.insert(schema.showSessions).values(session(id, 1));
      await tx.insert(schema.showTransitions).values({ id: ulid(), sessionId: id, at: new Date(), type: "start", rowId: null, actorUserId: null } as never);
    });
    const sessions = await handle.db.select().from(schema.showSessions);
    const transitions = await handle.db.select().from(schema.showTransitions);
    expect(sessions.some((r) => (r as { id: string }).id === id)).toBe(true);
    expect(transitions.some((r) => (r as { sessionId: string }).sessionId === id)).toBe(true);
  });

  // The whole reason the transaction exists: a failure between the two
  // statements must not leave the session advanced with no record of why.
  it("leaves neither row when the second write fails", async () => {
    const doomed = ulid();
    await expect(
      handle.db.transaction(async (tx) => {
        await tx.insert(schema.showSessions).values(session(doomed, 2));
        // A transition pointing at a session that does not exist — the foreign
        // key rejects it, which is a failure arriving mid-transaction.
        await tx.insert(schema.showTransitions).values({ id: ulid(), sessionId: "no-such-session", at: new Date(), type: "cue", rowId: null, actorUserId: null } as never);
      }),
    ).rejects.toThrow();
    const sessions = await handle.db.select().from(schema.showSessions);
    expect(sessions.some((r) => (r as { id: string }).id === doomed)).toBe(false);
  });
});
