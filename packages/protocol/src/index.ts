import { z } from "zod";

// No compiled validators: zod otherwise probes `new Function` to speed up
// parsing, which the web app's Content Security Policy refuses (by design).
// The probe failing is harmless but reported as a violation on every sheet
// page; switching it off keeps that report meaningful.
z.config({ jitless: true });

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
  /** What a view-only link's holder typed at "Who's watching?" — names them in presence (additive). */
  viewerName: z.string().max(80).optional(),
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
  // The played tick, by hand: take it off a row (play it again) or put it on.
  "unplay", "mark_played",
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
  .refine((m) => (m.action !== "unplay" && m.action !== "mark_played") || !!m.rowId, { message: "unplay and mark_played require rowId" })
  .refine((m) => m.action !== "fire" || !!m.rowId, { message: "fire requires rowId" })
  .refine((m) => m.action !== "stop" || m.confirm === true, { message: "stop requires confirm" });

/**
 * A message for the person on stage (additive v1.8): "wrap up", "stretch two
 * minutes". From the caller to every timer and prompter, large, until cleared
 * — `text: null` clears it. Not a transport command: it moves nothing, and
 * the as-run record does not carry it.
 */
/**
 * Who a message is for (21 Oct): the STAGE (timer, prompter), the CREW (a
 * banner on everyone's sheet) or both. Optional and additive — a message
 * without it is for the stage, which is all a message used to be.
 */
export const MessageTo = z.enum(["stage", "crew", "all"]);
export type MessageTo = z.infer<typeof MessageTo>;

export const SayMsg = z.object({
  ...envelope,
  t: z.literal("say"),
  text: z.string().trim().min(1).max(120).nullable(),
  to: MessageTo.optional(),
});

export const ClientMsg = z.union([HelloMsg, PingMsg, CmdMsg, SayMsg]);
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
  /**
   * Rows that have been on air this session and have left it, in the order
   * they left. Nothing the transport offers plays one again: Next and the
   * clock step over them. Emptied by Start. This is what lets a result
   * called after golden point be played — the show goes back UP the sheet
   * to the winning song, and when that ends it carries on past the extra
   * time it already played, rather than into it.
   */
  playedRowIds: z.array(z.string()).default([]),
});
export type ShowStatePayload = z.infer<typeof ShowStatePayload>;

export const WelcomeMsg = z.object({
  ...envelope,
  t: z.literal("welcome"),
  role: Role,
  userLabel: z.string(),
  /** The server's clock as the welcome left it. */
  serverTimeMs: z.number(),
  /**
   * The server's clock as the hello arrived (additive, 24 Oct 2026). With the
   * client's own send and receive times this makes the hello and welcome a
   * complete clock sample, so a screen knows the server's time one round trip
   * sooner than by waiting for its first pong.
   */
  helloAtMs: z.number().optional(),
  show: ShowStatePayload,
  /** The speaker message on screen right now, if any (additive v1.8). */
  speaker: z.lazy(() => SpeakerMessage).nullable().optional(),
  doc: z.object({ mode: z.enum(["sync", "projection"]) }),
  /** IANA timezone of the event's location — governs every clock (additive v1.3). */
  timezone: z.string().optional(),
  /**
   * The SHEET's kind of show ("nrl"), falling back to the event's — drives
   * sport-specific live flows (additive v1.6; became per-sheet in v1.7,
   * because one match day can run two sports off two sheets).
   */
  sport: z.string().optional(),
  /** This connection's id, as it appears in presence `people` — so a screen can leave itself out (additive). */
  you: z.string().optional(),
  // homeImage / awayImage: the two teams' logos were sent here as data URLs
  // until 23 Oct — 60 KB of a 63 KB welcome on a real sheet, sent to every
  // screen on every connect, after no screen showed them any more (20 Oct).
  // Gone; an older server that still sends them is ignored.
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
      cells: z.record(z.string(), z.string()),
    }),
  ),
});

/** One person on the sheet, for the faces at the top right (additive). */
export const PresencePerson = z.object({
  /** The connection's id; the same person on two screens appears once, under their first. */
  id: z.string(),
  name: z.string(),
  role: Role,
  /** Path on the sync server to their photo, when an account has one ("/users/…/photo?v=…"). */
  photo: z.string().optional(),
  /** How many screens they have it open on. */
  screens: z.number().int().positive(),
  /** Every one of those screens' connection ids — a screen leaves out the person it is one of. */
  ids: z.array(z.string()).optional(),
});
export type PresencePerson = z.infer<typeof PresencePerson>;

export const PresenceMsg = z.object({
  ...envelope,
  t: z.literal("presence"),
  // Partial: only the roles somebody is connected as are counted.
  counts: z.partialRecord(Role, z.number().int().nonnegative()),
  /** Who, by name — one entry per person (additive). */
  people: z.array(PresencePerson).optional(),
});

/** The message on screen now, or none (additive v1.8). */
export const SpeakerMessage = z.object({ text: z.string(), from: z.string(), atMs: z.number(), to: MessageTo.optional() });
/** Does this message belong on a stage screen (timer, prompter)? */
export const forStage = (m: { to?: MessageTo } | null | undefined): boolean => !!m && (m.to ?? "stage") !== "crew";
/** …and on the crew's sheets? */
export const forCrew = (m: { to?: MessageTo } | null | undefined): boolean => !!m && (m.to === "crew" || m.to === "all");
export type SpeakerMessage = z.infer<typeof SpeakerMessage>;
export const SpeakerMsg = z.object({ ...envelope, t: z.literal("speaker"), message: SpeakerMessage.nullable() });

/**
 * The sheet's kind of show changed while screens were open — the dashboard or
 * the walkthrough's match card picked a different game. Carries what the
 * welcome would have, so every screen switches without reconnecting (additive).
 */
export const KindMsg = z.object({
  ...envelope,
  t: z.literal("kind"),
  sport: z.string().nullable(),
  eventTypeSpec: z.lazy(() => WelcomeMsg.shape.eventTypeSpec),
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
  SpeakerMsg,
  KindMsg,
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
