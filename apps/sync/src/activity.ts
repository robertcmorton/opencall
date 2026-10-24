import { ulid } from "ulid";
import { schema, type DbHandle } from "@opencall/db";
import { describeDevice } from "@opencall/core";
import type { AuthCtx } from "./auth.ts";
import { placeOf } from "./place.ts";

/**
 * Who someone is, for the record: the account when there is one, and words
 * for everyone — the server's admin code and company codes are not people,
 * and a view-only link is named by what its holder typed.
 */
export interface Actor {
  userId: string | null;
  who: string | null;
  role: string | null;
}

export function actorOf(ctx: AuthCtx, viewerName?: string | null): Actor {
  if (!ctx) return { userId: null, who: null, role: null };
  switch (ctx.kind) {
    case "user":
      return { userId: ctx.userId, who: ctx.name, role: "user" };
    case "admin":
      return ctx.userId ? { userId: ctx.userId, who: ctx.name ?? "Administrator", role: "admin" } : { userId: null, who: "Administrator (server code)", role: "admin" };
    case "company":
      return { userId: null, who: `${ctx.teamName} (company code)`, role: "company" };
    case "code":
      return { userId: null, who: viewerName?.trim() ? `${viewerName.trim().slice(0, 80)} (view link)` : "View link", role: ctx.role };
  }
}

/** The id a browser keeps for itself (lib/deviceId.ts), or null when it sent none or nonsense. */
export const deviceIdOf = (raw: unknown): string | null =>
  typeof raw === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(raw) ? raw : null;

/** Where an entry came from: the device's own description, its id, its address. */
export interface Origin {
  ua?: string | null;
  deviceId?: string | null;
  ip?: string | null;
}

/** The device and place columns, worked out once for any record that carries them. */
export function originColumns(origin: Origin): { deviceId: string | null; device: string | null; ip: string | null; place: string | null; country: string | null } {
  const where = placeOf(origin.ip);
  return {
    deviceId: origin.deviceId ?? null,
    device: origin.ua ? describeDevice(origin.ua).label : null,
    ip: origin.ip ?? null,
    place: where?.place ?? null,
    country: where?.country ?? null,
  };
}

/**
 * One step on the activity trail. Never throws and never makes the caller
 * wait: what it records has already happened, and must not fail because the
 * record could not be written.
 */
export function recordActivity(
  handle: DbHandle,
  entry: { kind: string; actor?: Actor; origin?: Origin; rundownId?: string | null; detail?: Record<string, unknown> },
): void {
  const actor = entry.actor ?? { userId: null, who: null, role: null };
  void handle.db
    .insert(schema.activity)
    .values({
      id: ulid(),
      kind: entry.kind,
      userId: actor.userId,
      who: actor.who,
      role: actor.role,
      ...originColumns(entry.origin ?? {}),
      rundownId: entry.rundownId ?? null,
      detail: entry.detail ?? null,
    })
    .catch((err) => console.error("[activity] could not record", entry.kind, err));
}
