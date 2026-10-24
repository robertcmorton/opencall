import { ulid } from "ulid";
import { schema, type DbHandle } from "@opencall/db";
import { mailConfigured, sendMail } from "./mail.ts";

/**
 * Telling someone (24 Oct 2026). Writes a notice for its audience — System
 * Administrators, for the security alerts — and, for an urgent one, emails it
 * to ALERT_EMAIL when mail is set up. Never throws and never makes the caller
 * wait.
 *
 * A notice with a `key` is written once: the same situation seen again (the
 * same spike in the same quarter-hour, the same new device) adds nothing.
 */
export interface Notice {
  kind: string;
  audience?: "admins";
  urgent?: boolean;
  title: string;
  body?: string;
  userId?: string | null;
  rundownId?: string | null;
  detail?: Record<string, unknown>;
  key?: string | null;
}

export function notify(handle: DbHandle, n: Notice): void {
  void (async () => {
    const rows = await handle.db
      .insert(schema.notifications)
      .values({
        id: ulid(),
        kind: n.kind,
        audience: n.audience ?? "admins",
        urgent: n.urgent ?? false,
        title: n.title.slice(0, 300),
        body: n.body?.slice(0, 2000) ?? null,
        userId: n.userId ?? null,
        rundownId: n.rundownId ?? null,
        detail: n.detail ?? null,
        key: n.key ?? null,
      })
      .onConflictDoNothing()
      .returning();
    // Emailed only when it is new — a repeat that the key swallowed is not news.
    const to = process.env.ALERT_EMAIL?.trim();
    if (rows.length > 0 && n.urgent && to && mailConfigured()) {
      const web = process.env.PUBLIC_WEB_URL?.replace(/\/$/, "");
      const text = `${n.title}\n\n${n.body ?? ""}${web ? `\n\nSee it: ${web}/admin/alerts` : ""}\n\n— OpenCall`;
      await Promise.all(to.split(",").map((addr) => sendMail(addr.trim(), `OpenCall alert: ${n.title.slice(0, 120)}`, text).catch(() => undefined)));
    }
  })().catch((err) => console.error("[notices] could not record", n.kind, err));
}

/** The current quarter-hour, for keys that mean "once per window". */
export const quarterHour = (ms = Date.now()): string => new Date(Math.floor(ms / 900_000) * 900_000).toISOString().slice(0, 16);
