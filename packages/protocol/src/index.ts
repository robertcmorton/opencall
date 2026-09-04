import { z } from "zod";

/** Wire protocol version. Bumps only on breaking changes — see PROTOCOL.md. */
export const PROTOCOL_VERSION = 1;

// "admin" sits above the per-show roles: it is granted only by the server's
// ADMIN_TOKEN (never stored in share_tokens) and can act across shows.
export const Role = z.enum(["admin", "caller", "editor", "follower", "guest"]);
export type Role = z.infer<typeof Role>;

export const ShowStateName = z.enum(["idle", "running", "paused", "ended"]);
export type ShowStateName = z.infer<typeof ShowStateName>;

const envelope = { v: z.literal(PROTOCOL_VERSION) };

// ── Client → Server ────────────────────────────────────────────────────────────

export const HelloMsg = z.object({
  ...envelope,
  t: z.literal("hello"),
  auth: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("session"), token: z.string().min(1) }),
    z.object({ kind: z.literal("join"), code: z.string().min(4).max(12) }),
    z.object({ kind: z.literal("guest"), token: z.string().min(1) }),
  ]),
  device: z.enum(["console", "companion"]),
  lastSeq: z.number().int().nonnegative().optional(),
});

export const PingMsg = z.object({ ...envelope, t: z.literal("ping"), t0: z.number() });

// "fire" logs an untimed pool cue to the as-run record without moving the show.
// "clock_on"/"clock_off" toggle SERVER-driven clock-follow: the server itself
// advances the show along the TIME column — no console needs to stay open.
// (v1.7 retired "clock_hold"/"clock_release". Holding stopped the advance and
// resumed from the clock's current row — which is exactly what clock_off and
// clock_on do, so it was a second control for one behaviour and read as
// pointless because it was. Old as-run records keep the two types.)
// "walk" moves the pre-show walkthrough cursor (rowId, or none to end it) —
// a shared highlight for rehearsing the sheet before the show starts.
export const CmdAction = z.enum([
  "start", "pause", "resume", "next", "prev", "jump", "stop", "fire",
  "clock_on", "clock_off", "walk",
]);
export type CmdAction = z.infer<typeof CmdAction>;

export const CmdMsg = z
  .object({
    ...envelope,
    t: z.literal("cmd"),
    id: z.string().min(1),
    action: CmdAction,
    rowId: z.string().optional(),
    confirm: z.boolean().optional(),
    /**
     * This jump means "put the show where the SHEET says it is", not "take
     * this row now" (additive v1.7).
     *
     * The two are different and only the caller knows which is meant. An
     * ordinary jump starts the row at the moment it is pressed, because the
     * showcaller is taking it now. Syncing to the clock is a claim about where
     * the show already was, so the row inherits its planned start — otherwise
     * pressing sync reports the show as late by exactly however overdue the
     * row was, which is the opposite of what the button just did.
     */
    atPlanned: z.boolean().optional(),
  })
  .refine((m) => m.action !== "jump" || !!m.rowId, { message: "jump requires rowId" })
  .refine((m) => m.action !== "fire" || !!m.rowId, { message: "fire requires rowId" })
  .refine((m) => m.action !== "stop" || m.confirm === true, { message: "stop requires confirm" });

export const ClientMsg = z.union([HelloMsg, PingMsg, CmdMsg]);
export type ClientMsg = z.infer<typeof ClientMsg>;

// ── Server → Client ────────────────────────────────────────────────────────────

export const ShowStatePayload = z.object({
  seq: z.number().int().nonnegative(),
  state: ShowStateName,
  sessionId: z.string().nullable(),
  activeRowId: z.string().nullable(),
  activeRowStartedAtMs: z.number().nullable(),
  pausedAtMs: z.number().nullable(),
  pausedAccumMs: z.number().nonnegative(),
  sessionStartedAtMs: z.number().nullable(),
  /** Server-driven clock-follow is active for this session (additive v1.4). */
  clockFollow: z.boolean().default(false),
  /** Pre-show walkthrough cursor — highlighted on every device (additive v1.5). */
  walkRowId: z.string().nullable().default(null),
});
export type ShowStatePayload = z.infer<typeof ShowStatePayload>;

export const WelcomeMsg = z.object({
  ...envelope,
  t: z.literal("welcome"),
  role: Role,
  userLabel: z.string(),
  serverTimeMs: z.number(),
  show: ShowStatePayload,
  doc: z.object({ mode: z.enum(["sync", "projection"]) }),
  /** IANA timezone of the event's location — governs every clock (additive v1.3). */
  timezone: z.string().optional(),
  /**
   * The SHEET's kind of show ("nrl"), falling back to the event's — drives
   * sport-specific live flows (additive v1.6; became per-sheet in v1.7,
   * because one match day can run two sports off two sheets).
   */
  sport: z.string().optional(),
  /** The two teams' images (data URLs), per sheet: home and away. Additive. */
  homeImage: z.string().nullable().optional(),
  awayImage: z.string().nullable().optional(),
  /**
   * The whole definition, when the sheet uses a type a company added rather
   * than a built-in one (additive v1.7). Sent rather than looked up so a
   * custom type behaves live exactly like a built-in, with no second fetch
   * from a phone on venue wifi.
   */
  eventTypeSpec: z
    .object({
      id: z.string(),
      label: z.string(),
      group: z.string().optional(),
      fullTime: z.array(z.string()),
      afterExtra: z.array(z.string()),
      extraLabel: z.string().nullable().optional(),
      resultDuePhrases: z.array(z.string()).optional(),
      blurb: z.string().nullable().optional(),
    })
    .optional(),
});

export const PongMsg = z.object({ ...envelope, t: z.literal("pong"), t0: z.number(), t1: z.number() });

export const ShowStateMsg = z.object({ ...envelope, t: z.literal("show_state") }).and(ShowStatePayload);

export const CmdErrorMsg = z.object({
  ...envelope,
  t: z.literal("cmd_error"),
  id: z.string(),
  code: z.number().int(),
  msg: z.string(),
});

export const DocProjectionMsg = z.object({
  ...envelope,
  t: z.literal("doc_projection"),
  rev: z.number().int().nonnegative(),
  columns: z.array(z.object({ id: z.string(), title: z.string(), kind: z.string() })),
  rows: z.array(
    z.object({
      id: z.string(),
      type: z.enum(["cue", "group", "milestone"]),
      startSec: z.number().nullable(),
      durationSec: z.number().nullable(),
      cells: z.record(z.string()),
    }),
  ),
});

export const PresenceMsg = z.object({
  ...envelope,
  t: z.literal("presence"),
  counts: z.record(Role, z.number().int().nonnegative()),
});

export const HeartbeatMsg = z.object({ ...envelope, t: z.literal("hb") });

export const ErrorMsg = z.object({
  ...envelope,
  t: z.literal("error"),
  code: z.number().int(),
  msg: z.string(),
});

export const ServerMsg = z.union([
  WelcomeMsg,
  PongMsg,
  ShowStateMsg,
  CmdErrorMsg,
  DocProjectionMsg,
  PresenceMsg,
  HeartbeatMsg,
  ErrorMsg,
]);
export type ServerMsg = z.infer<typeof ServerMsg>;

// ── Close codes (PROTOCOL.md §8) ───────────────────────────────────────────────

export const CloseCodes = {
  BAD_VERSION: 4000,
  AUTH_FAILED: 4001,
  FORBIDDEN: 4003,
  UNKNOWN_RUNDOWN: 4004,
  TOKEN_REVOKED: 4009,
  RATE_LIMITED: 4029,
} as const;

/** Parse an incoming client frame; returns undefined for unknown/invalid frames. */
export function parseClientMsg(raw: string): ClientMsg | undefined {
  try {
    const parsed = ClientMsg.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
