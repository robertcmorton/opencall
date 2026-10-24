/**
 * A show run on the clock records every item at its planned length (21 Oct).
 *
 * Plays a short show entirely on the clock and reads back the show record,
 * then the sheet. The sheet is built from the shapes that went wrong on a real
 * one:
 *
 *   Doors          printed −60 s, 1:00  — already over when the show starts
 *   Warm up        printed   0 s, 1:00  — the show starts ~25 s into it
 *   (0:20)         no time, no length   — a note the clock must go past
 *   Relay          no time,       0:20  — follows on, timed by its length
 *   (standby)      no time, no length   — a note just before a printed time
 *   Interval       printed  80 s, 0:40  — a block played by the two below
 *     Wrap         printed  80 s, 0:20, muted
 *     Ads          printed 100 s, 0:20, muted
 *   Feature        printed 120 s, 0:30
 *   Presentation   printed 150 s, no length — the show is stopped on it
 *
 * What must come back:
 *   - Start opens on Warm up, the clock's item. Doors is never on air.
 *   - Neither note row is ever on air.
 *   - Relay, Wrap, Ads and Feature ran exactly their length: ±0:00.
 *   - Warm up says "joined late", Interval "in its items", and the readout "On plan 0:00".
 *
 *   pnpm test:clock         (web on :3010, sync on :8787; ~3 minutes)
 *
 * Also run by `pnpm test:layout`, and so by CI, against its own servers.
 * Makes a throwaway sheet in the first event the server lists, and deletes it.
 */
import { chromium } from "playwright";
import { zoneSecondsOfDay } from "@opencall/core";

const WEB = process.env.WEB_URL ?? "http://localhost:3010";
const SYNC = process.env.SYNC_URL ?? "http://localhost:8787";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const event = ((await (await fetch(`${SYNC}/events`)).json()) as { id: string; timezone: string | null }[])[0];
if (!event) throw new Error("No event to put the test sheet in.");
// The sheet's clock is the event's, not this machine's (CI runs in UTC).
const zoneNow = () => zoneSecondsOfDay(Date.now(), event.timezone);
// A show across midnight is its own subject; stay clear of it.
while (zoneNow() < 120 || zoneNow() > 86_400 - 300) await sleep(10_000);

type Spec = { title: string; at?: number; dur?: number; muted?: boolean };
const ROWS: Spec[] = [
  { title: "Doors", at: -60, dur: 60 },
  { title: "Warm up", at: 0, dur: 60 },
  { title: "(0:20)" },
  { title: "Relay", dur: 20 },
  { title: "(standby)" },
  { title: "Interval", at: 80, dur: 40 },
  { title: "Wrap", at: 80, dur: 20, muted: true },
  { title: "Ads", at: 100, dur: 20, muted: true },
  { title: "Feature", at: 120, dur: 30 },
  { title: "Presentation", at: 150 },
];
const EXACT = ["Relay", "Wrap", "Ads", "Feature"];
const NEVER_ON_AIR = ["Doors", "(0:20)", "(standby)"];

const S = Math.floor(zoneNow()) - 5;
const { id } = (await (
  await fetch(`${SYNC}/rundowns`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      eventId: event.id,
      name: "Clock record check",
      plannedStartSec: S - 60,
      rows: ROWS.map((r) => ({
        type: "cue",
        title: r.title,
        durationSec: r.dur ?? null,
        hardStartSec: r.at != null ? S + r.at : null,
        ...(r.muted ? { durationMuted: true } : {}),
      })),
    }),
  })
).json()) as { id: string };

const problems: string[] = [];
const ok = (good: boolean, line: string, problem: string) => {
  console.log(`${good ? "✓" : "✗"} ${line}`);
  if (!good) problems.push(problem);
};
const browser = await chromium.launch(process.env.AUDIT_BROWSER === "bundled" ? {} : { channel: "chrome" });
try {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1200 } })).newPage();
  await page.goto(`${WEB}/show/${id}`, { waitUntil: "networkidle" });
  await page.waitForSelector("tr[data-rowid]", { timeout: 30_000 });
  const ids = await page.evaluate(() => [...document.querySelectorAll("tr[data-rowid]")].map((tr) => (tr as HTMLElement).dataset.rowid!));
  if (ids.length !== ROWS.length) throw new Error(`the sheet shows ${ids.length} rows, expected ${ROWS.length}`);
  const idOf = Object.fromEntries(ROWS.map((r, i) => [r.title, ids[i]!]));

  // Start ~25 s into Warm up, the way the Start button does it: it names the
  // sheet's FIRST row, and the server must open on the clock's item instead.
  while (zoneNow() < S + 25) await sleep(200);
  if (zoneNow() > S + 40) throw new Error("setting up took too long — the start would not be part-way through Warm up");
  const ws = new WebSocket(`${SYNC.replace(/^http/, "ws")}/?rundown=${id}`);
  await new Promise((r) => ws.addEventListener("open", r));
  ws.send(JSON.stringify({ v: 1, t: "hello", auth: { kind: "session", token: "dev" }, device: "console" }));
  await sleep(800);
  const cmd = (action: string, rowId?: string) => ws.send(JSON.stringify({ v: 1, t: "cmd", id: `cr-${Math.random()}`, action, ...(rowId ? { rowId } : {}) }));
  const startedAt = zoneNow() - S;
  cmd("start", idOf["Doors"]);
  console.log(`  started ${startedAt.toFixed(1)} s into Warm up; running on the clock to Presentation (~${Math.round(153 - startedAt)} s)`);
  while (zoneNow() < S + 153) await sleep(250);
  cmd("stop");
  await sleep(1500);
  ws.close();

  // The record, as the server reads it.
  const record = (await (await fetch(`${SYNC}/rundowns/${id}/run-times`)).json()) as {
    rows: Record<string, { sec: number; runs: number; joinedAtMs?: number }>;
  };
  const run = (title: string) => record.rows[idOf[title]!];
  for (const t of NEVER_ON_AIR) ok(!run(t), `${t.padEnd(13)} never on air`, `${t} was on air for ${run(t)?.sec} s`);
  for (const t of EXACT) {
    const r = run(t);
    const planned = ROWS.find((x) => x.title === t)!.dur!;
    ok(r?.sec === planned && r.runs === 1, `${t.padEnd(13)} ran ${r?.sec ?? "—"} s of ${planned} s`, `${t} ran ${r?.sec ?? "nothing"} s over ${r?.runs ?? 0} go(es), planned ${planned} s`);
  }
  ok(run("Warm up")?.joinedAtMs != null, `Warm up       joined by the start`, "Warm up was not recorded as where the show started");

  // Whole seconds can hide a late step (0.6 s late in, 0.6 s late out still
  // rounds to the planned length), so read each clock move's own moment: it
  // must be the second the item was due, not the tick that noticed it — which
  // was up to a second later before 21 Oct.
  const zoneToMs = (sheetSec: number) => Date.now() - (zoneNow() - sheetSec) * 1000;
  const report = (await (await fetch(`${SYNC}/rundowns/${id}/report`)).json()) as { at: string; type: string; rowId: string | null }[];
  for (const r of ROWS.filter((x) => ["Relay", "Interval", "Wrap", "Ads", "Feature", "Presentation"].includes(x.title))) {
    const due = r.at ?? (r.title === "Relay" ? 60 : NaN);
    const entry = report.find((e) => e.rowId === idOf[r.title] && e.type !== "stop");
    const offMs = entry ? Date.parse(entry.at) - zoneToMs(S + due) : NaN;
    ok(Math.abs(offMs) <= 50, `${r.title.padEnd(13)} went on air ${entry ? `${offMs >= 0 ? "+" : ""}${Math.round(offMs)} ms` : "never"} from when it was due`, `${r.title} went on air ${entry ? `${Math.round(offMs)} ms` : "never"} from when it was due`);
  }

  // The sheet, as a person reads it.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".ran-chip", { timeout: 15_000 });
  await sleep(1000);
  const sheet = await page.evaluate(() => ({
    chips: Object.fromEntries(
      [...document.querySelectorAll("tr[data-rowid]")].map((tr) => [(tr as HTMLElement).dataset.rowid!, (tr.querySelector(".ran-chip") as HTMLElement | null)?.innerText.trim() ?? null]),
    ),
    ran: (() => {
      const v = [...document.querySelectorAll("[data-tip]")].find((e) => /The items played/.test((e as HTMLElement).dataset.tip ?? "")) as HTMLElement | undefined;
      return v ? `${(v.previousElementSibling as HTMLElement | null)?.innerText.trim() ?? ""} ${v.innerText.trim()}` : null;
    })(),
  }));
  const chip = (title: string) => sheet.chips[idOf[title]!] ?? null;
  const expect: Record<string, string | null> = {
    "Warm up": "joined late",
    "(0:20)": null,
    "(standby)": null,
    Interval: "in its items",
    ...Object.fromEntries(EXACT.map((t) => [t, "±0:00"])),
  };
  for (const [t, want] of Object.entries(expect))
    ok(chip(t) === want, `${t.padEnd(13)} reads ${chip(t) == null ? "nothing" : `"${chip(t)}"`}`, `${t} reads ${JSON.stringify(chip(t))}, expected ${JSON.stringify(want)}`);
  ok(sheet.ran === "On plan 0:00", `the readout reads "${sheet.ran}"`, `the over/under readout says ${JSON.stringify(sheet.ran)}, expected "On plan 0:00"`);
} finally {
  await browser.close();
  await fetch(`${SYNC}/rundowns/${id}`, { method: "DELETE" });
}

for (const p of problems) console.log(`    ${p}`);
console.log(problems.length ? `\n${problems.length} problem${problems.length === 1 ? "" : "s"}.` : "\nThe clock ran every item to the second, and the record says so.");
process.exit(problems.length ? 1 : 0);
