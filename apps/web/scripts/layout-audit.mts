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
/**
 * Rugby league with the game not yet chosen, so the sheet pages carry the
 * match card at its biggest — open, asking which game it is (21 Oct). The
 * seed sheet has no kind of show, and without one the card never drew.
 */
await fetch(`${sync}/rundowns/${sheet}`, {
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ sport: "rugby-league" }),
});

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
  /**
   * The endings (21 Oct): the Full time header and each ending's one line
   * live inside table cells, which every check above leaves alone. Their
   * pieces — "If we win", "3 rows · 3:30", "playing", Change — must not sit
   * on each other, and must not run past the side of the sheet: a line that
   * says "not playing" off the right of a phone is a line that says nothing.
   */
  for (const line of document.querySelectorAll(".ft-body, .path-toggle")) {
    if (!shown(line)) continue;
    // 21 Oct: on a phone the line was given the 54px duration column, and
    // read one word to a line. Nothing overlapped, so nothing else saw it.
    // Fixed, it has the item column — 132px on a phone, the width every
    // row's own text gets there — so the floor sits below that.
    const w = line.getBoundingClientRect().width;
    if (w < 100) problems.push(`ending line squeezed into ${Math.round(w)}px: "${name(line)}"`);
    const parts = [...line.children].filter((k) => shown(k) && (k as HTMLElement).innerText?.trim());
    const rects = parts.map((k) => k.getBoundingClientRect());
    for (let i = 0; i < parts.length; i++) {
      for (let j = i + 1; j < parts.length; j++)
        if (overlap(rects[i]!, rects[j]!) > 4) problems.push(`ending line, on top of each other: "${name(parts[i]!)}" and "${name(parts[j]!)}"`);
      // Cut off sideways by the box it scrolls in. Only rows in view — a row
      // scrolled out of the sheet top or bottom is not a finding.
      const r = rects[i]!;
      for (let p = line.parentElement; p; p = p.parentElement) {
        const st = getComputedStyle(p);
        if (st.overflowX === "visible") continue;
        const c = p.getBoundingClientRect();
        if (r.bottom <= c.top || r.top >= c.bottom) break;
        if (r.left < c.left - 1 || r.right > c.right + 1)
          problems.push(`ending line cut off: "${name(parts[i]!)}" (${Math.round(r.left)}…${Math.round(r.right)}, box ${Math.round(c.left)}…${Math.round(c.right)})`);
        break;
      }
    }
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
  // A button something else is drawn over is a finding, not a crash (21 Oct:
  // the iPad nudge bar covered the Message button, and the check died on it).
  try {
    await b.click({ timeout: 5000 });
  } catch {
    const cover = await b.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return top && !el.contains(top) ? (top.closest("[class]") as HTMLElement | null)?.className.toString().split(" ")[0] ?? top.tagName : "something";
    });
    liveCrew.push(`can't press "${label}": ${cover} is drawn over it`);
    return false;
  }
  await page.waitForTimeout(350);
  return true;
}

/**
 * The show page in the states a resting load never reaches. Each yields a
 * label for its measurements. Leaves the show stopped.
 */
async function* showStates(page: Page, size: (typeof SIZES)[number]): AsyncGenerator<string> {
  yield* endingStates(page);
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
  if (await press(page, /^Message$/)) {
    yield "live, Message box open";
    // Up for everyone (21 Oct): the button must keep its width with a long
    // message on it — it used to widen the controls box onto two lines.
    await page.locator('.speaker-to button[role="radio"]', { hasText: "Everyone" }).first().click().catch(() => undefined);
    await page.locator(".speaker-pop input").first().fill("Hold the walk-out for two minutes, the anthem singer is not ready yet");
    await page.locator(".speaker-pop button[type=submit]").first().click().catch(() => undefined);
    await page.waitForTimeout(400);
    yield "live, a long message up";
    await page.locator(".speaker-toggle").first().click().catch(() => undefined);
    await page.locator(".speaker-pop button", { hasText: "Take down" }).first().click().catch(() => undefined);
    await page.waitForTimeout(200);
  }
  yield* fullTimeStates(page);
  // Stop asks twice; its second face is labelled "Confirm — end the show now".
  await page.locator('.show-state button[aria-label="Stop the show"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('.show-state button[aria-label^="Confirm"]').first().click();
  await page.waitForTimeout(1200);
  yield "after the show (End event bar)";
}
const liveCrew: string[] = [];

/**
 * Scroll the sheet until the Full time line is in view; false when the sheet
 * has none. The sheet builds only the rows near the screen, and the endings
 * sit at the foot of the demo sheet — on a phone, and live on a desktop, they
 * were never built at all, so nothing in them was measured (21 Oct). Moves
 * the sheet up and down only: a sideways scroll is itself a finding.
 */
async function toEndings(page: Page): Promise<boolean> {
  const found = await page.evaluate(async () => {
    const scroller = () => {
      const g = document.querySelector(".grid-scroll");
      for (let p = g; p; p = p.parentElement) {
        const o = getComputedStyle(p).overflowY;
        if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
      }
      return document.scrollingElement ?? document.documentElement;
    };
    const wait = () => new Promise((r) => setTimeout(r, 300));
    // Walk down a screen at a time until the line is built.
    for (let n = 0; n < 40 && !document.querySelector(".ft-row"); n++) {
      const s = scroller();
      if (s.scrollTop + s.clientHeight >= s.scrollHeight - 1) break;
      s.scrollTop += Math.max(200, s.clientHeight * 0.8);
      await wait();
    }
    const ft = document.querySelector(".ft-row");
    if (!ft) return false;
    const s = scroller();
    const top = s === document.scrollingElement ? 0 : s.getBoundingClientRect().top;
    // A little below the top: the sheet's own header row is sticky there.
    s.scrollTop += ft.getBoundingClientRect().top - top - 120;
    await wait();
    return true;
  });
  await page.waitForTimeout(200);
  return found;
}

/**
 * The endings with one opened by hand (21 Oct). At rest every ending is one
 * folded line; opened, its rows draw under it. Folds it back afterwards.
 */
async function* endingStates(page: Page): AsyncGenerator<string> {
  if (!(await toEndings(page))) {
    // The demo sheet has endings; a sheet page that draws none means they
    // have stopped being measured, which is a failure, not a pass.
    if (process.env.AUDIT_EXPECT_ENDINGS) liveCrew.push("the sheet's endings are not drawn, so they go unmeasured");
    return;
  }
  yield "scrolled to the endings";
  const toggle = page.locator(".path-toggle:visible:enabled").first();
  if (!(await toggle.count())) return;
  await toggle.click();
  await page.waitForTimeout(300);
  yield "with an ending opened";
  await toggle.click().catch(() => undefined);
  await page.waitForTimeout(200);
}

/**
 * Live, at full time: the result bar up, a result called, and a skipped
 * ending opened (21 Oct). Steps the cue with Space — a live show has no Next
 * button — until the bar appears. The demo match puts a 30-second siren row
 * before its endings, so the bar comes up there, counting down, with every
 * ending still folded. Takes the result back afterwards, so the next size
 * starts from the same sheet.
 */
async function* fullTimeStates(page: Page): AsyncGenerator<string> {
  if (!(await toEndings(page))) return;
  const dock = page.locator(".outcome-dock:not(.end-event-dock):visible");
  for (let n = 0; n < 40 && !(await dock.count()); n++) {
    // Space on a focused button would press it rather than step the cue.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
  }
  if (!(await dock.count())) {
    liveCrew.push("the result bar never came up at full time");
    return;
  }
  await page.waitForTimeout(300);
  yield "live at full time (result bar up)";
  const win = page.locator(".outcome-dock .od-pick.od-win").first();
  if (!(await win.count())) {
    liveCrew.push("the result bar offers no Win");
    return;
  }
  await win.click();
  await page.waitForTimeout(500);
  const status = await page.locator(".path-status").allInnerTexts();
  if (!status.some((s) => /^playing$/i.test(s.trim())) || !status.some((s) => /not playing/i.test(s)))
    liveCrew.push(`a called result should mark one ending "playing" and the rest "not playing" (saw: ${status.join(", ") || "nothing"})`);
  yield "live, result called";
  const skipped = page.locator(".path-row.is-out .path-toggle:enabled").first();
  if (await skipped.count()) {
    await skipped.click();
    await page.waitForTimeout(300);
    yield "live, a skipped ending opened";
    await skipped.click().catch(() => undefined);
  }
  // Change, on the bar: every ending possible again.
  await page.locator(".outcome-dock .od-reset").first().click().catch(() => undefined);
  await page.waitForTimeout(300);
}

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

/**
 * A crew phone raising a note: pick a row, open Notes, type. The box could be
 * opened and never typed in on a view-only link (18 Oct) — so this also fails
 * when the box is switched off.
 */
async function* viewStates(page: Page): AsyncGenerator<string> {
  yield* endingStates(page);
  const row = page.locator("tr[data-rowid]").first();
  if (await row.count()) await row.click();
  const notes = page.locator("button:visible", { hasText: "Notes" }).first();
  if (!(await notes.count())) return;
  await notes.click();
  await page.waitForTimeout(300);
  const box = page.locator(".note-compose textarea").first();
  if (await box.count()) {
    if (await box.isDisabled()) liveCrew.push("view: the note box can't be typed in");
    else await box.fill("Layout check");
  }
  yield "with a note being written";
  await notes.click();
}

// AUDIT_BROWSER=bundled uses Playwright's own Chromium. Installed Chrome is
// the default (it is what CI has), but a Chrome with an update waiting to
// restart quit under the check three runs in a row on 20 Oct.
const browser = await chromium.launch(process.env.AUDIT_BROWSER === "bundled" ? {} : { channel: "chrome" });
browser.on("disconnected", () => console.log("    !! the browser itself went away"));
const browserClosedNote = (_: string) => undefined;
/** A crew link asks who is watching first; answer it, or the sheet behind is never measured. */
const NAMED = "localStorage.setItem('oc:viewer:name', 'Layout check')";
let failures = 0;
for (const size of SIZES) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, hasTouch: size.touch, isMobile: size.width < 600 });
  await context.addInitScript(NAMED);
  const page = await context.newPage();
  // A crashed tab or browser is a finding, not a mystery "page closed".
  page.on("crash", () => console.log(`    !! the page crashed (${size.name}, ${page.url()})`));
  context.on("close", () => console.log(`    !! the browser context closed (${size.name})`));
  browserClosedNote(size.name);
  for (const path of PAGES) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const before = await page.evaluate(measure, size.touch);
    let after: string[] = [];
    if (/^\/(edit|show)\//.test(path) && !size.touch) {
      await drive(page);
      after = (await page.evaluate(measure, size.touch)).filter((p) => !before.includes(p)).map((p) => `after moving the box: ${p}`);
    }
    const states = /^\/show\//.test(path)
      ? showStates(page, size)
      : path === "/admin"
        ? dashboardStates(page)
        : /^\/view\//.test(path)
          ? viewStates(page)
          : /^\/edit\//.test(path)
            ? endingStates(page)
            : null;
    const measured: string[] = [];
    if (states)
      for await (const label of states) {
        measured.push(label);
        const found = (await page.evaluate(measure, size.touch)).filter((p) => !before.includes(p));
        after.push(...found.map((p) => `${label}: ${p}`));
      }
    after.push(...liveCrew.splice(0));
    const all = [...before, ...after];
    failures += all.length;
    console.log(`${all.length ? "✗" : "✓"} ${size.name.padEnd(7)} ${path}`);
    for (const p of all) console.log(`    ${p}`);
    // AUDIT_STATES=1 lists what was measured beyond the page at rest.
    if (process.env.AUDIT_STATES && measured.length) console.log(`    measured: ${measured.join(" · ")}`);
  }
  await context.close();
}
await browser.close();
await fetch(`${sync}/rundowns/${sheet}/join-codes/${crewCode}`, { method: "DELETE" }).catch(() => undefined);
console.log(failures ? `\n${failures} problem${failures === 1 ? "" : "s"}.` : "\nEvery screen fits at every size.");
process.exit(failures ? 1 : 0);
