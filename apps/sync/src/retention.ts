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
  /** Assistant tokens after they expired or were revoked; assistant connections after they ended. */
  assistantTokens: 1,
  endedAssistants: 30,
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
  await handle.db.execute(sql`DELETE FROM mcp_tokens WHERE expires_at < now() - ${days(d.assistantTokens)} OR revoked_at < now() - ${days(d.assistantTokens)}`);
  await handle.db.execute(
    sql`DELETE FROM mcp_grants WHERE revoked_at < now() - ${days(d.endedAssistants)} OR authorized_at < now() - interval '90 days' - ${days(d.endedAssistants)}`,
  );
  await handle.db.execute(
    sql`DELETE FROM mcp_clients c WHERE c.created_at < now() - interval '1 day' AND c.last_used_at IS NULL AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.id)`,
  );
}

/** Runs `applyRetention` a minute after start, then every 24 hours. Never throws. */
export function scheduleRetention(handle: DbHandle): void {
  const run = () => void applyRetention(handle).catch((err) => console.error("[retention] failed:", err));
  setTimeout(run, 60_000).unref?.();
  setInterval(run, 24 * 3600_000).unref?.();
}
