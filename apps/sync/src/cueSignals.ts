import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Hocuspocus } from "@hocuspocus/server";
import { eq } from "drizzle-orm";
import type * as Y from "yjs";
import { nextCueRow } from "@opencall/core";
import { decodeDoc, projectRundownDoc, schema, type DbHandle } from "@opencall/db";

/**
 * Fire on cue: when a row goes on air, tell the outside world.
 *
 * Two directions, because a cloud server cannot reach a venue's own network:
 *  - OUT: each address on the sheet's list gets a POST the moment a row goes
 *    on air (cloud tools, or a venue tool reachable from the internet);
 *  - IN: `GET /rundowns/:id/now` answers "what is on air now" for equipment
 *    on the venue network to ask (Companion, a graphics machine) — outbound
 *    from the venue, so nothing has to be opened up there.
 *
 * Only public https addresses are ever called. Without that, a sheet could
 * point this server at its own private network (the database, the platform's
 * metadata service) — the classic server-side request forgery.
 */

export const MAX_WEBHOOKS = 5;
const TIMEOUT_MS = 3000;
const LOG_SIZE = 20;

function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
    // An IPv4 address carried inside IPv6 (::ffff:10.0.0.1, which URL
    // parsing rewrites as ::ffff:a00:1 — or the NAT64 prefix 64:ff9b::):
    // judged by the IPv4 address inside. Missing the hex form let a private
    // address through; the test that found it stays.
    const embedded = /^(?:::ffff:|64:ff9b::)(.+)$/.exec(v)?.[1];
    if (embedded) {
      if (isIP(embedded) === 4) return privateAddress(embedded);
      const groups = embedded.split(":");
      if (groups.length === 2) {
        const [hi, lo] = groups.map((g) => parseInt(g, 16)) as [number, number];
        if (Number.isNaN(hi) || Number.isNaN(lo)) return true;
        return privateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true; // anything stranger is refused, not guessed at
    }
    return false;
  }
  const [a, b] = ip.split(".").map(Number) as [number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Why an address may not be called, or null when it may. Resolves DNS. */
export async function webhookProblem(raw: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "That is not a web address.";
  }
  if (url.protocol !== "https:") return "Only https:// addresses can be used.";
  if (url.username || url.password) return "Put credentials in the address's path or query, not before the host.";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (/(^|\.)(localhost|local|internal|home\.arpa)$/i.test(host)) return "That address is on a private network, which OpenCall will not call.";
  let addresses: string[];
  if (isIP(host)) addresses = [host];
  else {
    try {
      addresses = (await lookup(host, { all: true })).map((a) => a.address);
    } catch {
      return "That address's host could not be found.";
    }
  }
  if (addresses.length === 0 || addresses.some(privateAddress)) return "That address is on a private network, which OpenCall will not call.";
  return null;
}

export interface Delivery {
  at: string;
  host: string;
  ok: boolean;
  status: number | null;
  ms: number;
  error?: string;
  test?: boolean;
}

interface RowView {
  id: string;
  number: number;
  title: string;
  type: string;
  cells: Record<string, string>;
}

export function createCueSignals(
  handle: DbHandle,
  docServer: Pick<Hocuspocus, "documents">,
  liveState: (id: string) => Promise<{ state: string; activeRowId: string | null; playedRowIds?: string[] }>,
  /** For tests only: a stand-in for fetch, and for the address check. */
  test: { fetch?: typeof fetch; check?: typeof webhookProblem } = {},
) {
  const send = test.fetch ?? fetch;
  const check = test.check ?? webhookProblem;
  const lastOnAir = new Map<string, string | null>();
  const logs = new Map<string, Delivery[]>();

  const sheet = async (rundownId: string) => {
    const r = await handle.db.query.rundowns.findFirst({ where: eq(schema.rundowns.id, rundownId) });
    if (!r) return null;
    const liveDoc = docServer.documents.get(`${r.id}@${r.docEpoch}`) as Y.Doc | undefined;
    const doc = liveDoc ?? (r.doc ? decodeDoc(r.doc) : null);
    return { rundown: r, projected: doc ? projectRundownDoc(doc) : null };
  };

  const rowView = (p: ReturnType<typeof projectRundownDoc>, id: string | null): RowView | null => {
    if (!id) return null;
    const i = p.rows.findIndex((r) => r.id === id);
    const r = p.rows[i];
    if (!r) return null;
    const cells: Record<string, string> = {};
    for (const c of p.columns) {
      const v = (r.cells[c.key] ?? "").trim();
      if (v && c.key !== "title") cells[c.title] = v;
    }
    return { id: r.id, number: i + 1, title: r.title.trim(), type: r.type, cells };
  };

  const record = (rundownId: string, d: Delivery) => {
    const list = logs.get(rundownId) ?? [];
    list.unshift(d);
    logs.set(rundownId, list.slice(0, LOG_SIZE));
  };

  const post = async (rundownId: string, url: string, payload: unknown, test = false) => {
    const started = Date.now();
    const host = (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })();
    // Checked again at the moment of sending: what an address resolves to can change.
    const problem = await check(url);
    if (problem) {
      record(rundownId, { at: new Date().toISOString(), host, ok: false, status: null, ms: 0, error: problem, test });
      return;
    }
    try {
      const res = await send(url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "OpenCall-Cues/1", "x-opencall-event": test ? "test" : "on_air" },
        body: JSON.stringify(payload),
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      record(rundownId, { at: new Date().toISOString(), host, ok: res.ok, status: res.status, ms: Date.now() - started, test });
    } catch (err) {
      record(rundownId, {
        at: new Date().toISOString(),
        host,
        ok: false,
        status: null,
        ms: Date.now() - started,
        error: (err as Error)?.name === "TimeoutError" ? `no answer within ${TIMEOUT_MS / 1000} s` : String((err as Error)?.message ?? err).slice(0, 120),
        test,
      });
    }
  };

  /** What is on air now, and next — for the webhook payload and the "now" address. */
  const now = async (rundownId: string) => {
    const s = await sheet(rundownId);
    if (!s?.projected) return null;
    const live = await liveState(rundownId);
    const isLive = live.state === "running" || live.state === "paused";
    const onAir = isLive ? rowView(s.projected, live.activeRowId) : null;
    const nextId = isLive && live.activeRowId ? nextCueRow(s.projected.rows, live.activeRowId, new Set(live.playedRowIds ?? [])) : null;
    return {
      sheet: { id: s.rundown.id, name: s.rundown.name },
      state: live.state,
      onAir,
      next: rowView(s.projected, nextId),
      at: new Date().toISOString(),
    };
  };

  return {
    /** Called with every show state the server sends; fires when a new row goes on air. */
    onShowState(rundownId: string, state: { state: string; activeRowId: string | null }) {
      const live = state.state === "running" || state.state === "paused";
      const active = live ? state.activeRowId : null;
      const before = lastOnAir.get(rundownId) ?? null;
      lastOnAir.set(rundownId, active);
      if (!active || active === before) return;
      void (async () => {
        const s = await sheet(rundownId);
        const urls = s?.rundown.cueWebhooks ?? [];
        if (urls.length === 0) return;
        const payload = { event: "on_air", ...(await now(rundownId)) };
        await Promise.all(urls.map((u) => post(rundownId, u, payload)));
      })().catch((err) => console.error("[cues] could not fire:", err));
    },
    now,
    async test(rundownId: string) {
      const s = await sheet(rundownId);
      const urls = s?.rundown.cueWebhooks ?? [];
      const payload = { event: "test", note: "A test from OpenCall — nothing went on air.", ...(await now(rundownId)) };
      await Promise.all(urls.map((u) => post(rundownId, u, payload, true)));
      return logs.get(rundownId)?.slice(0, urls.length) ?? [];
    },
    deliveries: (rundownId: string) => logs.get(rundownId) ?? [],
  };
}

export type CueSignals = ReturnType<typeof createCueSignals>;
