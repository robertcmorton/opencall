import { sql } from "drizzle-orm";
import type { DbHandle } from "@opencall/db";

/**
 * How long each kind of record is kept, in days — Kitshare's periods where it
 * has one. Applied once a minute after start and then daily.
 */
export const RETENTION_DAYS = {
  /** Attempt counters nobody has touched. */
  throttles: 2,
  /** Sessions after they expired or were signed out. */
  endedSessions: 30,
  /** Failed and throttled sign-ins in the audit log. */
  failedSignIns: 90,
  /** Everything else in the audit log. */
  audit: 730,
  /** The error journal. */
  errors: 365,
} as const;

export async function applyRetention(handle: DbHandle): Promise<void> {
  const d = RETENTION_DAYS;
  const days = (n: number) => sql.raw(`interval '${Number(n)} days'`);
  await handle.db.execute(sql`DELETE FROM throttles WHERE last_at < now() - ${days(d.throttles)}`);
  await handle.db.execute(
    sql`DELETE FROM auth_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < now() - ${days(d.endedSessions)}) OR expires_at < now() - ${days(d.endedSessions)}`,
  );
  await handle.db.execute(sql`DELETE FROM audit_log WHERE action IN ('login.failed', 'login.throttled') AND created_at < now() - ${days(d.failedSignIns)}`);
  await handle.db.execute(sql`DELETE FROM audit_log WHERE created_at < now() - ${days(d.audit)}`);
  await handle.db.execute(sql`DELETE FROM error_logs WHERE at < now() - ${days(d.errors)}`);
}

/** Runs `applyRetention` a minute after start, then every 24 hours. Never throws. */
export function scheduleRetention(handle: DbHandle): void {
  const run = () => void applyRetention(handle).catch((err) => console.error("[retention] failed:", err));
  setTimeout(run, 60_000).unref?.();
  setInterval(run, 24 * 3600_000).unref?.();
}
