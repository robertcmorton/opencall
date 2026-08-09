import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

const id = (name = "id") => text(name);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ── Identity & teams ───────────────────────────────────────────────────────────

export const users = pgTable("users", {
  id: id().primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  accessToken: text("access_token").unique(),
  passwordHash: text("password_hash"),
  imageUrl: text("image_url"),
  createdAt: createdAt(),
});

export const teams = pgTable("teams", {
  id: id().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  companyToken: text("company_token").unique(),
  logo: text("logo"),
  createdAt: createdAt(),
});

/** Password-login sessions: a `ses_…` bearer token per signed-in browser, revocable server-side. */
export const authSessions = pgTable("auth_sessions", {
  id: id().primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  createdAt: createdAt(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  userAgent: text("user_agent"),
});

export const teamRoles = ["owner", "admin", "editor", "viewer"] as const;

/** Access grants: what a user controls. kind admin | company | event | view. */
export const grantKinds = ["admin", "company", "event", "view"] as const;

export const userGrants = pgTable(
  "user_grants",
  {
    userId: text("user_id").notNull().references(() => users.id),
    kind: text("kind", { enum: grantKinds }).notNull(),
    targetId: text("target_id").notNull().default(""),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.targetId] })],
);

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id").notNull().references(() => teams.id),
    userId: text("user_id").notNull().references(() => users.id),
    role: text("role", { enum: teamRoles }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// ── Events & rundowns ──────────────────────────────────────────────────────────

export const events = pgTable("events", {
  id: id().primaryKey(),
  teamId: text("team_id").notNull().references(() => teams.id),
  name: text("name").notNull(),
  location: text("location"),
  startDate: text("start_date").notNull(), // ISO date, event-local
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull(),
  /** Sport code ("nrl") — drives sport-specific live flows like outcome picks. */
  sport: text("sport"),
  use24h: boolean("use_24h").notNull().default(false),
  image1: text("image1"),
  image2: text("image2"),
  labels: jsonb("labels").$type<{ text: string; color: string }[]>().notNull().default([]),
  brandingImageKey: text("branding_image_key"),
  ownerUserId: text("owner_user_id").references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rundowns = pgTable("rundowns", {
  id: id().primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  name: text("name").notNull(),
  description: text("description"),
  showDate: text("show_date"),
  plannedStartSec: integer("planned_start_sec"),
  doc: bytea("doc"),
  docUpdatedAt: timestamp("doc_updated_at", { withTimezone: true }),
  /** Bumped on in-place restore: doc connections are scoped to `<id>@<epoch>`, so stale clients can never merge old state back. */
  docEpoch: integer("doc_epoch").notNull().default(0),
  /** The imported run sheet, kept so Update import can re-read it with the current pipeline. */
  sourceName: text("source_name"),
  sourceFile: bytea("source_file"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /**
   * The event is over and the sheet is closed to its audience: crew codes,
   * guest passes and read-only accounts stop opening it. The people who run
   * the show — callers, editors, the company, admins — are unaffected, and
   * either of them can open it again.
   */
  viewingClosedAt: timestamp("viewing_closed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rundownSnapshots = pgTable("rundown_snapshots", {
  id: id().primaryKey(),
  rundownId: text("rundown_id").notNull().references(() => rundowns.id),
  doc: bytea("doc").notNull(),
  label: text("label"),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const templates = pgTable("templates", {
  id: id().primaryKey(),
  teamId: text("team_id").references(() => teams.id), // null = built-in starter template
  name: text("name").notNull(),
  description: text("description"),
  doc: bytea("doc").notNull(),
  createdBy: text("created_by").references(() => users.id),
  createdAt: createdAt(),
});

export const eventFolders = pgTable("event_folders", {
  id: id().primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  parentId: text("parent_id"),
  name: text("name").notNull(),
});

export const eventFiles = pgTable("event_files", {
  id: id().primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id),
  folderId: text("folder_id"),
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedBy: text("uploaded_by").references(() => users.id),
  createdAt: createdAt(),
});

// ── Sharing & joining ──────────────────────────────────────────────────────────

export const shareTokenKinds = ["guest", "join"] as const;
export const shareRoles = ["caller", "editor", "follower", "guest"] as const;

export const shareTokens = pgTable("share_tokens", {
  id: id().primaryKey(),
  rundownId: text("rundown_id").notNull().references(() => rundowns.id),
  kind: text("kind", { enum: shareTokenKinds }).notNull(),
  token: text("token").notNull().unique(),
  joinCode: text("join_code").unique(),
  role: text("role", { enum: shareRoles }).notNull(),
  /** Who this code is for ("Sarah — Cam 2") — the joiner's identity on every screen. */
  label: text("label"),
  columnVisibility: jsonb("column_visibility").$type<Record<string, boolean>>(),
  createdBy: text("created_by").references(() => users.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/**
 * Who opened a view-only link, and on what.
 *
 * A link gets forwarded. Without this a showcaller can see that six devices
 * are connected and nothing about whose they are — which is no use at all when
 * the question is "has camera 2 got the running order yet?".
 *
 * One row per device per link, updated on each visit rather than appended, so
 * the list stays a list of PEOPLE and not a log of page loads.
 *
 * The address is recorded because venue networks are where this goes wrong and
 * it is the only way to tell two identical iPads apart. It is personal data:
 * it belongs to the sharing record, is shown only to whoever can manage the
 * run sheet, and goes when the link is revoked or the sheet deleted.
 */
export const shareViews = pgTable("share_views", {
  id: id().primaryKey(),
  shareTokenId: text("share_token_id").notNull().references(() => shareTokens.id, { onDelete: "cascade" }),
  /** What they typed when the link asked. */
  name: text("name").notNull(),
  /** A stable id kept in the device's own storage, so revisits update a row. */
  deviceId: text("device_id").notNull(),
  /**
   * The roles this viewer picked for themselves ("CAM 2", "AUD").
   *
   * The picker was per-browser and went no further, so a showcaller could see
   * that eight people had the sheet open and not which of them was on camera.
   * Self-declared, like the name — it says who BELIEVES they are covering
   * what, which is the useful thing to know before a show.
   */
  roles: text("roles"),
  browser: text("browser"),
  os: text("os"),
  screen: text("screen"),
  ip: text("ip"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Live show state ────────────────────────────────────────────────────────────

export const showSessionStates = ["running", "paused", "ended"] as const;

export const showSessions = pgTable(
  "show_sessions",
  {
    id: id().primaryKey(),
    rundownId: text("rundown_id").notNull().references(() => rundowns.id),
    state: text("state", { enum: showSessionStates }).notNull(),
    activeRowId: text("active_row_id"),
    activeRowStartedAt: timestamp("active_row_started_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedAccumMs: bigint("paused_accum_ms", { mode: "number" }).notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    callerUserId: text("caller_user_id").references(() => users.id),
    seq: bigint("seq", { mode: "number" }).notNull().default(0),
    /** Server-driven clock-follow: the scheduler advances this session along the TIME column, no console required. */
    clockFollow: boolean("clock_follow").notNull().default(false),
    /** Clock-follow is on but held: the showcaller is stepping the cue by hand. */
    clockHold: boolean("clock_hold").notNull().default(false),
  },
  (t) => [
    uniqueIndex("one_live_session_per_rundown")
      .on(t.rundownId)
      .where(sql`${t.state} <> 'ended'`),
  ],
);

export const transitionTypes = [
  "start", "pause", "resume", "next", "prev", "jump", "stop", "fire",
  "clock_on", "clock_off", "clock_hold", "clock_release",
] as const;

export const showTransitions = pgTable("show_transitions", {
  id: id().primaryKey(),
  sessionId: text("session_id").notNull().references(() => showSessions.id),
  at: timestamp("at", { withTimezone: true }).notNull(),
  type: text("type", { enum: transitionTypes }).notNull(),
  rowId: text("row_id"),
  actorUserId: text("actor_user_id").references(() => users.id),
});

// ── Error log (server-kept; reviewed from the admin dashboard) ─────────────────

export const errorLogs = pgTable("error_logs", {
  id: id().primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  /** Where it happened: server (API), process (crash-level), client (browser). */
  source: text("source").notNull(),
  message: text("message").notNull(),
  stack: text("stack"),
  url: text("url"),
  userAgent: text("user_agent"),
  context: jsonb("context").$type<Record<string, unknown>>(),
});

// ── Per-user personalization (never in the CRDT) ───────────────────────────────

export const userRundownPrefs = pgTable(
  "user_rundown_prefs",
  {
    userId: text("user_id").notNull().references(() => users.id),
    rundownId: text("rundown_id").notNull().references(() => rundowns.id),
    columnLayout: jsonb("column_layout").$type<{ order: string[]; hidden: string[] }>(),
    theme: text("theme"),
    notes: jsonb("notes").$type<Record<string, string>>(),
    highlights: jsonb("highlights").$type<Record<string, string>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.rundownId] })],
);
