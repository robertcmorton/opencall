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
 *
 * Not only resting pages (6 Oct, after two misses it could not see): the show
 * page is also measured with Start pressed (the "things to look at" warning),
 * live, stopped (the End event bar), walking through, with the row menu and
 * ⌘K open; the crew pages while the show is live; the dashboard mid-search.
 * NOTE: that starts and stops a show on the sheet it tests — harmless on the
 * throwaway database `pnpm test:layout` makes, worth knowing on a dev one.
 */
import { chromium, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:3010";
const sync = process.env.SYNC_URL ?? "http://localhost:8787";
const sheet =
  process.argv[3] ?? ((await (await fetch(`${sync}/rundowns`)).json()) as { id: string }[])[0]?.id ?? "";
if (!sheet) throw new Error("No sheet to test with: pass a sheet id, or create one.");
/**
 * A real view-only link for the crew pages, removed at the end. The dev code
 * DEV123 is not a stored code, so every lookup of it counts as a wrong guess
 * and after 30 in 15 minutes the server refuses the address — a few runs in a
 * row and the crew page quietly lost its live connection (6 Oct).
 */
const crewCode = ((await (
  await fetch(`${sync}/rundowns/${sheet}/join-codes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ role: "follower", label: "Layout check" }),
  })
).json()) as { code?: string }).code;
if (!crewCode) throw new Error("Could not make a view-only link for the crew pages.");

// AUDIT_SIZES=laptop,phone runs just those.
const SIZES = [
  { name: "phone", width: 375, height: 812, touch: true },
  { name: "tablet", width: 768, height: 1024, touch: true },
  { name: "laptop", width: 1024, height: 768, touch: false },
  { name: "desktop", width: 1440, height: 900, touch: false },
].filter((s) => !process.env.AUDIT_SIZES || process.env.AUDIT_SIZES.split(",").includes(s.name));
// AUDIT_PAGES=show,view runs just the pages whose path contains one of those.
const ALL_PAGES = [
  "/admin",
  "/account",
  "/admin/users",
  "/admin/errors",
  "/admin/activity",
  "/admin/event-types",
  "/help",
  `/edit/${sheet}`,
  `/show/${sheet}`,
  `/view/${sheet}?code=${crewCode}`,
  `/timer/${sheet}`,
  `/prompter/${sheet}`,
  `/display/${sheet}`,
  `/changes/${sheet}`,
];
const PAGES = ALL_PAGES.filter((p) => !process.env.AUDIT_PAGES || process.env.AUDIT_PAGES.split(",").some((w) => p.includes(w)));

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
  for (const e of document.querySelectorAll("button, a, input, select, textarea, h1, h2, h3, label, [role=button], img, p, td, th, .preflight, .popover, [data-popover], [role=menu], dialog[open]")) {
    if (!shown(e) || scrollsX(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && (r.left < -1 || r.right > vw + 1)) problems.push(`off the edge: "${name(e)}" (${Math.round(r.left)}…${Math.round(r.right)})`);
  }
  /**
   * Things drawn on top of each other. Two controls that overlap, or a control
   * sitting across the edge of a box it is not in (6 Oct: Message stage on the
   * LIVE / Stop box's top border). Only within one layer: a menu, dock or
   * pop-up is MEANT to cover the page, so each is compared with what shares
   * its nearest positioned (fixed / absolute / sticky) ancestor. Parts
   * scrolled out of their box are cut off first.
   */
  // A real pop-up covers the page on purpose. A FIXED bar or button does
  // not: the menu button sat over the show controls on a phone (6 Oct), so
  // fixed things count as part of the page unless they are an overlay.
  const OVERLAY = "[role=menu], [role=dialog], dialog, [role=listbox], .popover, [data-popover], .preflight, .row-menu, .row-menu-backdrop, .app-notes, .jump-backdrop, .tooltip";
  const layerOf = (e: Element) => {
    for (let p: Element | null = e; p; p = p.parentElement) {
      if (p.matches(OVERLAY)) return p;
      const pos = getComputedStyle(p).position;
      if (pos === "fixed") continue;
      if (pos === "fixed" || pos === "absolute" || pos === "sticky") return p;
    }
    return document.documentElement;
  };
  const visibleRect = (e: Element) => {
    const r = e.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let p = e.parentElement; p; p = p.parentElement) {
      const st = getComputedStyle(p);
      if (st.overflowX === "visible" && st.overflowY === "visible") continue;
      const c = p.getBoundingClientRect();
      left = Math.max(left, c.left);
      top = Math.max(top, c.top);
      right = Math.min(right, c.right);
      bottom = Math.min(bottom, c.bottom);
    }
    return right - left > 1 && bottom - top > 1 ? { left, top, right, bottom } : null;
  };
  const CONTROL = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], .live-badge";
  const controls = [...document.querySelectorAll(CONTROL)]
    .filter((e) => shown(e) && !e.closest("td, th, .bar-fill, .row-menu, .tooltip, .app-notes"))
    .map((e) => ({ e, r: visibleRect(e), layer: layerOf(e) }))
    .filter((x) => x.r);
  const overlap = (a: DOMRectLike, b: DOMRectLike) =>
    Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  type DOMRectLike = { left: number; top: number; right: number; bottom: number };
  for (let i = 0; i < controls.length; i++)
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.layer !== b.layer || a.e.contains(b.e) || b.e.contains(a.e)) continue;
      if (overlap(a.r!, b.r!) > 4) problems.push(`on top of each other: "${name(a.e)}" and "${name(b.e)}"`);
    }
  const BOXES = ".show-state, .preshow-group, .show-state-row, .stopwatch, .preflight, .outcome-dock, .card, .crew-tabbar, .save-status, .install-hint";
  for (const box of document.querySelectorAll(BOXES)) {
    if (!shown(box)) continue;
    const br = visibleRect(box);
    if (!br) continue;
    const layer = layerOf(box);
    for (const c of controls) {
      if (box.contains(c.e) || c.e.contains(box) || c.layer !== layer) continue;
      const o = overlap(c.r!, br);
      const area = (c.r!.right - c.r!.left) * (c.r!.bottom - c.r!.top);
      // Partly in, partly out: straddling the box's edge.
      if (o > 4 && o < area - 4) problems.push(`across the edge of a box: "${name(c.e)}" over ${box.className.split(" ")[0]}`);
    }
  }
  /**
   * Rows of controls that must stay one line from laptop width up. A wrap
   * there grows the header and pushes the sheet down — 40 → 114px when the
   * "things to look at" warning sat inside the row (6 Oct).
   */
  if (vw >= 1000)
    for (const row of document.querySelectorAll(".preshow-group, .show-state, .show-state-row")) {
      if (!shown(row) || row.closest(".caller-dock") && getComputedStyle(row.closest(".caller-dock")!).position === "fixed") continue;
      // Every control in the row, at any depth — a box that wraps around two
      // lines of buttons is still one child (6 Oct: Message stage above LIVE).
      const kids = [...row.querySelectorAll(CONTROL)].filter((k) => shown(k) && !k.closest(".preflight, .popover, [data-popover]"));
      const tops = kids.map((k) => k.getBoundingClientRect());
      const shared = tops.every((r) => tops.every((q) => r.top < q.bottom && q.top < r.bottom));
      if (!shared) problems.push(`controls split onto two lines: ${row.className.split(" ")[0]} (${Math.round(row.getBoundingClientRect().height)}px tall)`);
    }
  if (touch)
    for (const e of document.querySelectorAll("button, a, input, select, [role=button]")) {
      if (!shown(e)) continue;
      // Links inside a sentence are exempt (WCAG 2.5.8): they size with the text.
      if (e.tagName === "A" && e.closest("p, li") && !e.closest("nav")) continue;
      const r = e.getBoundingClientRect();
      // An invisible hit area drawn by ::before (inset below zero) counts:
      // it is what the finger actually lands on.
      const hit = getComputedStyle(e, "::before");
      const grow = (side: string) => (hit.position === "absolute" && hit.content !== "none" ? Math.max(0, -parseFloat(side) || 0) : 0);
      const w = r.width + grow(hit.left) + grow(hit.right);
      const h = r.height + grow(hit.top) + grow(hit.bottom);
      if (r.width > 0 && r.height > 0 && (h < 24 || w < 24)) problems.push(`too small for a finger: "${name(e)}" ${Math.round(w)}×${Math.round(h)}`);
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

/** Click the first visible button whose text ends with `label`; false when there is none. */
async function press(page: Page, label: string | RegExp) {
  const b = page.locator("button:visible", { hasText: label }).first();
  if (!(await b.count())) return false;
  await b.click();
  await page.waitForTimeout(350);
  return true;
}

/**
 * The show page in the states a resting load never reaches. Each yields a
 * label for its measurements. Leaves the show stopped.
 */
async function* showStates(page: Page, size: (typeof SIZES)[number]): AsyncGenerator<string> {
  // Walkthrough, before the doors: Next starts it (the "Walkthrough" beside
  // it is a label, not a button).
  const next = page.locator('.preshow-group button[aria-label="Next row"]').first();
  if ((await next.count()) && (await next.isEnabled())) {
    await next.click();
    await page.waitForTimeout(400);
    yield "walking through";
    await page.locator('.preshow-group button[aria-label="End walkthrough"]').first().click().catch(() => undefined);
    await page.waitForTimeout(300);
  }
  // The row menu and ⌘K (a mouse thing and a keyboard thing).
  if (!size.touch) {
    const row = page.locator("tr[data-rowid] td[data-colid]").nth(2);
    if (await row.count()) {
      await row.click({ button: "right" });
      await page.waitForTimeout(250);
      yield "with the row menu open";
      await page.keyboard.press("Escape");
    }
    await page.keyboard.press("Meta+k");
    await page.waitForTimeout(250);
    yield "with ⌘K open";
    await page.keyboard.press("Escape");
  }
  // Start: the "things to look at" warning, if this sheet has any.
  if (!(await press(page, "Start show"))) return;
  if (await page.locator(".preflight:visible").count()) {
    yield "with Start pressed (warning up)";
    await press(page, "Start anyway");
  }
  await page.waitForTimeout(1200);
  yield "live";
  for (const crew of [`/view/${sheet}?code=${crewCode}`, `/timer/${sheet}`]) {
    const other = await page.context().newPage();
    await other.goto(base + crew, { waitUntil: "networkidle" });
    await other.waitForTimeout(1200);
    const found = await other.evaluate(measure, size.touch);
    // The crew must be able to see the show is on air (5 Oct fix).
    if (crew.startsWith("/view/") && !(await other.locator(".live-badge:visible").count())) found.push("crew can't see that the show is LIVE");
    await other.close();
    if (found.length) liveCrew.push(...found.map((p) => `${crew.split("/")[1]} while live: ${p}`));
  }
  if (await press(page, "Message stage")) {
    yield "live, Message stage open";
    await page.keyboard.press("Escape");
  }
  // Stop asks twice; its second face is labelled "Confirm — end the show now".
  await page.locator('.show-state button[aria-label="Stop the show"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.show-state button[aria-label^="Confirm"]').first().click();
  await page.waitForTimeout(1200);
  yield "after the show (End event bar)";
}
const liveCrew: string[] = [];

/** The dashboard while searching for something that is not there. */
async function* dashboardStates(page: Page): AsyncGenerator<string> {
  const search = page.locator("input[type=search], input[placeholder*=Search]").first();
  if (!(await search.count())) return;
  await search.fill("golden");
  await page.waitForTimeout(250);
  yield "searching";
  await search.fill("zzzz-nothing");
  await page.waitForTimeout(250);
  yield "searching, nothing found";
  await search.fill("");
}

const browser = await chromium.launch({ channel: "chrome" });
/** A crew link asks who is watching first; answer it, or the sheet behind is never measured. */
const NAMED = "localStorage.setItem('oc:viewer:name', 'Layout check')";
let failures = 0;
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.width < 600 });
  await context.addInitScript(NAMED);
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
    const states = /^\/show\//.test(path) ? showStates(page, size) : path === "/admin" ? dashboardStates(page) : null;
    if (states)
      for await (const label of states) {
        const found = (await page.evaluate(measure, size.touch)).filter((p) => !before.includes(p));
        after.push(...found.map((p) => `${label}: ${p}`));
      }
    after.push(...liveCrew.splice(0));
    const all = [...before, ...after];
    failures += all.length;
    console.log(`${all.length ? "✗" : "✓"} ${size.name.padEnd(7)} ${path}`);
    for (const p of all) console.log(`    ${p}`);
  }
  await context.close();
}
await browser.close();
await fetch(`${sync}/rundowns/${sheet}/join-codes/${crewCode}`, { method: "DELETE" }).catch(() => undefined);
console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"}.` : "\nEvery screen fits at every size.");
process.exit(failures ? 1 : 0);
