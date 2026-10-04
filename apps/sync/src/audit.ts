import { ulid } from "ulid";
import { schema, type DbHandle } from "@opencall/db";

/**
 * Records who did what to accounts and access. Never throws and never makes
 * the caller wait for it: an action that worked must not fail because its
 * record could not be written.
 */
export function audit(
  handle: DbHandle,
  entry: { actor: string | null; action: string; target?: string | null; ip?: string | null; detail?: Record<string, unknown> },
): void {
  void handle.db
    .insert(schema.auditLog)
    .values({
      id: ulid(),
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      ip: entry.ip ?? null,
      detail: entry.detail ?? null,
    })
    .catch((err) => console.error("[audit] could not record", entry.action, err));
}
