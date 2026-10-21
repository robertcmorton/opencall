import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hocuspocus } from "@hocuspocus/server";
import { sql } from "drizzle-orm";
import { buildRundownDoc, createDb, encodeDoc, ensureSchema, projectRundownDoc, type DbHandle } from "@opencall/db";
import { createDocServer, docStoresSettled } from "../src/doc-server";
import { createMcpRoutes } from "../src/mcp";
import { decideAuthorize, exchangeToken, registerClient } from "../src/oauth";

/**
 * The assistant reaches exactly what its account reaches (21 Oct, Robert:
 * "does the AI abide by company/event/edit/read-only access?"). Every call
 * here goes through the real /mcp endpoint with a real connection token, so
 * the per-request rebuild of the account's grants is exercised as well.
 *
 * Two companies, HARBOUR and RIVERS. HARBOUR has two events; the first holds
 * an open sheet and one closed to viewers.
 */

const CALLBACK = "https://assistant.example.test/callback";
const ALL_SCOPES = ["sheets:read", "sheets:write", "errors:read", "errors:resolve"];
const req = { headers: {} } as IncomingMessage;

const SHEETS = {
  open: "r_harbour_open", // HARBOUR, event 1
  closed: "r_harbour_closed", // HARBOUR, event 1, closed to viewers
  second: "r_harbour_second", // HARBOUR, event 2
  rivers: "r_rivers", // RIVERS
} as const;
const EVENT_OF: Record<string, string> = {
  [SHEETS.open]: "HARBOUR v COAST",
  [SHEETS.closed]: "HARBOUR v COAST",
  [SHEETS.second]: "HARBOUR v RANGERS",
  [SHEETS.rivers]: "RIVERS v COAST",
};
const ALL_SHEETS = Object.values(SHEETS);

type Kind = "admin" | "company" | "company_view" | "event" | "edit" | "view" | "none";
/** What each kind of account should reach, and whether it may change it. */
const EXPECT: Record<Kind, { sheets: string[]; canChange: boolean }> = {
  admin: { sheets: ALL_SHEETS, canChange: true },
  company: { sheets: [SHEETS.open, SHEETS.closed, SHEETS.second], canChange: true },
  company_view: { sheets: [SHEETS.open, SHEETS.second], canChange: false },
  event: { sheets: [SHEETS.open, SHEETS.closed], canChange: true },
  edit: { sheets: [SHEETS.open, SHEETS.closed], canChange: true },
  view: { sheets: [SHEETS.open], canChange: false },
  none: { sheets: [], canChange: false },
};
const KINDS = Object.keys(EXPECT) as Kind[];
/** Read-only accounts that see the closed sheet's event: told it is closed, not that it is missing. */
const TOLD_CLOSED: Kind[] = ["company_view", "view"];

let handle: DbHandle;
let dir: string;
let docServer: Hocuspocus;
let http: Server;
let endpoint: string;
let rowId: string;
const live = new Map<string, string>();
const tokens = new Map<string, string>();

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Connects an assistant to `userId` with these permissions; its access token. */
async function connect(userId: string, scopes: string[]): Promise<string> {
  const client = await registerClient(handle, { client_name: "Test assistant", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
  const { verifier, challenge } = pkce();
  const params = { client_id: client.client_id, redirect_uri: CALLBACK, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: ALL_SCOPES.join(" ") };
  const out = await decideAuthorize(handle, "http://sync.test", userId, params, true, scopes);
  const code = new URL(out.redirect).searchParams.get("code")!;
  const t = await exchangeToken(handle, req, "http://sync.test", { grant_type: "authorization_code", client_id: client.client_id, code, code_verifier: verifier, redirect_uri: CALLBACK }, async () => true);
  return t.access_token;
}

let rpcId = 0;
/** One JSON-RPC call to /mcp; the HTTP status and the parsed body. */
async function rpc(token: string, method: string, params: unknown = {}) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-06-18",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? (JSON.parse(text) as { result?: Record<string, unknown>; error?: { message: string } }) : null };
}

/** A tool's answer: its text, and whether it was a refusal. */
async function call(who: string, name: string, args: Record<string, unknown> = {}) {
  const r = await rpc(tokens.get(who)!, "tools/call", { name, arguments: args });
  expect(r.status, `${name} as ${who}: HTTP ${r.status}`).toBe(200);
  if (r.body?.error) return { text: r.body.error.message, isError: true };
  const result = r.body!.result as { content: { text: string }[]; isError?: boolean };
  return { text: result.content.map((c) => c.text).join("\n"), isError: result.isError === true };
}

async function toolNames(who: string): Promise<string[]> {
  const r = await rpc(tokens.get(who)!, "tools/list");
  return ((r.body!.result as { tools: { name: string }[] }).tools ?? []).map((t) => t.name);
}

/** list_sheets, as { sheetId: "can change" | "read only" }. */
async function listed(who: string): Promise<Record<string, string>> {
  const { text, isError } = await call(who, "list_sheets");
  expect(isError).toBe(false);
  if (text === "This account cannot open any sheets.") return {};
  const { events } = JSON.parse(text) as { events: { event: string; access: string; sheets: { id: string }[] }[] };
  const out: Record<string, string> = {};
  for (const e of events) for (const s of e.sheets) {
    expect(EVENT_OF[s.id]).toBe(e.event);
    out[s.id] = e.access;
  }
  return out;
}

const missing = (id: string, verb: "open" | "edit") => `No sheet with id "${id}" that this account can ${verb}. Use list_sheets to see them.`;
const writeText = (who: string, sheet: string, text: string) => call(who, "update_cells", { sheet_id: sheet, changes: [{ row_id: rowId, column: "Title", text }] });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "oc-mcp-access-"));
  handle = await createDb(undefined, dir);
  await ensureSchema(handle.db);

  const doc = buildRundownDoc([{ type: "cue", title: "Kick off", durationSec: 60 }, { type: "cue", title: "Half time", durationSec: 600 }], { name: "Match", plannedStartSec: 19 * 3600 });
  rowId = projectRundownDoc(doc).rows[0]!.id;
  const bytes = encodeDoc(doc);

  const db = handle.db;
  await db.execute(sql`INSERT INTO teams (id, name, slug) VALUES ('t_harbour', 'HARBOUR', 'harbour'), ('t_rivers', 'RIVERS', 'rivers')`);
  await db.execute(sql`INSERT INTO events (id, team_id, name, start_date, end_date, timezone) VALUES
    ('e_harbour_1', 't_harbour', 'HARBOUR v COAST', '2026-10-24', '2026-10-24', 'Australia/Sydney'),
    ('e_harbour_2', 't_harbour', 'HARBOUR v RANGERS', '2026-10-31', '2026-10-31', 'Australia/Sydney'),
    ('e_rivers', 't_rivers', 'RIVERS v COAST', '2026-10-25', '2026-10-25', 'Australia/Sydney')`);
  await db.execute(sql`INSERT INTO rundowns (id, event_id, name, doc) VALUES
    (${SHEETS.open}, 'e_harbour_1', 'Match night', ${bytes}),
    (${SHEETS.second}, 'e_harbour_2', 'Match night', ${bytes}),
    (${SHEETS.rivers}, 'e_rivers', 'Match night', ${bytes})`);
  await db.execute(sql`INSERT INTO rundowns (id, event_id, name, doc, viewing_closed_at) VALUES (${SHEETS.closed}, 'e_harbour_1', 'Last week', ${bytes}, now())`);
  // An archived sheet is reachable by nobody, not even an administrator.
  await db.execute(sql`INSERT INTO rundowns (id, event_id, name, doc, archived_at) VALUES ('r_archived', 'e_harbour_1', 'Old', ${bytes}, now())`);

  const grants: Record<Kind, [string, string] | null> = {
    admin: ["admin", ""],
    company: ["company", "t_harbour"],
    company_view: ["company_view", "t_harbour"],
    event: ["event", "e_harbour_1"],
    edit: ["edit", "e_harbour_1"],
    view: ["view", "e_harbour_1"],
    none: null,
  };
  for (const k of KINDS) {
    await db.execute(sql`INSERT INTO users (id, email, name) VALUES (${`u_${k}`}, ${`${k}@example.test`}, ${k})`);
    const g = grants[k];
    if (g) await db.execute(sql`INSERT INTO user_grants (user_id, kind, target_id) VALUES (${`u_${k}`}, ${g[0]}, ${g[1]})`);
  }
  // Every connection is offered every permission, so whatever an account
  // cannot do is down to its access, not to what its connection was allowed.
  for (const k of KINDS) tokens.set(k, await connect(`u_${k}`, ALL_SCOPES));

  docServer = createDocServer(handle);
  const routes = createMcpRoutes(handle, docServer, async (id) => ({ state: live.get(id) ?? "idle", activeRowId: live.has(id) ? rowId : null }), "test");
  http = createServer((rq, rs) => {
    void routes(rq, rs).then((mine) => {
      if (!mine) rs.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  endpoint = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
}, 60_000);

afterAll(async () => {
  await new Promise((resolve) => http?.close(resolve));
  docServer?.flushPendingStores();
  await docStoresSettled();
  await handle?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("an assistant reaches what its account reaches", () => {
  it.each(KINDS)("%s: list_sheets shows exactly the reachable sheets, labelled", async (k) => {
    const want = Object.fromEntries(EXPECT[k].sheets.map((id) => [id, EXPECT[k].canChange ? "can change" : "read only"]));
    expect(await listed(k)).toEqual(want);
  });

  it.each(KINDS)("%s: a sheet out of reach is refused exactly as a missing one", async (k) => {
    const outOfReach = ALL_SHEETS.filter((id) => !EXPECT[k].sheets.includes(id) && !(TOLD_CLOSED.includes(k) && id === SHEETS.closed));
    for (const id of [...outOfReach, "r_archived", "r_does_not_exist"]) {
      const got = await call(k, "get_sheet", { sheet_id: id });
      expect(got, `${k} reading ${id}`).toEqual({ text: missing(id, "open"), isError: true });
    }
    for (const id of EXPECT[k].sheets) expect((await call(k, "get_sheet", { sheet_id: id })).isError, `${k} reading ${id}`).toBe(false);
  });

  it.each(KINDS)("%s: may change a sheet only with edit access", async (k) => {
    const got = await writeText(k, SHEETS.open, `Kick off (${k})`);
    if (k === "none") {
      expect(got).toEqual({ text: missing(SHEETS.open, "edit"), isError: true });
    } else if (EXPECT[k].canChange) {
      expect(got.isError, got.text).toBe(false);
      expect((await call(k, "get_sheet", { sheet_id: SHEETS.open })).text).toContain(`Kick off (${k})`);
    } else {
      expect(got).toEqual({ text: "This account can read this sheet but not change it. Ask whoever runs the event for edit access.", isError: true });
      expect((await call(k, "set_duration", { sheet_id: SHEETS.open, row_id: rowId, duration: "2:00" })).isError).toBe(true);
    }
  });

  it("an event grant does not reach the company's other events; a company grant stops at its company", async () => {
    for (const k of ["event", "edit"] as const) expect(await writeText(k, SHEETS.second, "x")).toEqual({ text: missing(SHEETS.second, "edit"), isError: true });
    expect(await writeText("company", SHEETS.rivers, "x")).toEqual({ text: missing(SHEETS.rivers, "edit"), isError: true });
    expect((await call("company", "preview_change", { change: "update_cells", arguments: { sheet_id: SHEETS.rivers, changes: [{ row_id: rowId, column: "Title", text: "x" }] } })).text).toBe(missing(SHEETS.rivers, "edit"));
  });

  it("a sheet closed to viewers refuses read-only accounts, and stays open to editors", async () => {
    for (const k of TOLD_CLOSED) expect(await call(k, "get_sheet", { sheet_id: SHEETS.closed }), k).toEqual({ text: "This sheet has been closed to viewers since the event ended.", isError: true });
    for (const k of ["admin", "company", "event", "edit"] as const) expect((await call(k, "get_sheet", { sheet_id: SHEETS.closed })).isError, k).toBe(false);
  });

  it("while a show is live, only text and strikes change", async () => {
    live.set(SHEETS.second, "running");
    try {
      const timed = await call("admin", "set_duration", { sheet_id: SHEETS.second, row_id: rowId, duration: "2:00" });
      expect(timed.isError).toBe(true);
      expect(timed.text).toMatch(/^The show on this sheet is live/);
      expect((await writeText("admin", SHEETS.second, "Kick off (live)")).isError).toBe(false);
    } finally {
      live.delete(SHEETS.second);
    }
  });
});

describe("what the connection was allowed", () => {
  it("a read-only connection is refused changes even for an editor", async () => {
    tokens.set("event:read", await connect("u_event", ["sheets:read"]));
    const names = await toolNames("event:read");
    expect(names).toEqual(expect.arrayContaining(["list_sheets", "get_sheet", "read_help"]));
    for (const w of ["update_cells", "set_duration", "set_start_time", "add_rows", "move_row", "strike_row", "delete_rows", "preview_change"]) expect(names).not.toContain(w);

    const r = await rpc(tokens.get("event:read")!, "tools/call", { name: "update_cells", arguments: { sheet_id: SHEETS.open, changes: [{ row_id: rowId, column: "Title", text: "x" }] } });
    expect(r.status).toBe(403);
    expect(r.headers.get("www-authenticate")).toContain("insufficient_scope");
    expect(await listed("event:read")).toEqual({ [SHEETS.open]: "read only", [SHEETS.closed]: "read only" });
  });

  it("the error log is there only for administrators, even when every connection was offered it", async () => {
    expect(await toolNames("admin")).toEqual(expect.arrayContaining(["read_error_log", "resolve_errors"]));
    for (const k of KINDS.filter((x) => x !== "admin")) {
      const names = await toolNames(k);
      expect(names, k).not.toContain("read_error_log");
      expect(names, k).not.toContain("resolve_errors");
      expect((await call(k, "read_error_log")).isError, k).toBe(true);
      expect((await call(k, "resolve_errors", { matching: "anything", fix: "nothing was fixed here" })).isError, k).toBe(true);
    }
  });
});

describe("access is read afresh on every call", () => {
  it("revoking a grant takes effect on the very next call", async () => {
    await handle.db.execute(sql`INSERT INTO users (id, email, name) VALUES ('u_brief', 'brief@example.test', 'brief')`);
    await handle.db.execute(sql`INSERT INTO user_grants (user_id, kind, target_id) VALUES ('u_brief', 'edit', 'e_harbour_1')`);
    tokens.set("brief", await connect("u_brief", ["sheets:read", "sheets:write"]));
    expect((await writeText("brief", SHEETS.open, "Kick off (brief)")).isError).toBe(false);

    // Edit narrowed to view: still reads, no longer writes.
    await handle.db.execute(sql`UPDATE user_grants SET kind = 'view' WHERE user_id = 'u_brief'`);
    expect(await listed("brief")).toEqual({ [SHEETS.open]: "read only" });
    expect((await writeText("brief", SHEETS.open, "x")).text).toMatch(/^This account can read this sheet but not change it/);

    // Removed altogether: nothing, and the sheet reads as if it did not exist.
    await handle.db.execute(sql`DELETE FROM user_grants WHERE user_id = 'u_brief'`);
    expect(await listed("brief")).toEqual({});
    expect(await call("brief", "get_sheet", { sheet_id: SHEETS.open })).toEqual({ text: missing(SHEETS.open, "open"), isError: true });
    expect(await writeText("brief", SHEETS.open, "x")).toEqual({ text: missing(SHEETS.open, "edit"), isError: true });
  });
});
