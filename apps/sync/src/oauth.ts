import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { schema, type DbHandle } from "@opencall/db";

/**
 * How an AI assistant signs in to OpenCall: OAuth 2.1 with PKCE, as Kitshare
 * does it. The assistant registers itself, sends the person to OpenCall's own
 * approval page, and then holds short-lived tokens tied to that approval.
 *
 * - Codes live 5 minutes, access tokens an hour, refresh tokens 30 days; a
 *   connection ends 90 days after it was approved, whatever its tokens say.
 * - Every code and token is 32 random bytes, stored only as its SHA-256.
 * - Each is used once: a code or refresh token presented twice means it was
 *   stolen, and every token of that connection is revoked.
 * - PKCE (S256) is required; nothing is issued without it.
 */

export const SCOPES = {
  "sheets:read": { title: "Read your run sheets", detail: "See the shows and run sheets you can open, with their times and every column." },
  "sheets:write": {
    title: "Change your run sheets",
    detail: "Edit, add, move, strike and delete rows on sheets you are allowed to edit. It can never start, step or stop a show.",
  },
  "errors:read": {
    title: "Read the error log",
    detail: "See the server's error log, to check the app is healthy. Read only — it cannot clear or change it.",
  },
} as const;
export type Scope = keyof typeof SCOPES;
export const ALL_SCOPES = Object.keys(SCOPES) as Scope[];

export const TTL = {
  codeSec: 300,
  accessSec: 3600,
  refreshSec: 30 * 24 * 3600,
  connectionSec: 90 * 24 * 3600,
} as const;

const sha = (v: string) => createHash("sha256").update(v).digest("base64url");
const random = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

export class OAuthError extends Error {
  code: string;
  description: string;
  status: number;
  constructor(code: string, description: string, status = 400) {
    super(description);
    this.code = code;
    this.description = description;
    this.status = status;
  }
}

// ── Where things are ─────────────────────────────────────────────────────────

/** This server's own public address, from the platform's forwarding headers. */
export function syncBase(req: IncomingMessage): string {
  const configured = process.env.PUBLIC_SYNC_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() || "http";
  const host = String(req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:8787").split(",")[0]!.trim();
  return `${proto}://${host}`;
}

/** The web app, where the approval page is (people are signed in there). */
export function webBase(): string {
  return (process.env.PUBLIC_WEB_URL?.trim() || "http://localhost:3010").replace(/\/$/, "");
}

export function protectedResourceMetadata(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "OpenCall",
    resource_documentation: `${webBase()}/account`,
  };
}

export function authorizationServerMetadata(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${webBase()}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${webBase()}/account`,
  };
}

/** The 401 an unauthenticated /mcp call gets: where to find out how to sign in. */
export function wwwAuthenticate(base: string, error?: { code: string; description: string }, scope?: string): string {
  const parts = [`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`, `scope="${scope ?? ALL_SCOPES.join(" ")}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(", ")}`;
}

// ── Redirect addresses ───────────────────────────────────────────────────────

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https anywhere, or http on this machine only; no fragment, no credentials. */
export function redirectUriProblem(uri: string): string | null {
  if (uri.length > 2000) return "redirect_uri is too long";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "redirect_uri is not a URL";
  }
  if (url.hash) return "redirect_uri must not have a fragment";
  if (url.username || url.password) return "redirect_uri must not carry credentials";
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && LOOPBACK.has(url.hostname)) return null;
  return "redirect_uri must be https (or http on localhost)";
}

/** Exact match, except a loopback address may use any port (RFC 8252). */
export function redirectMatches(registered: string[], given: string): boolean {
  if (registered.includes(given)) return true;
  let g: URL;
  try {
    g = new URL(given);
  } catch {
    return false;
  }
  if (!LOOPBACK.has(g.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return LOOPBACK.has(u.hostname) && u.protocol === g.protocol && u.hostname === g.hostname && u.pathname === g.pathname && u.search === g.search;
    } catch {
      return false;
    }
  });
}

// ── Registration (RFC 7591) ──────────────────────────────────────────────────

export async function registerClient(handle: DbHandle, body: Record<string, unknown>) {
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (uris.length < 1 || uris.length > 10) throw new OAuthError("invalid_redirect_uri", "Give between 1 and 10 redirect_uris.");
  for (const u of uris) {
    const problem = redirectUriProblem(u);
    if (problem) throw new OAuthError("invalid_redirect_uri", problem);
  }
  const grantTypes = Array.isArray(body.grant_types) ? body.grant_types.map(String) : ["authorization_code", "refresh_token"];
  if (!grantTypes.every((g) => g === "authorization_code" || g === "refresh_token")) {
    throw new OAuthError("invalid_client_metadata", "Only authorization_code and refresh_token are supported.");
  }
  const responseTypes = Array.isArray(body.response_types) ? body.response_types.map(String) : ["code"];
  if (!responseTypes.every((r) => r === "code")) throw new OAuthError("invalid_client_metadata", "Only the code response type is supported.");
  const method = String(body.token_endpoint_auth_method ?? "client_secret_basic");
  if (!["none", "client_secret_post", "client_secret_basic"].includes(method)) {
    throw new OAuthError("invalid_client_metadata", "Unsupported token_endpoint_auth_method.");
  }
  const name = String(body.client_name ?? "An AI assistant").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100) || "An AI assistant";
  const clientUri = typeof body.client_uri === "string" && body.client_uri.startsWith("https://") ? body.client_uri.slice(0, 500) : null;
  const id = `mcp_${randomBytes(16).toString("base64url")}`;
  const secret = method === "none" ? null : random("mcp_cs_");
  await handle.db.insert(schema.mcpClients).values({ id, name, uri: clientUri, redirectUris: uris, authMethod: method, secretHash: secret ? sha(secret) : null });
  // Registrations nobody approved within a day are tidied away now and then.
  if (Math.random() < 0.05) {
    void handle.db
      .execute(sql`DELETE FROM mcp_clients c WHERE c.created_at < now() - interval '1 day' AND c.last_used_at IS NULL AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id = c.id)`)
      .catch(() => {});
  }
  return {
    client_id: id,
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: grantTypes,
    response_types: ["code"],
    token_endpoint_auth_method: method,
  };
}

// ── Approval (the authorize step) ────────────────────────────────────────────

export interface AuthorizeRequest {
  client_id?: string;
  redirect_uri?: string;
  response_type?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  resource?: string;
}

/**
 * Checks an authorize request. Problems with the client or its redirect are
 * shown on OpenCall's page and never followed; everything else goes back to
 * the assistant as an OAuth error on its own redirect.
 */
export async function checkAuthorize(handle: DbHandle, base: string, p: AuthorizeRequest) {
  const client = p.client_id ? await handle.db.query.mcpClients.findFirst({ where: eq(schema.mcpClients.id, p.client_id) }) : null;
  if (!client) return { fatal: "This assistant is not registered with OpenCall. Start the connection again from the assistant." } as const;
  let redirect = p.redirect_uri;
  if (!redirect) {
    const external = client.redirectUris.filter((u) => {
      try {
        return !LOOPBACK.has(new URL(u).hostname);
      } catch {
        return false;
      }
    });
    if (external.length === 1) redirect = external[0];
  }
  if (!redirect || !redirectMatches(client.redirectUris, redirect)) {
    return { fatal: "The address this assistant wants to return to is not one it registered. Nothing was sent." } as const;
  }
  const back = (code: string, description: string) => ({ redirectError: errorRedirect(redirect!, base, p.state, code, description) }) as const;
  if ((p.state ?? "").length > 2000) return back("invalid_request", "state is too long");
  if (p.response_type !== "code") return back("unsupported_response_type", "Only response_type=code is supported.");
  if (p.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge ?? "")) {
    return back("invalid_request", "PKCE with S256 is required.");
  }
  if (p.resource && p.resource.replace(/\/$/, "") !== `${base}/mcp`) return back("invalid_target", "That resource is not OpenCall's.");
  const asked = (p.scope ?? "").split(/\s+/).filter(Boolean);
  const scopes = asked.length === 0 ? ALL_SCOPES : (asked.filter((s) => s in SCOPES) as Scope[]);
  if (scopes.length === 0) return back("invalid_scope", "None of the requested scopes exist.");
  let host: string | null = null;
  try {
    host = new URL(redirect).host;
  } catch {
    /* checked above */
  }
  return {
    ok: {
      clientId: client.id,
      clientName: client.name,
      redirectUri: redirect,
      redirectGiven: Boolean(p.redirect_uri),
      host,
      loopbackOnly: client.redirectUris.every((u) => {
        try {
          return LOOPBACK.has(new URL(u).hostname);
        } catch {
          return false;
        }
      }),
      scopes,
      state: p.state ?? null,
      codeChallenge: p.code_challenge!,
    },
  } as const;
}

function errorRedirect(redirect: string, base: string, state: string | undefined, code: string, description: string): string {
  const u = new URL(redirect);
  u.searchParams.set("error", code);
  u.searchParams.set("error_description", description);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", base);
  return u.toString();
}

/**
 * The person's answer. Allow: one active approval per (person, assistant) —
 * approving again replaces its scopes and restarts its 90 days — and a code
 * for the assistant. Deny: access_denied. Returns where to send the browser.
 */
export async function decideAuthorize(
  handle: DbHandle,
  base: string,
  userId: string,
  p: AuthorizeRequest,
  allow: boolean,
  ticked: string[],
): Promise<{ redirect: string; grantId?: string; clientName?: string }> {
  const checked = await checkAuthorize(handle, base, p);
  if ("fatal" in checked) throw new OAuthError("invalid_request", checked.fatal!);
  if ("redirectError" in checked) return { redirect: checked.redirectError! };
  const ok = checked.ok!;
  if (!allow) return { redirect: errorRedirect(ok.redirectUri, base, p.state, "access_denied", "The person declined.") };
  const scopes = ok.scopes.filter((s) => ticked.includes(s));
  if (scopes.length === 0) throw new OAuthError("invalid_scope", "Tick at least one permission, or choose Deny.");
  const existing = await handle.db.query.mcpGrants.findFirst({
    where: and(eq(schema.mcpGrants.userId, userId), eq(schema.mcpGrants.clientId, ok.clientId), isNull(schema.mcpGrants.revokedAt)),
  });
  let grantId: string;
  if (existing) {
    grantId = existing.id;
    await handle.db.update(schema.mcpGrants).set({ scopes, authorizedAt: new Date(), clientName: ok.clientName, clientHost: ok.host }).where(eq(schema.mcpGrants.id, grantId));
  } else {
    grantId = ulid();
    await handle.db.insert(schema.mcpGrants).values({ id: grantId, userId, clientId: ok.clientId, clientName: ok.clientName, clientHost: ok.host, scopes });
  }
  const code = random("mcp_code_");
  await handle.db.insert(schema.mcpTokens).values({
    id: ulid(),
    hash: sha(code),
    kind: "code",
    grantId,
    scopes,
    redirectUri: ok.redirectGiven ? ok.redirectUri : null,
    codeChallenge: ok.codeChallenge,
    expiresAt: new Date(Date.now() + TTL.codeSec * 1000),
  });
  const u = new URL(ok.redirectUri);
  u.searchParams.set("code", code);
  if (p.state) u.searchParams.set("state", p.state);
  u.searchParams.set("iss", base);
  return { redirect: u.toString(), grantId, clientName: ok.clientName };
}

// ── Tokens ───────────────────────────────────────────────────────────────────

/** Who is calling the token endpoint: a public client by id, or one with its secret. */
async function authenticateClient(handle: DbHandle, req: IncomingMessage, form: Record<string, string>) {
  let id = form.client_id;
  let secret = form.client_secret;
  const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ""))?.[1];
  if (basic) {
    const [bid, bsecret] = Buffer.from(basic, "base64").toString("utf8").split(":").map((v) => decodeURIComponent(v ?? ""));
    if (id && id !== bid) throw new OAuthError("invalid_client", "client_id does not match the Basic credentials.", 401);
    id = bid;
    secret = bsecret;
  }
  const client = id ? await handle.db.query.mcpClients.findFirst({ where: eq(schema.mcpClients.id, id) }) : null;
  if (!client) throw new OAuthError("invalid_client", "Unknown client.", 401);
  if (client.authMethod !== "none") {
    const given = Buffer.from(sha(secret ?? ""));
    const stored = Buffer.from(client.secretHash ?? "");
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) throw new OAuthError("invalid_client", "Wrong client secret.", 401);
  }
  return client;
}

/** Marks a code or refresh token used, if nobody has; true when this call won. */
async function claimOnce(handle: DbHandle, tokenId: string): Promise<boolean> {
  const won = await handle.db
    .update(schema.mcpTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.mcpTokens.id, tokenId), isNull(schema.mcpTokens.usedAt), isNull(schema.mcpTokens.revokedAt)))
    .returning();
  return won.length === 1;
}

/** Ends a connection and every token under it. */
export async function revokeGrant(handle: DbHandle, grantId: string): Promise<void> {
  await handle.db.update(schema.mcpGrants).set({ revokedAt: new Date() }).where(eq(schema.mcpGrants.id, grantId));
  await handle.db.update(schema.mcpTokens).set({ revokedAt: new Date() }).where(eq(schema.mcpTokens.grantId, grantId));
}

/** Ends every assistant connection a person has (password change, reset, account deleted). */
export async function revokeUserGrants(handle: DbHandle, userId: string): Promise<void> {
  const grants = await handle.db.query.mcpGrants.findMany({ where: and(eq(schema.mcpGrants.userId, userId), isNull(schema.mcpGrants.revokedAt)) });
  for (const g of grants) await revokeGrant(handle, g.id);
}

async function issueTokens(handle: DbHandle, grant: typeof schema.mcpGrants.$inferSelect, scopes: string[]) {
  const connectionEnds = grant.authorizedAt.getTime() + TTL.connectionSec * 1000;
  const accessEnds = Math.min(Date.now() + TTL.accessSec * 1000, connectionEnds);
  const refreshEnds = Math.min(Date.now() + TTL.refreshSec * 1000, connectionEnds);
  const access = random("mcp_at_");
  const refresh = random("mcp_rt_");
  await handle.db.insert(schema.mcpTokens).values([
    { id: ulid(), hash: sha(access), kind: "access", grantId: grant.id, scopes, expiresAt: new Date(accessEnds) },
    { id: ulid(), hash: sha(refresh), kind: "refresh", grantId: grant.id, scopes, expiresAt: new Date(refreshEnds) },
  ]);
  // Now and then, expired tokens over a day old are tidied away.
  if (Math.random() < 0.02) void handle.db.delete(schema.mcpTokens).where(lt(schema.mcpTokens.expiresAt, new Date(Date.now() - 86400_000))).catch(() => {});
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(1, Math.floor((accessEnds - Date.now()) / 1000)),
    refresh_token: refresh,
    scope: scopes.join(" "),
  };
}

export async function exchangeToken(handle: DbHandle, req: IncomingMessage, base: string, form: Record<string, string>, userAllowed: (userId: string) => Promise<boolean>) {
  const client = await authenticateClient(handle, req, form);
  const grantType = form.grant_type;
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    throw new OAuthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
  }
  const presented = grantType === "authorization_code" ? form.code : form.refresh_token;
  if (!presented) throw new OAuthError("invalid_request", grantType === "authorization_code" ? "code is missing." : "refresh_token is missing.");
  const row = await handle.db.query.mcpTokens.findFirst({
    where: and(eq(schema.mcpTokens.hash, sha(presented)), eq(schema.mcpTokens.kind, grantType === "authorization_code" ? "code" : "refresh")),
  });
  const grant = row ? await handle.db.query.mcpGrants.findFirst({ where: eq(schema.mcpGrants.id, row.grantId) }) : null;
  if (!row || !grant || grant.clientId !== client.id) throw new OAuthError("invalid_grant", "Unknown or expired grant.");
  // Presented before: it was copied. Everything under the connection ends.
  if (row.usedAt) {
    await revokeGrant(handle, grant.id);
    throw new OAuthError("invalid_grant", "This grant was already used; the connection has been ended.");
  }
  if (row.revokedAt || grant.revokedAt || row.expiresAt < new Date()) throw new OAuthError("invalid_grant", "Unknown or expired grant.");
  if (Date.now() > grant.authorizedAt.getTime() + TTL.connectionSec * 1000) throw new OAuthError("invalid_grant", "This connection has ended; connect again.");
  if (form.resource && form.resource.replace(/\/$/, "") !== `${base}/mcp`) throw new OAuthError("invalid_target", "That resource is not OpenCall's.");
  let scopes = row.scopes.filter((s) => grant.scopes.includes(s));
  if (grantType === "authorization_code") {
    if (row.redirectUri && form.redirect_uri !== row.redirectUri) throw new OAuthError("invalid_grant", "redirect_uri does not match.");
    const verifier = form.code_verifier ?? "";
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) throw new OAuthError("invalid_grant", "code_verifier is missing or malformed.");
    const a = Buffer.from(sha(verifier));
    const b = Buffer.from(row.codeChallenge ?? "");
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new OAuthError("invalid_grant", "code_verifier does not match.");
  } else if (form.scope) {
    const narrowed = form.scope.split(/\s+/).filter((s) => scopes.includes(s));
    if (narrowed.length === 0) throw new OAuthError("invalid_scope", "A refresh can only keep or narrow the scopes.");
    scopes = narrowed;
  }
  if (!(await userAllowed(grant.userId))) throw new OAuthError("invalid_grant", "This account can no longer connect assistants.");
  if (!(await claimOnce(handle, row.id))) {
    await revokeGrant(handle, grant.id);
    throw new OAuthError("invalid_grant", "This grant was already used; the connection has been ended.");
  }
  await handle.db.update(schema.mcpClients).set({ lastUsedAt: new Date() }).where(eq(schema.mcpClients.id, client.id));
  return issueTokens(handle, grant, scopes);
}

/** RFC 7009: always succeeds. A refresh token ends its whole connection. */
export async function revokeToken(handle: DbHandle, req: IncomingMessage, form: Record<string, string>): Promise<{ grantId?: string; userId?: string; clientName?: string } | null> {
  const client = await authenticateClient(handle, req, form);
  if (!form.token) return null;
  const row = await handle.db.query.mcpTokens.findFirst({ where: eq(schema.mcpTokens.hash, sha(form.token)) });
  if (!row) return null;
  const grant = await handle.db.query.mcpGrants.findFirst({ where: eq(schema.mcpGrants.id, row.grantId) });
  if (!grant || grant.clientId !== client.id) return null;
  if (row.kind === "refresh") {
    await revokeGrant(handle, grant.id);
    return { grantId: grant.id, userId: grant.userId, clientName: grant.clientName };
  }
  await handle.db.update(schema.mcpTokens).set({ revokedAt: new Date() }).where(eq(schema.mcpTokens.id, row.id));
  return null;
}

export interface McpCaller {
  userId: string;
  grantId: string;
  clientName: string;
  scopes: Scope[];
}

/** The person and connection behind an access token, or why there is none. */
export async function verifyAccessToken(handle: DbHandle, token: string): Promise<McpCaller | { error: string }> {
  const row = await handle.db.query.mcpTokens.findFirst({ where: and(eq(schema.mcpTokens.hash, sha(token)), eq(schema.mcpTokens.kind, "access")) });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return { error: "The access token is invalid or has expired." };
  const grant = await handle.db.query.mcpGrants.findFirst({ where: eq(schema.mcpGrants.id, row.grantId) });
  if (!grant || grant.revokedAt) return { error: "This connection has been ended." };
  if (Date.now() > grant.authorizedAt.getTime() + TTL.connectionSec * 1000) return { error: "This connection has ended; connect again." };
  // Last used, at most once a minute.
  if (!grant.lastUsedAt || Date.now() - grant.lastUsedAt.getTime() > 60_000) {
    void handle.db.update(schema.mcpGrants).set({ lastUsedAt: new Date() }).where(eq(schema.mcpGrants.id, grant.id)).catch(() => {});
  }
  const scopes = row.scopes.filter((s) => grant.scopes.includes(s)) as Scope[];
  return { userId: grant.userId, grantId: grant.id, clientName: grant.clientName, scopes };
}

/** A person's active assistant connections, for My account. */
export async function listConnections(handle: DbHandle, userId: string) {
  const grants = await handle.db.query.mcpGrants.findMany({
    where: and(eq(schema.mcpGrants.userId, userId), isNull(schema.mcpGrants.revokedAt), gt(schema.mcpGrants.authorizedAt, new Date(Date.now() - TTL.connectionSec * 1000))),
  });
  return grants.map((g) => ({
    id: g.id,
    name: g.clientName,
    host: g.clientHost,
    scopes: g.scopes,
    connectedAt: g.createdAt.toISOString(),
    lastUsedAt: g.lastUsedAt?.toISOString() ?? null,
    endsAt: new Date(g.authorizedAt.getTime() + TTL.connectionSec * 1000).toISOString(),
  }));
}

/** Parse an application/x-www-form-urlencoded or JSON body; a field sent twice is dropped. */
export function parseForm(raw: string, contentType: string | undefined): Record<string, string> {
  if ((contentType ?? "").includes("application/json")) {
    const v = JSON.parse(raw || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === "string")) as Record<string, string>;
  }
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key);
    if (all.length === 1) out[key] = all[0]!;
  }
  return out;
}

export const _test = { sha };
