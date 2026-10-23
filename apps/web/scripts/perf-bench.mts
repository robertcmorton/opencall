/**
 * How long each screen takes to be usable, over a link as slow as the real one
 * (23 Oct, after "it feels a little slow to load buttons").
 *
 * Run by scripts/perf-check.sh, which starts a throwaway copy of the app. This
 * puts a slowed link in front of both servers — every connection waits before
 * it opens, and every byte waits half a round trip each way — then opens every
 * screen and times the moments a person waits for:
 *
 *   · before the show: each page on a first visit (nothing stored) and on a
 *     return visit (files and the sheet already on the device), and opening a
 *     sheet from the dashboard
 *   · going live: Start pressed, until the caller's and the crew's screens say
 *     LIVE
 *   · during the show: each sheet page opened while live; one cue step, until
 *     the caller's screen and a crew phone both move
 *   · shut down and reopen mid-show: the tab closed and opened again, and the
 *     whole browser quit and started again
 *
 * The slowed links are measured, not guessed. From a Mac in Sydney on 23 Oct
 * 2026 every request entered Railway at San Jose: opening a connection took
 * 0.33 s, then each round trip took 0.34 s to the servers in Singapore and
 * 0.17 s when they were in US West. Not modelled: how fast bytes flow, so a
 * large upload is quicker here than on a real line.
 *
 *   PERF_PROFILES=singapore,us-west,local   which links (default: all three)
 *   PERF_OUT=path.json                      also write the numbers there
 *   PERF_RETURN_GAP_MS=6000                 how long before a return visit
 *
 * The gap matters. A browser keeps the server's answer to "may this site send
 * a sign-in header?" for five seconds unless told otherwise, so a return visit
 * straight after the first rides on it and looks faster than any real one.
 */
const RETURN_GAP_MS = Number(process.env.PERF_RETURN_GAP_MS ?? 6000);
import { chromium, type BrowserContext, type Page } from "playwright";
import net from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zoneSecondsOfDay } from "@opencall/core";

const env = (k: string, d?: string) => process.env[k] ?? d ?? (() => { throw new Error(`set ${k}`); })();
const ADMIN = env("ADMIN_TOKEN");
const SYNC = env("SYNC_URL"); // the real sync server, for setting up — not slowed
const WEB_UP = Number(env("WEB_UPSTREAM_PORT"));
const SYNC_UP = Number(env("SYNC_UPSTREAM_PORT"));
const WEB_PROXY = Number(env("WEB_PROXY_PORT"));
const SYNC_PROXY = Number(env("SYNC_PROXY_PORT"));
const BASE = `http://localhost:${WEB_PROXY}`;

type Link = { name: string; connectMs: number; rttMs: number };
const LINKS: Link[] = [
  { name: "singapore", connectMs: 330, rttMs: 340 },
  { name: "us-west", connectMs: 330, rttMs: 170 },
  { name: "local", connectMs: 0, rttMs: 0 },
].filter((l) => !process.env.PERF_PROFILES || process.env.PERF_PROFILES.split(",").includes(l.name));

// ── The slowed link ─────────────────────────────────────────────────────────
// A plain TCP relay. Each direction is a queue released in order: a chunk goes
// on half a round trip after it arrived, and nothing passes on a connection
// until its opening delay is over. WebSockets go through it like anything else.
let link: Link = LINKS[0]!;
function relay(listen: number, upstream: number): net.Server {
  const server = net.createServer((client) => {
    const { connectMs, rttMs } = link; // fixed for the life of the connection
    const openAt = Date.now() + connectMs;
    const up = net.connect(upstream, "127.0.0.1");
    client.setNoDelay(true);
    up.setNoDelay(true);
    const lane = (to: net.Socket, minAt: number) => {
      const q: { at: number; chunk: Buffer | null }[] = [];
      let timer: NodeJS.Timeout | null = null;
      const drain = () => {
        timer = null;
        const now = Date.now();
        while (q.length && q[0]!.at <= now) {
          const { chunk } = q.shift()!;
          if (to.destroyed) return;
          if (chunk) to.write(chunk);
          else to.end();
        }
        if (q.length) timer = setTimeout(drain, q[0]!.at - now);
      };
      return (chunk: Buffer | null) => {
        q.push({ at: Math.max(Date.now() + rttMs / 2, minAt), chunk });
        if (!timer) timer = setTimeout(drain, Math.max(0, q[0]!.at - Date.now()));
      };
    };
    const toUp = lane(up, openAt + rttMs / 2);
    const toClient = lane(client, 0);
    client.on("data", (c) => toUp(c));
    client.on("end", () => toUp(null));
    up.on("data", (c) => toClient(c));
    up.on("end", () => toClient(null));
    const kill = () => {
      client.destroy();
      up.destroy();
    };
    client.on("error", kill);
    up.on("error", kill);
  });
  server.listen(listen, "127.0.0.1");
  return server;
}
const relays = [relay(WEB_PROXY, WEB_UP), relay(SYNC_PROXY, SYNC_UP)];

// ── What every page carries: a stopwatch on its sockets and its screen ─────
// Times are from the start of the page (or from `__perf.reset()`, for a page
// reached by a click). Marks named oc:* come from the app (lib/perfMark.ts).
const PROBE = () => {
  const P: {
    base: number;
    ws: { kind: string; created: number; open: number | null; firstMsg: number | null; bytesIn: number; bytesOut: number }[];
    seen: Record<string, number>;
    active: { id: string | null; at: number }[];
    sent: string[];
    reset: () => void;
  } = {
    base: 0,
    ws: [],
    seen: {},
    active: [],
    sent: [],
    reset() {
      P.base = performance.now();
      P.ws = [];
      P.seen = {};
      try {
        performance.clearMarks();
        performance.clearResourceTimings();
      } catch {}
    },
  };
  (window as unknown as { __perf: typeof P }).__perf = P;
  const t = () => Math.round(performance.now() - P.base);
  const Orig = window.WebSocket;
  const Hooked = function (url: string | URL, proto?: string | string[]) {
    const ws = proto === undefined ? new Orig(url) : new Orig(url, proto);
    const rec = { kind: String(url).includes("/doc") ? "doc" : "show", created: t(), open: null as number | null, firstMsg: null as number | null, bytesIn: 0, bytesOut: 0 };
    P.ws.push(rec);
    ws.addEventListener("open", () => (rec.open = t()));
    ws.addEventListener("message", (e: MessageEvent) => {
      if (rec.firstMsg == null) rec.firstMsg = t();
      rec.bytesIn += typeof e.data === "string" ? e.data.length : (e.data.byteLength ?? e.data.size ?? 0);
    });
    const send = ws.send.bind(ws);
    ws.send = (d: string | ArrayBufferLike | Blob | ArrayBufferView) => {
      rec.bytesOut += typeof d === "string" ? d.length : ((d as ArrayBuffer).byteLength ?? 0);
      if (typeof d === "string") {
        const m = /"t":"(\w+)"(?:.*?"action":"(\w+)")?/.exec(d);
        if (m && m[1] !== "ping") P.sent.push(`${m[1]}${m[2] ? ":" + m[2] : ""}`);
      }
      return send(d);
    };
    return ws;
  } as unknown as typeof WebSocket;
  Object.assign(Hooked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: Orig.prototype });
  window.WebSocket = Hooked;
  const lamp = (name: string) => [...document.querySelectorAll(".conn-lamp")].find((l) => l.textContent?.includes(name));
  const checks: Record<string, () => boolean> = {
    rows: () => document.querySelectorAll("tr[data-rowid]").length > 0,
    sheetOk: () => !!lamp("Sheet")?.classList.contains("is-ok"),
    showOk: () => !!lamp("Show")?.classList.contains("is-ok"),
    startReady: () => [...document.querySelectorAll("button")].some((b) => /Start show/.test(b.textContent ?? "") && !b.disabled),
    live: () => !!document.querySelector(".live-badge"),
    activeRow: () => !!document.querySelector("tr.active-row"),
    cards: () => document.querySelectorAll("section.card").length > 0,
  };
  let lastActive: string | null | undefined;
  setInterval(() => {
    for (const [k, f] of Object.entries(checks)) {
      if (P.seen[k] == null) {
        try {
          if (f()) P.seen[k] = t();
        } catch {}
      }
    }
    const id = document.querySelector("tr.active-row")?.getAttribute("data-rowid") ?? null;
    if (id !== lastActive) {
      lastActive = id;
      P.active.push({ id, at: Date.now() });
    }
  }, 5);
};

/** Everything a page can say about its own start, once it has settled. */
const READ = (syncPort: number) => {
  const P = (window as unknown as { __perf: { base: number; ws: unknown[]; seen: Record<string, number> } }).__perf;
  const rel = (x: number | undefined | null) => (x == null ? null : Math.round(x - P.base));
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime;
  const api = (performance.getEntriesByType("resource") as PerformanceResourceTiming[]).filter(
    (e) => e.name.includes(`:${syncPort}/`) && e.startTime - P.base < 4000,
  );
  const marks: Record<string, number | null> = {};
  for (const m of performance.getEntriesByType("mark")) if (m.name.startsWith("oc:")) marks[m.name.slice(3)] = rel(m.startTime);
  return {
    ttfb: P.base ? null : rel(nav?.responseStart),
    fcp: P.base ? null : rel(fcp),
    load: P.base || !nav?.loadEventEnd ? null : rel(nav.loadEventEnd),
    data: api.length ? Math.max(...api.map((e) => rel(e.responseEnd)!)) : null,
    calls: api.length,
    marks,
    seen: P.seen,
    ws: P.ws,
  };
};
type Reading = Awaited<ReturnType<typeof READ>>;

// ── Setting up: a crew link, and the sheet ─────────────────────────────────
const H = { "content-type": "application/json", authorization: `Bearer ${ADMIN}` };
/**
 * A sheet of its own, timed from now: 200 one-minute items, so there is always
 * a next item for a cue step whatever the hour, and something like the bulk of
 * a real match-day sheet. Deleted at the end.
 */
const event = ((await (await fetch(`${SYNC}/events`, { headers: H })).json()) as { id: string; timezone: string | null }[])[0];
if (!event) throw new Error("no event to put the test sheet in");
const NOW = Math.floor(zoneSecondsOfDay(Date.now(), event.timezone));
const DEPTS = ["audio", "video", "graphics", "lights"] as const;
const { id: sheet } = (await (
  await fetch(`${SYNC}/rundowns`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({
      eventId: event.id,
      name: "Speed check",
      plannedStartSec: NOW - 60,
      rows: Array.from({ length: 200 }, (_, i) => ({
        type: "cue",
        title: `Item ${i + 1} — a title about as long as a real one`,
        durationSec: 60,
        hardStartSec: i % 10 === 0 ? (NOW - 60 + i * 60) % 86_400 : null,
        cells: Object.fromEntries(DEPTS.map((d) => [d, `${d} cue ${i + 1}: a line of instructions for the crew`])),
      })),
    }),
  })
).json()) as { id: string };
if (!sheet) throw new Error("could not make the test sheet");
const crewCode = ((await (await fetch(`${SYNC}/rundowns/${sheet}/join-codes`, { method: "POST", headers: H, body: JSON.stringify({ role: "follower", label: "Speed check" }) })).json()) as { code?: string }).code;
if (!crewCode) throw new Error("could not make a crew link");

/** What "ready" means on each page — the moment a person could get on with it. */
type Kind = "data" | "paint" | "sheet" | "editor" | "crew" | "screen";
const PAGES: { name: string; path: string; kind: Kind }[] = [
  { name: "Dashboard", path: "/admin", kind: "data" },
  { name: "My account", path: "/account", kind: "data" },
  { name: "Users", path: "/admin/users", kind: "data" },
  { name: "Activity", path: "/admin/activity", kind: "data" },
  { name: "Error log", path: "/admin/errors", kind: "data" },
  { name: "Help", path: "/help", kind: "paint" },
  { name: "Show page", path: `/show/${sheet}`, kind: "sheet" },
  { name: "Edit page", path: `/edit/${sheet}`, kind: "editor" },
  { name: "Crew view", path: `/view/${sheet}?code=${crewCode}`, kind: "crew" },
  { name: "Timer", path: `/timer/${sheet}`, kind: "screen" },
  { name: "Display", path: `/display/${sheet}`, kind: "screen" },
  { name: "Prompter", path: `/prompter/${sheet}`, kind: "screen" },
];

const max = (...xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length === xs.length ? Math.max(...v) : null;
};
/**
 * Ready, per kind of page. Before a show the show page is ready when Start can
 * be pressed; while live, when the row on air is lit and the Show link is up.
 */
function readyOf(kind: Kind, r: Reading, live: boolean): number | null {
  const s = r.seen;
  switch (kind) {
    case "data":
      return r.data;
    case "paint":
      return r.fcp ?? r.load;
    case "sheet":
      return live ? max(s.activeRow, s.showOk) : max(s.startReady, s.rows);
    case "editor":
      return max(s.rows, s.sheetOk);
    case "crew":
      return live ? max(s.activeRow, s.showOk) : max(s.rows, s.showOk);
    case "screen":
      return max(r.marks["show-welcome"], r.marks["doc-synced"]);
  }
}

/**
 * Wait for the page to be ready — and, on a sheet page, for the Sheet light
 * too (the sheet in step with the server), so that is always reported even
 * when the page was usable before it.
 */
const settle = async (page: Page, kind: Kind, live: boolean, limit = 15_000) => {
  const t0 = Date.now();
  let ready: number | null = null;
  for (;;) {
    const r = (await page.evaluate(READ, SYNC_PROXY)) as Reading;
    ready ??= readyOf(kind, r, live);
    const sheetDone = kind === "data" || kind === "paint" || r.marks["doc-synced"] != null || Date.now() - t0 > 8000;
    if (ready != null && sheetDone && (kind !== "data" || Date.now() - t0 > 2500)) return { r, ready };
    if (Date.now() - t0 > limit) return { r, ready };
    await page.waitForTimeout(100);
  }
};

const results: Record<string, Record<string, unknown>> = {};
const row = (linkName: string, label: string, v: Record<string, unknown>) => ((results[linkName] ??= {})[label] = v);
const summary = (r: Reading, ready: number | null) => {
  const show = (r.ws as { kind: string; open: number | null; firstMsg: number | null; bytesOut: number; bytesIn: number }[]).find((w) => w.kind === "show");
  const doc = (r.ws as typeof show[]).find((w) => w?.kind === "doc");
  return {
    ready,
    firstPaint: r.fcp,
    apiCalls: r.calls,
    showOpen: show?.open ?? null,
    showHello: r.marks["show-welcome"] ?? null,
    docOpen: doc?.open ?? null,
    docSynced: r.marks["doc-synced"] ?? null,
    docUpKB: doc ? Math.round(doc.bytesOut / 102.4) / 10 : null,
    helloKB: show ? Math.round(show.bytesIn / 102.4) / 10 : null,
  };
};

const press = async (page: Page, label: string | RegExp) => {
  const b = page.locator("button:visible", { hasText: label }).first();
  if (!(await b.count())) return false;
  await b.click({ timeout: 5000 });
  return true;
};
const newCtx = async (browser: import("playwright").Browser, asCaller = true): Promise<BrowserContext> => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (asCaller) await ctx.addInitScript((token) => localStorage.setItem("oc:admintoken", token), ADMIN);
  // A crew phone that has typed its name once ("Who's watching?") — typing it
  // is the person's time, not the app's.
  else await ctx.addInitScript(() => localStorage.setItem("oc:viewer:name", "Speed check"));
  await ctx.addInitScript(PROBE);
  return ctx;
};
const open = async (ctx: BrowserContext, path: string, kind: Kind, live: boolean) => {
  const page = await ctx.newPage();
  await page.goto(BASE + path, { waitUntil: "commit" });
  const { r, ready } = await settle(page, kind, live);
  return { page, r, ready };
};
const ms = (x: unknown) => (x == null ? "—" : `${(Number(x) / 1000).toFixed(2)} s`);

for (const l of LINKS) {
  link = l;
  console.log(`\n▸ link: ${l.name} (open ${l.connectMs} ms, round trip ${l.rttMs} ms)`);
  const browser = await chromium.launch();

  // 1. Before the show — first visit, then return visit, every page.
  for (const p of PAGES) {
    const ctx = await newCtx(browser, p.kind !== "crew");
    const first = await open(ctx, p.path, p.kind, false);
    await first.page.close();
    await new Promise((r) => setTimeout(r, RETURN_GAP_MS));
    const again = await open(ctx, p.path, p.kind, false);
    row(l.name, `pre · ${p.name}`, { first: summary(first.r, first.ready), again: summary(again.r, again.ready) });
    console.log(`  ${p.name.padEnd(12)} first ${ms(first.ready).padStart(7)}   return ${ms(again.ready).padStart(7)}`);
    await ctx.close();
  }

  // 2. Dashboard → the sheet, by its link (the way it is usually opened).
  {
    const ctx = await newCtx(browser);
    (await open(ctx, `/show/${sheet}`, "sheet", false)).page.close(); // the device has been here before
    const { page } = await open(ctx, "/admin", "data", false);
    const a = page.locator(`a[href*="/show/${sheet}"]`).first();
    await page.evaluate(() => (window as unknown as { __perf: { reset: () => void } }).__perf.reset());
    await a.click();
    const { r, ready } = await settle(page, "sheet", false);
    row(l.name, "pre · Dashboard → sheet", summary(r, ready));
    console.log(`  Dashboard → sheet   ${ms(ready)}`);
    await ctx.close();
  }

  // 3. Going live, a cue step, and the pages while live.
  const caller = await newCtx(browser);
  const crew = await newCtx(browser, false);
  const { page: showPage } = await open(caller, `/show/${sheet}`, "sheet", false);
  const { page: crewPage } = await open(crew, `/view/${sheet}?code=${crewCode}`, "crew", false);
  await showPage.waitForTimeout(500);
  {
    const t0 = Date.now();
    await press(showPage, "Start show");
    if (await showPage.locator(".preflight:visible").count()) await press(showPage, "Start anyway");
    const liveAt = async (p: Page) => {
      await p.locator(".live-badge").first().waitFor({ timeout: 15_000 });
      return Date.now() - t0;
    };
    const [a, b] = await Promise.all([liveAt(showPage), liveAt(crewPage)]);
    row(l.name, "live · Start → LIVE", { caller: a, crew: b });
    console.log(`  Start → LIVE        caller ${ms(a)}   crew ${ms(b)}`);
  }
  await showPage.waitForTimeout(1500);
  {
    const steps: { caller: number; crew: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const before = await showPage.evaluate(() => document.querySelector("tr.active-row")?.getAttribute("data-rowid") ?? null);
      // Nothing focused, so Space reaches the show's own key handler (a click
      // to get there could land on a link).
      await showPage.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
      const t0 = Date.now();
      await showPage.keyboard.press("Space");
      const moved = (p: Page) =>
        p.waitForFunction(
          ([was, since]) => (window as unknown as { __perf: { active: { id: string | null; at: number }[] } }).__perf.active.some((x) => x.id && x.id !== was && x.at >= since),
          [before, t0] as const,
          { timeout: 10_000 },
        ).then(() => p.evaluate(([was, since]) => (window as unknown as { __perf: { active: { id: string | null; at: number }[] } }).__perf.active.find((x) => x.id && x.id !== was && x.at >= since)!.at, [before, t0] as const));
      const [ca, cr] = await Promise.all([moved(showPage), moved(crewPage)]).catch(() => [null, null]);
      if (ca && cr) steps.push({ caller: ca - t0, crew: cr - t0 });
      else console.log(`    (a step did not land: was ${before}, now ${await showPage.evaluate(() => document.querySelector("tr.active-row")?.getAttribute("data-rowid") ?? null)}; sent ${await showPage.evaluate(() => (window as unknown as { __perf: { sent: string[] } }).__perf.sent.slice(-4).join(", "))}; focus ${await showPage.evaluate(() => document.activeElement?.tagName)})`);
      await showPage.waitForTimeout(800);
    }
    const med = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null;
    const v = { caller: med(steps.map((s) => s.caller)), crew: med(steps.map((s) => s.crew)), samples: steps.length };
    row(l.name, "live · cue step", v);
    console.log(`  cue step (Space)    caller ${ms(v.caller)}   crew ${ms(v.crew)}`);
  }
  for (const p of PAGES.filter((p) => ["sheet", "editor", "crew", "screen"].includes(p.kind))) {
    const ctx = p.kind === "crew" ? crew : caller;
    const { page, r, ready } = await open(ctx, p.path, p.kind, true); // return visit: these were opened before the show
    row(l.name, `live · ${p.name}`, summary(r, ready));
    console.log(`  live ${p.name.padEnd(12)}   ${ms(ready)}`);
    await page.close();
  }

  // 4. Shut down and reopen mid-show: the tab, then the whole browser.
  {
    await showPage.close();
    const { page, r, ready } = await open(caller, `/show/${sheet}`, "sheet", true);
    row(l.name, "reopen · tab closed and opened", summary(r, ready));
    console.log(`  reopen tab          ${ms(ready)}`);
    await page.close();
  }
  {
    const dir = mkdtempSync(join(tmpdir(), "oc-perf-"));
    const launch = async () => {
      const ctx = await chromium.launchPersistentContext(dir, { viewport: { width: 1440, height: 900 } });
      await ctx.addInitScript((token) => localStorage.setItem("oc:admintoken", token), ADMIN);
      await ctx.addInitScript(PROBE);
      return ctx;
    };
    let ctx = await launch();
    (await open(ctx, `/show/${sheet}`, "sheet", true)).page.close();
    await ctx.close(); // the browser quits
    ctx = await launch();
    const { r, ready } = await open(ctx, `/show/${sheet}`, "sheet", true);
    row(l.name, "reopen · browser quit and restarted", summary(r, ready));
    console.log(`  reopen browser      ${ms(ready)}`);
    await ctx.close();
    rmSync(dir, { recursive: true, force: true });
  }

  // End the show, so the next link starts from the same place.
  {
    const { page } = await open(caller, `/show/${sheet}`, "sheet", true);
    await page.locator('.show-state button[aria-label="Stop the show"]').first().click();
    await page.waitForTimeout(300);
    await page.locator('.show-state button[aria-label^="Confirm"]').first().click();
    await page.waitForTimeout(1000);
  }
  await crew.close();
  await caller.close();
  await browser.close();
}

await fetch(`${SYNC}/rundowns/${sheet}`, { method: "DELETE", headers: H });
for (const r of relays) r.close();
if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify({ at: new Date().toISOString(), links: LINKS, results }, null, 2));
process.exit(0);
