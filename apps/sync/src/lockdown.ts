import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { schema, type DbHandle } from "@opencall/db";
import { hashToken } from "./auth.ts";

/**
 * Lockdown (24 Oct 2026): one switch for when something is going on.
 *
 * Switching it on ends every sign-in session except the one pressing it,
 * turns every view-only link and guest pass off, and pauses AI assistants —
 * then every open screen is disconnected, so each has to come back in with
 * something still valid. Links are refused, not deleted: lifting the
 * lockdown brings them all back as they were. Sessions stay ended.
 *
 * Not touched: the server's own admin code, company codes and personal
 * access tokens, which are not sessions — change those in Railway and on the
 * Users page if one of them is the problem.
 *
 * Held in memory for every check (the code lookups are hot), written to the
 * database so a restart in the middle of an incident does not quietly lift it.
 */
export interface LockdownState {
  on: boolean;
  since: string | null;
  by: string | null;
}

let state: LockdownState = { on: false, since: null, by: null };

export const isLockedDown = (): boolean => state.on;
export const lockdownState = (): LockdownState => ({ ...state });

/** At start: pick the switch up from the database. */
export async function loadLockdown(handle: DbHandle): Promise<void> {
  try {
    const row = await handle.db.query.serverFlags.findFirst({ where: eq(schema.serverFlags.key, "lockdown") });
    if (row) state = { on: row.value.on === true, since: (row.value.since as string | null) ?? null, by: (row.value.by as string | null) ?? null };
  } catch (err) {
    console.error("[lockdown] could not read the switch:", err);
  }
}

/**
 * Turn it on or off. On: every session but `keepSessionToken` (when the
 * person pressing it signed in with one) is ended. Returns how many.
 */
export async function setLockdown(handle: DbHandle, on: boolean, by: string, keepSessionToken: string | null): Promise<{ sessionsEnded: number }> {
  const next: LockdownState = on ? { on: true, since: new Date().toISOString(), by } : { on: false, since: null, by: null };
  await handle.db
    .insert(schema.serverFlags)
    .values({ key: "lockdown", value: next as unknown as Record<string, unknown>, updatedBy: by })
    .onConflictDoUpdate({ target: schema.serverFlags.key, set: { value: next as unknown as Record<string, unknown>, updatedAt: new Date(), updatedBy: by } });
  state = next;
  if (!on) return { sessionsEnded: 0 };
  const keep = keepSessionToken?.startsWith("ses_") ? hashToken(keepSessionToken) : null;
  const ended = await handle.db
    .update(schema.authSessions)
    .set({ revokedAt: new Date() })
    .where(and(isNull(schema.authSessions.revokedAt), keep ? ne(schema.authSessions.token, keep) : sql`true`))
    .returning();
  return { sessionsEnded: ended.length };
}
