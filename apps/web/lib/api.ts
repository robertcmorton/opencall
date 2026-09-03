"use client";

import { parseCsv, parseDurationShorthand, parseTimeOfDay, type EditLockView, type EventTypeSpec } from "@opencall/core";
import { DEFAULT_COLUMNS, type SeedRow } from "@opencall/db/doc";
import { resolveSyncUrl } from "./syncUrl";

export const API_URL = resolveSyncUrl(process.env.NEXT_PUBLIC_SYNC_HTTP_URL, "http://localhost:8787");

export interface RundownSummary {
  id: string;
  eventId: string;
  name: string;
  description: string | null;
  showDate: string | null;
  archivedAt: string | null;
  /**
   * What kind of show THIS sheet is. Null inherits the event's default — one
   * match day can run two sports, so the answer lives here rather than there.
   */
  sport: string | null;
  /** Filename of the run sheet it was imported from, when it was. */
  sourceName: string | null;
}

/**
 * A company's own kind of show.
 *
 * `id` is the code a sheet stores; `rowId` is the record, which is what
 * removing one needs. They are different on purpose and both are sent.
 */
export type CustomEventType = EventTypeSpec & { rowId: string; own: boolean };

/** A run sheet kept from a past import, so the rules can be tuned against it. */
export interface ImportedSheet {
  rundownId: string;
  name: string;
  eventName: string | null;
  sport: string | null;
  sourceName: string | null;
  bytes: number;
  importedAt: string;
}

export interface EventSummary {
  id: string;
  teamId: string;
  name: string;
  location: string | null;
  image1: string | null;
  image2: string | null;
  archivedAt: string | null;
  startDate: string;
  endDate: string;
  timezone: string;
  /** Sport code ("nrl") — drives sport-specific live flows. */
  sport: string | null;
  use24h: boolean;
  rundowns: RundownSummary[];
}

/** The lock as everyone else may see it — never carrying the holder's token. */
export type EditLockStatus = EditLockView & {
  heldBy: string | null;
  sinceMs: number | null;
  lastSeenMs: number | null;
};

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
}

// ── Interim client credentials ────────────────────────────────────────────────
// Admin token (localStorage) and an optional per-page join code accompany every
// API call; the server decides what they're worth. Dev-open servers ignore both.

const ADMIN_TOKEN_KEY = "oc:admintoken";
let activeJoinCode: string | null = null;

// window-guarded: Node's experimental localStorage global exists during SSR
// but is not usable, so feature-detecting localStorage alone is not enough.
export const getAdminToken = (): string | null =>
  typeof window === "undefined" ? null : window.localStorage.getItem(ADMIN_TOKEN_KEY);
export const setAdminToken = (token: string | null): void => {
  if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  else localStorage.removeItem(ADMIN_TOKEN_KEY);
};
/** Screens that carry a ?code= call this once so panel API calls inherit it. */
export const setActiveJoinCode = (code: string | null): void => {
  activeJoinCode = code;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    /**
     * The whole of what happened: method, path, status and the raw body.
     *
     * `message` is written for the person looking at the screen, so it throws
     * all of that away. Anything diagnosing a fault wants it back — the error
     * journal, a console, a bug report — and this is where it survives.
     *
     * Defaults to `message` so an ApiError thrown by hand is never empty here.
     */
    public detail: string = message,
  ) {
    super(message);
  }
}

/**
 * The sentence to put in front of a person, given a failed response.
 *
 * The server answers a refusal with `{"error":"a real sentence"}`, and those
 * sentences are already written for a human — "someone else is editing", "that
 * email is already in use", "set ADMIN_TOKEN before changing anyone's access".
 * Screens print `ApiError.message` straight into the page, so that sentence IS
 * the message. Before, a person read `/users/01ABC…/grants: 403 {"error":"…"}`:
 * a path, a number and some JSON wrapped around the one part meant for them.
 *
 * Bodies of another shape exist and must not leak through. The sync server ends
 * an unmatched route with the two words "not found" and a caught exception with
 * "server error"; a proxy or gateway in front of the app answers with an HTML
 * page. Each of those gets a plain line instead — but only where the shape can
 * be pointed at, rather than invented copy for a status never seen arriving
 * bare. The raw body survives on `ApiError.detail` in every case.
 */
const humanMessage = (status: number, body: string): string => {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed && typeof parsed === "object") {
      const sentence = (parsed as { error?: unknown }).error;
      if (typeof sentence === "string" && sentence.trim()) return sentence.trim();
    }
  } catch {
    /* not JSON — a plain-text or HTML body, handled below */
  }
  // A 404 carrying JSON says which thing is missing and was handled above; this
  // is the bare one, where all the server said was "not found".
  if (status === 404) return "That isn't here — it may have been deleted.";
  // 5xx is the server's fault, and worth saying so: nothing the person typed
  // will change it, but trying again in a moment might.
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return "That didn't work. Try again.";
};

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const admin = getAdminToken();
  if (admin) headers.authorization = `Bearer ${admin}`;
  if (activeJoinCode) headers["x-join-code"] = activeJoinCode;
  const res = await fetch(`${API_URL}${path}`, { headers, ...init });
  if (!res.ok) {
    const detail = await res.text();
    const method = init?.method ?? "GET";
    // 401s are ordinary auth gating; anything else is journaled server-side.
    // This keeps the path, the status and the body — the journal is useless
    // without them, and the message a person reads no longer carries any.
    if (res.status !== 401 && res.status !== 404) {
      const { reportClientError } = await import("./errorReport");
      reportClientError(`API ${method} ${path} → ${res.status}: ${detail.slice(0, 300)}`);
    }
    // A 401 on a surface that needs a session may mean the session has died
    // — expired, revoked, signed out in another tab. The check decides; it
    // moves nobody whose credential still works. Imported here rather than
    // at the top because that module imports this one.
    if (res.status === 401) {
      const { onUnauthorized } = await import("./session");
      onUnauthorized(path);
    }
    throw new ApiError(humanMessage(res.status, detail), res.status, `${method} ${path} → ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
};

export interface SnapshotSummary {
  id: string;
  label: string | null;
  createdAt: string;
}

export interface JoinCodeSummary {
  id: string;
  /**
   * "join" for a view-only link; "guest" for an older guest pass.
   *
   * Guest passes are no longer issued, but ones already handed out are listed
   * so they can be revoked — which, while this endpoint filtered them out, was
   * not possible from anywhere in the app.
   */
  kind?: string;
  /** The guest-pass token, for the `/guest/<token>` URL. Guest passes only. */
  token?: string | null;
  joinCode: string | null;
  role: string;
  /** Who this code is for — the joiner's identity on every screen. */
  label: string | null;
  /** Which columns this link may show. null = the phone-shaped default. */
  columns?: Record<string, boolean> | null;
}

export const api = {
  events: (includeArchived = false) => request<EventSummary[]>(`/events${includeArchived ? "?archived=1" : ""}`),
  updateMe: (body: { name?: string; email?: string }) =>
    request<{ ok: true }>("/me", { method: "PATCH", body: JSON.stringify(body) }),
  me: () =>
    request<{
      role: "admin" | "company" | "user" | null;
      devOpen?: boolean;
      teamId?: string;
      teamName?: string;
      name?: string;
      email?: string | null;
      canManage?: boolean;
      grants?: { kind: string; targetId: string }[];
    }>("/me"),
  login: (email: string, password: string) =>
    request<{ token: string; expiresAt: string; name: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<Record<string, never>>("/auth/logout", { method: "POST" }),
  changePassword: (current: string, next: string) =>
    request<Record<string, never>>("/auth/change-password", { method: "POST", body: JSON.stringify({ current, next }) }),
  setUserPassword: (id: string, password: string) =>
    request<{ id: string }>(`/users/${id}/set-password`, { method: "POST", body: JSON.stringify({ password }) }),
  users: () =>
    request<{ id: string; name: string; email: string; accessToken: string | null; hasPassword: boolean; grants: { kind: string; targetId: string }[] }[]>(
      "/users",
    ),
  createUser: (body: { name: string; email?: string; password?: string; grants: { kind: string; targetId?: string }[] }) =>
    request<{ id: string; accessToken: string }>("/users", { method: "POST", body: JSON.stringify(body) }),
  patchUser: (id: string, body: { name?: string; grants?: { kind: string; targetId?: string }[] }) =>
    request<{ id: string }>(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  rotateUserToken: (id: string) => request<{ id: string; accessToken: string }>(`/users/${id}/rotate-token`, { method: "POST" }),
  deleteUser: (id: string) => request<{ id: string }>(`/users/${id}`, { method: "DELETE" }),
  archiveEvent: (id: string, archived: boolean) =>
    request<{ id: string }>(`/events/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  archiveRundown: (id: string, archived: boolean) =>
    request<{ id: string }>(`/rundowns/${id}/archive`, { method: "POST", body: JSON.stringify({ archived }) }),
  companies: () =>
    request<{ id: string; name: string; companyToken: string | null; logo: string | null; eventCount: number }[]>(
      "/companies",
    ),
  createCompany: (name: string) =>
    request<{ id: string; companyToken: string }>("/companies", { method: "POST", body: JSON.stringify({ name }) }),
  rotateCompanyToken: (id: string) =>
    request<{ id: string; companyToken: string }>(`/companies/${id}/rotate-token`, { method: "POST" }),
  deleteCompany: (id: string) => request<{ id: string }>(`/companies/${id}`, { method: "DELETE" }),
  patchCompany: (id: string, body: { name?: string; logo?: string | null }) =>
    request<{ id: string }>(`/companies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  joinCodes: (rundownId: string) => request<JoinCodeSummary[]>(`/rundowns/${rundownId}/join-codes`),
  createJoinCode: (rundownId: string, role: "caller" | "editor" | "follower", label?: string) =>
    request<{ code: string; role: string; label: string | null }>(`/rundowns/${rundownId}/join-codes`, {
      method: "POST",
      body: JSON.stringify({ role, label }),
    }),
  /** Which columns a view-only link may show. null = the default. */
  setCodeColumns: (rundownId: string, codeId: string, columns: string[] | null) =>
    request<{ ok: true }>(`/rundowns/${rundownId}/join-codes/${codeId}`, { method: "PATCH", body: JSON.stringify({ columns }) }),
  revokeJoinCode: (rundownId: string, codeId: string) =>
    request<{ id: string }>(`/rundowns/${rundownId}/join-codes/${codeId}`, { method: "DELETE" }),
  snapshots: (rundownId: string) => request<SnapshotSummary[]>(`/rundowns/${rundownId}/snapshots`),
  createSnapshot: (rundownId: string, label?: string) =>
    request<{ id: string }>(`/rundowns/${rundownId}/snapshots`, { method: "POST", body: JSON.stringify({ label }) }),
  restoreSnapshot: (snapshotId: string, name?: string) =>
    request<{ id: string }>(`/snapshots/${snapshotId}/restore`, { method: "POST", body: JSON.stringify({ name }) }),
  restoreSnapshotInPlace: (snapshotId: string) =>
    request<{ id: string; epoch: number }>(`/snapshots/${snapshotId}/restore-in-place`, { method: "POST" }),
  createEvent: (body: { name: string; location?: string; startDate: string; endDate: string; timezone?: string; sport?: string | null; teamId?: string }) =>
    request<{ id: string }>("/events", { method: "POST", body: JSON.stringify(body) }),
  createRundown: (body: {
    eventId: string;
    name: string;
    /** What kind of show this SHEET is. Omitted inherits the event's default. */
    sport?: string | null;
    description?: string;
    showDate?: string;
    plannedStartSec?: number | null;
    templateId?: string;
    rows?: SeedRow[];
    columns?: { key: string; title: string; width?: number }[];
    roles?: { name: string; color: string }[];
    roleColumnKey?: string | null;
    roleColumnKeys?: string[];
    sourceName?: string;
    sourceFileB64?: string;
    baseTitles?: { title?: string; start?: string; duration?: string };
      showInfo?: { kind: string; lines: string[] }[];
    columnOrder?: string[];
  }) => request<{ id: string }>("/rundowns", { method: "POST", body: JSON.stringify(body) }),
  replaceRundownContent: (
    id: string,
    body: {
      rows: SeedRow[];
      columns?: { key: string; title: string; width?: number }[];
      roles?: { name: string; color: string }[];
      roleColumnKey?: string | null;
    roleColumnKeys?: string[];
      plannedStartSec?: number | null;
      sourceName?: string;
      sourceFileB64?: string;
      baseTitles?: { title?: string; start?: string; duration?: string };
      showInfo?: { kind: string; lines: string[] }[];
      columnOrder?: string[];
    },
  ) => request<{ id: string; epoch: number }>(`/rundowns/${id}/replace-content`, { method: "POST", body: JSON.stringify(body) }),
  errors: (limit = 200) =>
    request<{ id: string; at: string; source: string; message: string; stack: string | null; url: string | null; userAgent: string | null }[]>(
      `/errors?limit=${limit}`,
    ),
  clearErrors: () => request<Record<string, never>>("/errors", { method: "DELETE" }),
  templates: () => request<TemplateSummary[]>("/templates"),
  /**
   * A note raised against one row, by somebody holding a view-only link.
   *
   * The join code is the authority: whoever can read the sheet can flag a line
   * on it. Name and role are what the viewer told the sheet, not credentials —
   * the same self-declared pair the viewer list already shows.
   */
  raiseNote: (code: string, body: { rowId: string; byName?: string | null; byRole?: string | null; body?: string | null }) =>
    request<{ id: string }>(`/codes/${encodeURIComponent(code)}/notes`, { method: "POST", body: JSON.stringify(body) }),
  /** Every note on a sheet, newest first — for whoever is calling it. */
  notes: (rundownId: string) =>
    request<
      { id: string; rowId: string; at: string; byName: string | null; byRole: string | null; body: string | null; resolvedAt: string | null }[]
    >(`/rundowns/${encodeURIComponent(rundownId)}/notes`),
  /** Dealt with. Resolved, not deleted — see the note on the endpoint. */
  resolveNote: (noteId: string) => request<{ id: string }>(`/notes/${encodeURIComponent(noteId)}/resolve`, { method: "POST" }),
  /** "This is me, on this device" — sent once a view-only link has a name. */
  recordViewer: (
    code: string,
    body: { name: string; deviceId: string; browser: string; os: string; screen: string; roles?: string[] },
  ) =>
    request<{ ok: true; rundownId: string }>(`/codes/${encodeURIComponent(code)}/viewer`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Who has this run sheet open on a view-only link. */
  viewers: (rundownId: string) =>
    request<
      {
        id: string;
        name: string;
        roles: string | null;
        link: string | null;
        browser: string | null;
        os: string | null;
        screen: string | null;
        ip: string | null;
        firstSeenAt: string;
        lastSeenAt: string;
      }[]
    >(`/rundowns/${rundownId}/viewers`),
  // ── People and invitations ──
  /** Everyone this credential administers, and the invitations still open. */
  people: () =>
    request<{
      people: { id: string; name: string; email: string; hasPassword: boolean; grants: { kind: string; targetId: string }[] }[];
      invites: { id: string; email: string; name: string | null; grants: { kind: string; targetId: string }[]; expiresAt: string; url: string }[];
      mailConfigured: boolean;
    }>("/people"),
  /**
   * The caller's own companies, by name.
   *
   * Not `companies()` — that one is admin-only because every row it returns
   * carries the company's sign-in token. This carries names and nothing else,
   * so somebody put in charge of two companies can be asked which they mean.
   */
  myCompanies: () => request<{ id: string; name: string }[]>("/my-companies"),
  /**
   * Change one person's access.
   *
   * The list describes only the part of their access YOU can see; the server
   * keeps the rest and works out the removals itself. So this cannot disturb
   * the other companies somebody works for, and does not need to know they are
   * there.
   */
  patchUserGrants: (id: string, grants: { kind: string; targetId: string }[]) =>
    request<{ id: string; added: number; removed: number }>(`/users/${id}/grants`, {
      method: "PATCH",
      body: JSON.stringify({ grants }),
    }),
  invite: (token: string) =>
    request<{ email: string; name: string | null; company: string | null; access: string }>(`/invites/${encodeURIComponent(token)}`),
  createInvite: (body: { email: string; name?: string; grants: { kind: string; targetId: string }[] }) =>
    request<{ id?: string; url?: string; emailed?: boolean; reason?: string; added?: boolean; name?: string }>("/invites", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  revokeInvite: (id: string) => request<{ ok: true }>(`/invites/${id}`, { method: "DELETE" }),
  acceptInvite: (token: string, body: { name: string; password: string }) =>
    request<{ token: string; expiresAt: string; name: string }>(`/invites/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  /** Close the sheet to its audience once the event is done, or open it again. */
  setViewing: (rundownId: string, closed: boolean) =>
    request<{ closed: boolean }>(`/rundowns/${rundownId}/viewing`, { method: "POST", body: JSON.stringify({ closed }) }),
  rundownEpoch: (rundownId: string) =>
    request<{ epoch: number; viewingClosed: boolean }>(`/rundowns/${rundownId}/epoch`),
  saveTemplate: (body: { rundownId: string; name: string }) =>
    request<{ id: string }>("/templates", { method: "POST", body: JSON.stringify(body) }),
  // ── Landing & admin ──
  resolveCode: (code: string) =>
    request<{ role: "caller" | "editor" | "follower"; rundownId: string; columns: Record<string, boolean> | null }>(
      `/codes/${encodeURIComponent(code)}`,
    ),
  /**
   * Shows that have not been stopped — with how long since anybody touched
   * each one, and whether that is long enough to doubt it is really on.
   * Nothing ends a session but Stop, so "running" alone can mean "somebody
   * once pressed start".
   */
  live: () =>
    request<
      { rundownId: string; state: string; startedAt: string; lastMoveAt: string; stale: boolean }[]
    >("/live"),
  patchEvent: (id: string, body: { name?: string; location?: string; timezone?: string; startDate?: string; endDate?: string; sport?: string | null; image1?: string | null; image2?: string | null }) =>
    request<{ id: string }>(`/events/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEvent: (id: string) => request<{ id: string }>(`/events/${id}`, { method: "DELETE" }),
  patchRundown: (id: string, body: { name?: string; sport?: string | null }) =>
    request<{ id: string }>(`/rundowns/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  /** Kinds of show a company added for itself, on top of the built-in list. */
  eventTypes: (teamId?: string) =>
    request<{ types: CustomEventType[] }>(`/event-types${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ""}`).then(
      (r) => r.types,
    ),
  createEventType: (body: {
    label: string;
    fullTime: string[];
    afterExtra: string[];
    extraLabel?: string | null;
    resultDuePhrases?: string[];
    blurb?: string | null;
    teamId?: string;
  }) => request<{ id: string; code: string }>("/event-types", { method: "POST", body: JSON.stringify(body) }),
  deleteEventType: (id: string) => request<{ ok: true }>(`/event-types/${id}`, { method: "DELETE" }),
  /** Run sheets kept from past imports, with the kind of show each was for. */
  importedSheets: () =>
    request<{ sheets: ImportedSheet[] }>("/imported-sheets").then((r) => r.sheets),
  /** Who is editing this sheet, if anybody. Safe to poll — it changes nothing. */
  editLock: (id: string) =>
    request<{ lock: EditLockStatus; mine: boolean }>(`/rundowns/${id}/lock`).then((r) => ({
      view: r.lock as unknown as EditLockView,
      // The SERVER decides whether this is you, by identity. The client cannot:
      // a second tab has its own token and would otherwise conclude that you
      // are somebody else.
      mine: r.mine,
    })),
  /** Take it, or keep it: re-claiming with your own token is the heartbeat. */
  claimEditLock: (id: string, token: string | null) =>
    request<{ token: string }>(`/rundowns/${id}/lock`, {
      method: "POST",
      body: JSON.stringify(token ? { token } : {}),
    }),
  releaseEditLock: (id: string, token: string) =>
    request<{ lock: EditLockStatus }>(`/rundowns/${id}/lock`, { method: "DELETE", body: JSON.stringify({ token }) }),
  /**
   * Hand it back as the tab closes.
   *
   * `keepalive` so the request survives the page going away — an ordinary
   * fetch is cancelled on unload, which is precisely when a lock most needs
   * releasing.
   */
  releaseEditLockBeacon: (id: string, token: string): void => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const admin = getAdminToken();
    if (admin) headers.authorization = `Bearer ${admin}`;
    void fetch(`${API_URL}/rundowns/${id}/lock`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ token }),
      keepalive: true,
    }).catch(() => undefined);
  },
  deleteRundown: (id: string) => request<Record<string, never>>(`/rundowns/${id}`, { method: "DELETE" }),
  duplicateRundown: (id: string) => request<{ id: string }>(`/rundowns/${id}/duplicate`, { method: "POST" }),
};

/** The stored source sheet of a rundown, as a File — or null when none was kept. */
export async function fetchRundownSource(rundownId: string): Promise<File | null> {
  const headers: Record<string, string> = {};
  const admin = getAdminToken();
  if (admin) headers.authorization = `Bearer ${admin}`;
  const res = await fetch(`${API_URL}/rundowns/${rundownId}/source`, { headers });
  if (!res.ok) return null;
  const name = decodeURIComponent(res.headers.get("x-source-name") ?? "sheet.pdf");
  return new File([await res.blob()], name);
}

/**
 * One-click share: a view-only URL for a rundown (camera operators, crew).
 * Reuses the rundown's existing follower join code or mints one, then copies
 * `/view/<id>?code=…` to the clipboard. Anyone with the link can watch —
 * revoke by rotating join codes.
 */
export async function copyViewOnlyLink(rundownId: string): Promise<string> {
  const codes = await api.joinCodes(rundownId);
  let code = codes.find((c) => c.role === "follower")?.joinCode ?? null;
  if (!code) code = (await api.createJoinCode(rundownId, "follower")).code;
  const url = `${window.location.origin}/view/${rundownId}?code=${encodeURIComponent(code)}`;
  /**
   * The LINK is the product; putting it on the clipboard is a convenience.
   *
   * `writeText` rejects in more situations than it looks: no permission, an
   * insecure context, a browser that wants the write closer to the click. When
   * it did, this threw — and the caller lost the URL, even though the link had
   * already been created on the server a line earlier. So a crew got nothing,
   * for a failure that had nothing to do with whether they can watch the show.
   * The URL is returned either way, and the panel shows it to copy by hand.
   */
  await navigator.clipboard?.writeText(url).catch(() => undefined);
  return url;
}

/**
 * CSV → seed rows. Header row required; "Title" and "Duration" are structural,
 * "Start" anchors a row, "Type"=group makes headers; other headers map onto the
 * default department columns by name (unknown headers are ignored).
 */
export function csvToSeedRows(text: string): { rows: SeedRow[]; skippedHeaders: string[] } {
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], skippedHeaders: [] };
  const headers = grid[0]!.map((h) => h.trim().toLowerCase());
  const keyByTitle = new Map(DEFAULT_COLUMNS.map((c) => [c.title.toLowerCase(), c.key]));
  const skippedHeaders: string[] = [];

  const mapping = headers.map((header) => {
    if (["title", "item", "name"].includes(header)) return { kind: "title" as const };
    if (header === "duration") return { kind: "duration" as const };
    if (["start", "start time"].includes(header)) return { kind: "start" as const };
    if (header === "type") return { kind: "type" as const };
    const key = keyByTitle.get(header);
    if (key && !["title", "start", "duration"].includes(key)) return { kind: "cell" as const, key };
    skippedHeaders.push(header);
    return { kind: "skip" as const };
  });

  const rows: SeedRow[] = [];
  for (const record of grid.slice(1)) {
    const row: SeedRow = { type: "cue", title: "", cells: {} };
    record.forEach((value, i) => {
      const m = mapping[i];
      const v = value.trim();
      if (!m || !v) return;
      if (m.kind === "title") row.title = v;
      else if (m.kind === "duration") row.durationSec = parseDurationShorthand(v);
      else if (m.kind === "start") row.hardStartSec = parseTimeOfDay(v);
      else if (m.kind === "type" && v.toLowerCase() === "group") row.type = "group";
      else if (m.kind === "cell") row.cells![m.key] = v;
    });
    if (row.title) rows.push(row);
  }
  return { rows, skippedHeaders };
}
