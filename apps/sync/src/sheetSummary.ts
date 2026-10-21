import { inArray } from "drizzle-orm";
import { absoluteNow, blockRowIds, computeTiming, joinedLateSec, ranOverUnder, runTimes, zoneSecondsOfDay, type PlanTiming } from "@opencall/core";
import { decodeDoc, projectRundownDoc, schema, type DbHandle } from "@opencall/db";

/**
 * What a show's card on the dashboard says at a glance (6 Oct 2026): when it
 * starts, how long it runs, how many rows it has, when it was last changed and
 * how its last show went.
 *
 * Only the sheet itself knows the first three — they live in the shared
 * document, not in a column — so each sheet is read here. Reading one means
 * decoding it, so the answer is kept until the sheet changes (its stored copy
 * is re-stamped on every save) and a dashboard reload only re-reads sheets
 * someone has touched. The stored copy trails live typing by the save
 * debounce, a few seconds, which a dashboard can live with.
 */
export interface SheetSummary {
  /** Rows in the running order, headings left out. */
  rows: number;
  /** Sheet time (seconds from midnight, may run past 24h) of the first item, or null if nothing is timed. */
  startSec: number | null;
  endSec: number | null;
  durationSec: number;
  /** When the sheet's content last changed. */
  editedAt: string | null;
  /** The most recent show on this sheet that has finished, or null. */
  lastRun: {
    startedAt: string;
    endedAt: string;
    /** Over (+) or under (−) across the items played — the sheet's "Ran". Null when nothing timed played. */
    ranSec: number | null;
  } | null;
}

type Db = DbHandle["db"];
type Plan = Pick<SheetSummary, "rows" | "startSec" | "endSec" | "durationSec"> & {
  lengths: Parameters<typeof ranOverUnder>[0];
  /** For the rows the total leaves out, as the sheet's "Ran" does: blocks, and a row the show joined late. */
  timing: PlanTiming | null;
  blocks: Set<string>;
};

const plans = new Map<string, { key: string; plan: Plan }>();
/** A finished show never changes, so its total is kept by session (and the sheet stamp, since lengths count). */
const ran = new Map<string, number | null>();

export async function sheetSummaries(db: Db, rundownIds: readonly string[]): Promise<Map<string, SheetSummary>> {
  const out = new Map<string, SheetSummary>();
  if (rundownIds.length === 0) return out;
  const ids = [...rundownIds];

  const stamps = await db.query.rundowns.findMany({
    where: inArray(schema.rundowns.id, ids),
    columns: { id: true, eventId: true, docEpoch: true, docUpdatedAt: true, updatedAt: true, plannedStartSec: true },
  });
  const keyOf = (r: (typeof stamps)[number]) => `${r.docEpoch}:${r.docUpdatedAt?.getTime() ?? 0}:${r.plannedStartSec ?? ""}`;
  const stale = stamps.filter((r) => plans.get(r.id)?.key !== keyOf(r)).map((r) => r.id);
  if (stale.length > 0) {
    const docs = await db.query.rundowns.findMany({
      where: inArray(schema.rundowns.id, stale),
      columns: { id: true, doc: true },
    });
    const docOf = new Map(docs.map((d) => [d.id, d.doc]));
    for (const r of stamps) {
      if (!stale.includes(r.id)) continue;
      plans.set(r.id, { key: keyOf(r), plan: planOf(docOf.get(r.id) ?? null, r.plannedStartSec) });
    }
  }

  const sessions = await db.query.showSessions.findMany({
    where: inArray(schema.showSessions.rundownId, ids),
    columns: { id: true, rundownId: true, state: true, startedAt: true, endedAt: true },
  });
  const lastEnded = new Map<string, (typeof sessions)[number]>();
  for (const s of sessions) {
    if (s.state !== "ended" || !s.endedAt) continue;
    const prev = lastEnded.get(s.rundownId);
    if (!prev || s.endedAt > prev.endedAt!) lastEnded.set(s.rundownId, s);
  }
  const want = [...lastEnded.values()].filter((s) => !ran.has(`${s.id}:${plans.get(s.rundownId)?.key}`));
  if (want.length > 0) {
    const log = await db.query.showTransitions.findMany({
      where: inArray(
        schema.showTransitions.sessionId,
        want.map((s) => s.id),
      ),
      columns: { sessionId: true, at: true, type: true, rowId: true },
    });
    // The event's zone, to read when a show started in the sheet's own time.
    const eventOf = new Map(stamps.map((r) => [r.id, r.eventId]));
    const events = await db.query.events.findMany({
      where: inArray(schema.events.id, [...new Set(want.map((s) => eventOf.get(s.rundownId)!).filter(Boolean))]),
      columns: { id: true, timezone: true },
    });
    const zoneOf = new Map(events.map((e) => [e.id, e.timezone]));
    for (const s of want) {
      const runs = runTimes(log.filter((t) => t.sessionId === s.id).map((t) => ({ atMs: t.at.getTime(), type: t.type, rowId: t.rowId })));
      const plan = plans.get(s.rundownId)?.plan;
      if (!plan) {
        ran.set(`${s.id}:${plans.get(s.rundownId)?.key}`, null);
        continue;
      }
      const leaveOut = new Set(plan.blocks);
      const { timing } = plan;
      if (timing) {
        const zone = zoneOf.get(eventOf.get(s.rundownId) ?? "") ?? null;
        const sheetSecOf = (ms: number) => absoluteNow(zoneSecondsOfDay(ms, zone), timing);
        plan.lengths.forEach((r, i) => {
          if (joinedLateSec(runs.get(r.id), timing.rows[i]?.startSec, r.durationSec, sheetSecOf) != null) leaveOut.add(r.id);
        });
      }
      ran.set(`${s.id}:${plans.get(s.rundownId)?.key}`, ranOverUnder(plan.lengths, (id) => runs.get(id), leaveOut));
    }
  }

  for (const r of stamps) {
    const plan = plans.get(r.id)?.plan;
    if (!plan) continue;
    const s = lastEnded.get(r.id);
    out.set(r.id, {
      rows: plan.rows,
      startSec: plan.startSec,
      endSec: plan.endSec,
      durationSec: plan.durationSec,
      editedAt: (r.docUpdatedAt ?? r.updatedAt)?.toISOString() ?? null,
      lastRun: s
        ? {
            startedAt: s.startedAt.toISOString(),
            endedAt: s.endedAt!.toISOString(),
            ranSec: ran.get(`${s.id}:${plans.get(r.id)?.key}`) ?? null,
          }
        : null,
    });
  }
  return out;
}

function planOf(doc: Uint8Array | null, plannedStartSec: number | null): Plan {
  if (!doc) return { rows: 0, startSec: null, endSec: null, durationSec: 0, lengths: [], timing: null, blocks: new Set() };
  const projected = projectRundownDoc(decodeDoc(doc));
  const timing = computeTiming(projected.rows, projected.meta.plannedStartSec ?? plannedStartSec);
  const lengths = projected.rows.map((r) => ({
    id: r.id,
    type: r.type,
    durationSec: r.durationSec,
    parallel: r.parallel,
    durationMuted: r.durationMuted,
    skipped: r.skipped,
    spans: r.spans,
  }));
  return {
    rows: projected.rows.filter((r) => r.type !== "group").length,
    startSec: timing.startSec,
    endSec: timing.endSec,
    durationSec: timing.totalDurationSec,
    lengths,
    timing,
    blocks: blockRowIds(lengths, timing),
  };
}
