/**
 * Every screen, at phone, tablet, laptop and desktop sizes: does anything
 * spill off the edge, does the page slide sideways, is anything you press too
 * small for a finger? Measured, not looked at — screenshots missed three of
 * five layout bugs on 2 Sep, and a 14px sideways slide shipped on 6 Oct.
 *
 *   node apps/web/scripts/layout-audit.mts [base-url] [sheet-id]
 *
 * Against the local dev servers (web on :3010, sync on :8787, no admin token
 * set, so no sign-in). The sheet defaults to the first one the server lists.
 * Exits 1 when anything fails, with a line per problem.
 */
import { chromium, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:3010";
const sync = process.env.SYNC_URL ?? "http://localhost:8787";
const sheet =
  process.argv[3] ?? ((await (await fetch(`${sync}/rundowns`)).json()) as { id: string }[])[0]?.id ?? "";
if (!sheet) throw new Error("No sheet to test with: pass a sheet id, or create one.");

const SIZES = [
  { name: "phone", width: 375, height: 812, touch: true },
  { name: "tablet", width: 768, height: 1024, touch: true },
  { name: "laptop", width: 1024, height: 768, touch: false },
  { name: "desktop", width: 1440, height: 900, touch: false },
];
const PAGES = [
  "/admin",
  "/account",
  "/admin/users",
  "/admin/errors",
  "/admin/activity",
  "/admin/event-types",
  "/help",
  `/edit/${sheet}`,
  `/show/${sheet}`,
  `/view/${sheet}?code=DEV123`,
  `/timer/${sheet}`,
  `/prompter/${sheet}`,
  `/display/${sheet}`,
  `/changes/${sheet}`,
];

/** Runs in the page. Things inside a sideways-scrolling box are allowed past the edge. */
function measure(touch: boolean) {
  const vw = document.documentElement.clientWidth;
  const scrollsX = (el: Element) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll") return true;
    }
    return false;
  };
  const shown = (e: Element) =>
    e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden" && !e.closest(".sr-only, [aria-hidden=true]");
  const name = (e: Element) => ((e as HTMLElement).innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 24);
  const problems: string[] = [];
  const slide = document.documentElement.scrollWidth - vw;
  if (slide > 0) problems.push(`page slides sideways by ${slide}px`);
  for (const m of document.querySelectorAll("main")) if (m.scrollLeft > 0) problems.push(`<main> shifted ${m.scrollLeft}px`);
  for (const e of document.querySelectorAll("button, a, input, select, textarea, h1, h2, h3, label, [role=button], img, p, td, th")) {
    if (!shown(e) || scrollsX(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && (r.left < -1 || r.right > vw + 1)) problems.push(`off the edge: "${name(e)}" (${Math.round(r.left)}…${Math.round(r.right)})`);
  }
  if (touch)
    for (const e of document.querySelectorAll("button, a, input, select, [role=button]")) {
      if (!shown(e)) continue;
      // Links inside a sentence are exempt (WCAG 2.5.8): they size with the text.
      if (e.tagName === "A" && e.closest("p, li") && !e.closest("nav")) continue;
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24)) problems.push(`too small for a finger: "${name(e)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  return [...new Set(problems)];
}

/** On a sheet: put the box on a cell and move it about — the 6 Oct slide only appeared then. */
async function drive(page: Page) {
  const td = page.locator("tr[data-rowid] td[data-colid]").first();
  if (!(await td.count())) return;
  await td.click();
  for (const k of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown"])
    await page.keyboard.press(k);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

const browser = await chromium.launch({ channel: "chrome" });
let failures = 0;
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.width < 600 });
  const page = await context.newPage();
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const before = await page.evaluate(measure, size.touch);
    let after: string[] = [];
    if (/^\/(edit|show)\//.test(path) && !size.touch) {
      await drive(page);
      after = (await page.evaluate(measure, size.touch)).filter((p) => !before.includes(p)).map((p) => `after moving the box: ${p}`);
    }
    const all = [...before, ...after];
    failures += all.length;
    console.log(`${all.length ? "✗" : "✓"} ${size.name.padEnd(7)} ${path}`);
    for (const p of all) console.log(`    ${p}`);
  }
  await context.close();
}
await browser.close();
console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"}.` : "\nEvery screen fits at every size.");
process.exit(failures ? 1 : 0);
