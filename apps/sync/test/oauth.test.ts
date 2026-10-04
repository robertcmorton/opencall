import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createDb, ensureSchema, type DbHandle } from "@opencall/db";
import {
  checkAuthorize,
  decideAuthorize,
  exchangeToken,
  listConnections,
  OAuthError,
  redirectMatches,
  redirectUriProblem,
  registerClient,
  revokeToken,
  revokeUserGrants,
  verifyAccessToken,
} from "../src/oauth";

const BASE = "https://sync.example.test";
const CALLBACK = "https://assistant.example.test/callback";
const req = { headers: {} } as IncomingMessage;
const allowAll = async () => true;

let handle: DbHandle;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "oc-oauth-"));
  handle = await createDb(undefined, dir);
  await ensureSchema(handle.db);
  await handle.db.execute(sql`INSERT INTO users (id, email, name) VALUES ('u1', 'one@example.com', 'One'), ('u2', 'two@example.com', 'Two')`);
}, 60_000);
afterAll(async () => {
  await handle?.close();
  rmSync(dir, { recursive: true, force: true });
});

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Register, approve as `userId`, and hand back the code with what made it. */
async function approve(userId = "u1", scopes = ["sheets:read", "sheets:write"]) {
  const client = await registerClient(handle, { client_name: "Test assistant", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
  const { verifier, challenge } = pkce();
  const params = {
    client_id: client.client_id,
    redirect_uri: CALLBACK,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st",
    scope: "sheets:read sheets:write",
  };
  const out = await decideAuthorize(handle, BASE, userId, params, true, scopes);
  const back = new URL(out.redirect);
  return { client, verifier, code: back.searchParams.get("code")!, back, grantId: out.grantId! };
}

const expectOAuth = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(OAuthError);
  expect((err as OAuthError).code).toBe(code);
};

describe("redirect addresses", () => {
  it("accepts https anywhere and http only on this machine", () => {
    expect(redirectUriProblem("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(redirectUriProblem("http://localhost:6274/cb")).toBeNull();
    expect(redirectUriProblem("http://127.0.0.1/cb")).toBeNull();
    expect(redirectUriProblem("http://evil.example/cb")).not.toBeNull();
    expect(redirectUriProblem("https://a.example/cb#x")).not.toBeNull();
    expect(redirectUriProblem("https://user:pw@a.example/cb")).not.toBeNull();
    expect(redirectUriProblem("javascript:alert(1)")).not.toBeNull();
  });

  it("matches exactly, except a loopback address may change port", () => {
    expect(redirectMatches([CALLBACK], CALLBACK)).toBe(true);
    expect(redirectMatches([CALLBACK], `${CALLBACK}/x`)).toBe(false);
    expect(redirectMatches([CALLBACK], "https://assistant.example.test:444/callback")).toBe(false);
    expect(redirectMatches(["http://127.0.0.1:1000/cb"], "http://127.0.0.1:5555/cb")).toBe(true);
    expect(redirectMatches(["http://127.0.0.1:1000/cb"], "http://127.0.0.1:5555/other")).toBe(false);
  });
});

describe("approval", () => {
  it("refuses an unknown assistant or a return address it did not register, without redirecting", async () => {
    expect(await checkAuthorize(handle, BASE, { client_id: "nope" })).toHaveProperty("fatal");
    const client = await registerClient(handle, { redirect_uris: [CALLBACK] });
    expect(await checkAuthorize(handle, BASE, { client_id: client.client_id, redirect_uri: "https://elsewhere.example/cb" })).toHaveProperty("fatal");
  });

  it("sends missing PKCE back to the assistant as an error", async () => {
    const client = await registerClient(handle, { redirect_uris: [CALLBACK] });
    const out = await checkAuthorize(handle, BASE, { client_id: client.client_id, redirect_uri: CALLBACK, response_type: "code", state: "s" });
    expect("redirectError" in out && out.redirectError).toContain("error=invalid_request");
  });

  it("a refusal goes back as access_denied with the state", async () => {
    const client = await registerClient(handle, { redirect_uris: [CALLBACK] });
    const { challenge } = pkce();
    const out = await decideAuthorize(
      handle,
      BASE,
      "u1",
      { client_id: client.client_id, redirect_uri: CALLBACK, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", state: "zz" },
      false,
      [],
    );
    const u = new URL(out.redirect);
    expect(u.searchParams.get("error")).toBe("access_denied");
    expect(u.searchParams.get("state")).toBe("zz");
  });
});

describe("tokens", () => {
  it("a code becomes tokens once, with the right verifier, and a second use ends the connection", async () => {
    const { client, verifier, code, back } = await approve();
    expect(back.searchParams.get("state")).toBe("st");
    expect(back.searchParams.get("iss")).toBe(BASE);
    const form = { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: CALLBACK };
    await expectOAuth(exchangeToken(handle, req, BASE, { ...form, code_verifier: pkce().verifier }, allowAll), "invalid_grant");
    const tokens = await exchangeToken(handle, req, BASE, { ...form, code_verifier: verifier }, allowAll);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.scope).toBe("sheets:read sheets:write");
    const caller = await verifyAccessToken(handle, tokens.access_token);
    expect(caller).toMatchObject({ userId: "u1", scopes: ["sheets:read", "sheets:write"] });

    await expectOAuth(exchangeToken(handle, req, BASE, { ...form, code_verifier: verifier }, allowAll), "invalid_grant");
    expect(await verifyAccessToken(handle, tokens.access_token)).toHaveProperty("error");
  });

  it("a refresh token turns over, and replaying the old one ends the connection", async () => {
    const { client, verifier, code } = await approve();
    const first = await exchangeToken(handle, req, BASE, { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier }, allowAll);
    const refresh = { grant_type: "refresh_token", client_id: client.client_id };
    const second = await exchangeToken(handle, req, BASE, { ...refresh, refresh_token: first.refresh_token }, allowAll);
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(await verifyAccessToken(handle, second.access_token)).toHaveProperty("userId", "u1");

    await expectOAuth(exchangeToken(handle, req, BASE, { ...refresh, refresh_token: first.refresh_token }, allowAll), "invalid_grant");
    expect(await verifyAccessToken(handle, second.access_token)).toHaveProperty("error");
    await expectOAuth(exchangeToken(handle, req, BASE, { ...refresh, refresh_token: second.refresh_token }, allowAll), "invalid_grant");
  });

  it("a refresh can narrow scopes but never widen them", async () => {
    const { client, verifier, code } = await approve("u1", ["sheets:read"]);
    const first = await exchangeToken(handle, req, BASE, { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier }, allowAll);
    expect(first.scope).toBe("sheets:read");
    await expectOAuth(
      exchangeToken(handle, req, BASE, { grant_type: "refresh_token", client_id: client.client_id, refresh_token: first.refresh_token, scope: "sheets:write" }, allowAll),
      "invalid_scope",
    );
  });

  it("another assistant cannot use a code it was not given", async () => {
    const { verifier, code } = await approve();
    const other = await registerClient(handle, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    await expectOAuth(
      exchangeToken(handle, req, BASE, { grant_type: "authorization_code", client_id: other.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier }, allowAll),
      "invalid_grant",
    );
  });

  it("a confidential assistant needs its secret", async () => {
    const client = await registerClient(handle, { redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" });
    expect(client.client_secret).toBeTruthy();
    await expectOAuth(exchangeToken(handle, req, BASE, { grant_type: "refresh_token", client_id: client.client_id, client_secret: "wrong", refresh_token: "x" }, allowAll), "invalid_client");
  });

  it("revoking a refresh token, or changing the password, disconnects", async () => {
    const a = await approve("u2");
    const t = await exchangeToken(handle, req, BASE, { grant_type: "authorization_code", client_id: a.client.client_id, code: a.code, redirect_uri: CALLBACK, code_verifier: a.verifier }, allowAll);
    expect((await listConnections(handle, "u2")).map((c) => c.id)).toContain(a.grantId);
    await revokeToken(handle, req, { client_id: a.client.client_id, token: t.refresh_token });
    expect(await verifyAccessToken(handle, t.access_token)).toHaveProperty("error");

    const b = await approve("u2");
    const t2 = await exchangeToken(handle, req, BASE, { grant_type: "authorization_code", client_id: b.client.client_id, code: b.code, redirect_uri: CALLBACK, code_verifier: b.verifier }, allowAll);
    await revokeUserGrants(handle, "u2");
    expect(await verifyAccessToken(handle, t2.access_token)).toHaveProperty("error");
    expect(await listConnections(handle, "u2")).toEqual([]);
  });

  it("an account that may no longer connect gets no tokens", async () => {
    const { client, verifier, code } = await approve();
    await expectOAuth(
      exchangeToken(handle, req, BASE, { grant_type: "authorization_code", client_id: client.client_id, code, redirect_uri: CALLBACK, code_verifier: verifier }, async () => false),
      "invalid_grant",
    );
  });
});
