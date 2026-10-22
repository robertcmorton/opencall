import { ulid } from "ulid";
import { schema, type DbHandle } from "@opencall/db";

/**
 * Records who did what to accounts and access. Never throws and never makes
 * the caller wait for it: an action that worked must not fail because its
 * record could not be written.
 */
export function audit(
  handle: DbHandle,
  entry: {
    actor: string | null;
    action: string;
    target?: string | null;
    ip?: string | null;
    /**
     * The device's own description of itself (22 Oct 2026). Kept in `detail`
     * rather than a column of its own, so recording it needed no change to
     * the database during a week when nothing could be deployed.
     */
    ua?: string | null;
    detail?: Record<string, unknown>;
  },
): void {
  const ua = entry.ua?.trim().slice(0, 300) || null;
  const detail = ua ? { ...entry.detail, ua } : (entry.detail ?? null);
  void handle.db
    .insert(schema.auditLog)
    .values({
      id: ulid(),
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      ip: entry.ip ?? null,
      detail,
    })
    .catch((err) => console.error("[audit] could not record", entry.action, err));
}

/** A request's user agent, as one string (Node gives a header as string or list). */
export const userAgentOf = (req: { headers: Record<string, string | string[] | undefined> }): string | null => {
  const raw = req.headers["user-agent"];
  return (Array.isArray(raw) ? raw.join(" ") : raw) ?? null;
};
