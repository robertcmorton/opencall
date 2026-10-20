/**
 * Bars on overlapping rows end at the right time (20 Oct).
 *
 * Plays a short show on the local dev servers twice, recording every quarter
 * second whether each row's progress bar is showing:
 *
 *   1. driven by the clock — every row cued at its printed time;
 *   2. called by hand, late — the rows cued 10–15 s after their printed time.
 *
 * Rows overlap on purpose (Anthem 0–90 s, Crowd cam 30–90, Sponsor read
 * 60–120). Each bar must appear when its row is CUED and go when its length
 * has run from then — within a second — and a row never cued shows none.
 * A row cued late used to lose its bar early, by however late it was cued.
 *
 *   pnpm test:bars          (web on :3010, sync on :8787; ~5 minutes)
 *
 * Makes a throwaway sheet in the first event the server lists, and deletes it.
 */
import { chromium } from "playwright";

const WEB = process.env.WEB_URL ?? "http://localhost:3010";
const SYNC = process.env.SYNC_URL ?? "http://localhost:8787";
const TOLERANCE = 1.0;
const SPEC = [
  { title: "Anthem", at: 0, dur: 90 },
  { title: "Crowd cam", at: 30, dur: 60 },
  { title: "Sponsor read", at: 60, dur: 60 },
  { title: "Kick off", at: 120, dur: 60 },
];
const eventId = ((await (await fetch(`${SYNC}/events`)).json()) as { id: string }[])[0]?.id;
if (!eventId) throw new Error("No event to put the test sheet in.");

async function play(handCalled: boolean): Promise<string[]> {
  const now = new Date();
  const start = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + 20;
  const t0 = Date.now() - now.getMilliseconds() + 20_000;
  const { id } = (await (
    await fetch(`${SYNC}/rundowns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId, name: "Bar timing check", plannedStartSec: start, rows: SPEC.map((r) => ({ type: "cue", title: r.title, durationSec: r.dur, hardStartSec: start + r.at })) }),
    })
  ).json()) as { id: string };
  const cuedAt: Record<string, number | undefined> = handCalled ? { Anthem: 10, "Crowd cam": 40, "Sponsor read": 75, "Kick off": 130 } : Object.fromEntries(SPEC.map((r) => [r.title, r.at]));
  const browser = await chromium.launch(process.env.AUDIT_BROWSER === "bundled" ? {} : { channel: "chrome" });
  const problems: string[] = [];
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.goto(`${WEB}/show/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    await page.locator("button:visible", { hasText: "Start show" }).first().click();
    await page.waitForTimeout(300);
    await page.locator("button:visible", { hasText: "Start anyway" }).first().click().catch(() => undefined);
    const rowIds = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("tr[data-rowid]")].map((tr) => [(tr as HTMLElement).innerText.match(/Anthem|Crowd cam|Sponsor read|Kick off/)?.[0] ?? "", (tr as HTMLElement).dataset.rowid])));
    const ws = new WebSocket(`${SYNC.replace(/^http/, "ws")}/?rundown=${id}`);
    await new Promise((r) => ws.addEventListener("open", r));
    ws.send(JSON.stringify({ v: 1, t: "hello", auth: { kind: "session", token: "dev" }, device: "console" }));
    await new Promise((r) => setTimeout(r, 800));
    const cmd = (action: string, rowId?: string) => ws.send(JSON.stringify({ v: 1, t: "cmd", id: `bt-${Math.random()}`, action, ...(rowId ? { rowId } : {}) }));
    if (handCalled) {
      cmd("clock_off");
      for (const [title, sec] of Object.entries(cuedAt)) if (sec != null) setTimeout(() => cmd("jump", rowIds[title]), Math.max(0, t0 + sec * 1000 - Date.now()));
    }
    const seen: Record<string, { on?: number; last?: number }> = {};
    while (Date.now() < t0 + 140_000) {
      const t = (Date.now() - t0) / 1000;
      const shown = await page.evaluate(() => [...document.querySelectorAll("tr[data-rowid]")].filter((tr) => tr.querySelector(".row-progress")).map((tr) => (tr as HTMLElement).innerText.match(/Anthem|Crowd cam|Sponsor read|Kick off/)?.[0] ?? ""));
      for (const title of shown) {
        const s = (seen[title] ??= {});
        s.on ??= t;
        s.last = t;
      }
      await page.waitForTimeout(250);
    }
    ws.close();
    await page.locator('.show-state button[aria-label="Stop the show"]').click();
    await page.waitForTimeout(300);
    await page.locator('.show-state button[aria-label^="Confirm"]').click();
    for (const r of SPEC) {
      const cued = cuedAt[r.title];
      const s = seen[r.title];
      const label = `${handCalled ? "hand-called" : "clock"}: ${r.title}`;
      if (cued == null) {
        if (s) problems.push(`${label} was never cued but showed a bar from ${s.on!.toFixed(1)} s`);
        continue;
      }
      if (!s) {
        problems.push(`${label} never showed a bar`);
        continue;
      }
      const end = cued + r.dur;
      if (Math.abs(s.on! - cued) > TOLERANCE) problems.push(`${label} bar appeared at ${s.on!.toFixed(1)} s, cued at ${cued} s`);
      if (end < 138 && Math.abs(s.last! - end) > TOLERANCE) problems.push(`${label} bar ended at ${s.last!.toFixed(1)} s, should end at ${end} s`);
      console.log(`${s && Math.abs(s.on! - cued) <= TOLERANCE && (end >= 138 || Math.abs(s.last! - end) <= TOLERANCE) ? "✓" : "✗"} ${label.padEnd(26)} cued ${cued}s → bar ${s.on!.toFixed(1)}–${s.last!.toFixed(1)} s (should end ${end} s)`);
    }
  } finally {
    await browser.close();
    await fetch(`${SYNC}/rundowns/${id}`, { method: "DELETE" });
  }
  return problems;
}

const problems = [...(await play(false)), ...(await play(true))];
for (const p of problems) console.log(`    ${p}`);
console.log(problems.length ? `\n${problems.length} problem${problems.length === 1 ? "" : "s"}.` : "\nEvery bar starts and ends on time.");
process.exit(problems.length ? 1 : 0);
