import { sql } from "drizzle-orm";
import type { DbHandle } from "@opencall/db";

/**
 * A fixed-window attempt counter in one atomic statement.
 *
 * `consume` counts an attempt and says whether it is within `max` for the
 * current window. The insert-or-update is a single statement, so two
 * requests arriving together cannot both see "4 of 5" and both get in. A
 * window that has run out starts again from 1.
 *
 * Callers count BEFORE checking a password and `release` afterwards if it was
 * right — so only failures accumulate, and a burst of parallel guesses is
 * counted in full.
 */
export interface Limit {
  max: number;
  windowSec: number;
}

export async function consume(handle: DbHandle, key: string, limit: Limit): Promise<{ ok: boolean; count: number; retryAfterSec: number }> {
  const res = await handle.db.execute(sql`
    INSERT INTO throttles (key, count, window_start, last_at)
    VALUES (${key}, 1, now(), now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN throttles.window_start < now() - make_interval(secs => ${limit.windowSec}::int) THEN 1 ELSE throttles.count + 1 END,
      window_start = CASE WHEN throttles.window_start < now() - make_interval(secs => ${limit.windowSec}::int) THEN now() ELSE throttles.window_start END,
      last_at = now()
    RETURNING count, extract(epoch from (window_start + make_interval(secs => ${limit.windowSec}::int) - now()))::int AS remaining
  `);
  const row = rowsOf(res)[0] ?? { count: 1, remaining: limit.windowSec };
  const count = Number(row.count);
  // Roughly one call in a hundred tidies rows nobody has touched for two days.
  if (Math.random() < 0.01) void handle.db.execute(sql`DELETE FROM throttles WHERE last_at < now() - interval '2 days'`).catch(() => {});
  return { ok: count <= limit.max, count, retryAfterSec: Math.max(1, Number(row.remaining)) };
}

/** Gives back one attempt — called when the attempt turned out to be legitimate. */
export async function release(handle: DbHandle, key: string): Promise<void> {
  await handle.db.execute(sql`UPDATE throttles SET count = GREATEST(count - 1, 0) WHERE key = ${key}`);
}

/** Forgets every counter whose key starts with `prefix` (e.g. after a password reset). */
export async function clearStartingWith(handle: DbHandle, prefix: string): Promise<void> {
  await handle.db.execute(sql`DELETE FROM throttles WHERE key LIKE ${prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%"}`);
}

/** How many attempts are on the clock for `key` right now, without counting one. */
export async function peek(handle: DbHandle, key: string, windowSec: number): Promise<number> {
  const res = await handle.db.execute(sql`
    SELECT count FROM throttles WHERE key = ${key} AND window_start >= now() - make_interval(secs => ${windowSec}::int)
  `);
  return Number(rowsOf(res)[0]?.count ?? 0);
}

function rowsOf(res: unknown): Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  return ((res as { rows?: Record<string, unknown>[] }).rows ?? []) as Record<string, unknown>[];
}
