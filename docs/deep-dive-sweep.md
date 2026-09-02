# Deep-dive sweep

A repeatable pass over every surface, sheet and screen size, ending in a ranked
bug list and a fixing pass. Written on 2 September 2026 and run the same day;
Part 2 found five faults, three of which were invisible on screen after a whole
day of looking at it. Keep it in the repo rather than in a scratch folder — the
last test-sheet generator was lost that way, and with it the ability to answer a
question about how a sheet had imported.

Run this against OpenCall on `http://localhost:3000` with both dev servers up.
Work through it in order. **Record every finding as you go, before fixing
anything** — the fixing pass comes last, and a bug you fix on the way is a bug
you stop looking for neighbours of.

## Ground rules

1. **Measure, don't eyeball.** A screenshot proves a layout claim; a DOM
   measurement proves it repeatably. Prefer a scripted audit that returns
   numbers, and use screenshots to understand what a number means.
2. **The console is evidence.** Capture errors and warnings on every page load.
   A clean render with a React error in the console is not a pass.
3. **Separate "my tooling" from "the app".** Synthetic mouse events do not hold
   hover state, and confirm-style buttons lose their armed state between tool
   calls. If something fails, prove it fails with a real pointer before
   recording it as a bug.
4. **Do not report a symptom twice.** Group findings by cause.
5. **Never conclude from an empty result.** "No errors found" is only meaningful
   if you can show the check fires on a known bad case.

## Part 1 — the matrix

### Surfaces
- `/` landing
- `/admin`, `/admin/users`, `/admin/event-types`, `/admin/errors`
- `/account`
- `/show/[id]` — pre-show, walkthrough, and live
- `/view/[id]` — view-only
- `/timer/[id]`
- `/prompter/[id]`

### Sheets
- **Concurrency Test** — parallel rows, pre-records, a milestone bell
- **Golden Point Test** — 2,114 rows, 96 matches, endings written in
- **Finals test** (`test-sheets/finals-test.csv`) — import it; extra time then
  an open-ended golden point
- An **empty/new rundown** — the zero state is a surface too

### Viewports
| name | size | why |
|---|---|---|
| phone | 375×812 | the showcaller's pocket |
| phone landscape | 812×375 | short viewport, docks compete for height |
| tablet | 768×1024 | the reported "black bar" width |
| laptop | 1280×800 | the common case |
| desktop | 1727×997 | what it's usually built against |
| ultrawide | 2560×1080 | dead space and stretched columns |

Also check **dark and light**, since the theme is viewer-controlled.

## Part 2 — the automated audit

For every (surface × sheet × viewport), load cold and collect:

- **Horizontal overflow** — `scrollWidth > clientWidth` on the document and on
  every scroll container. Report the widest offending element and by how much.
  This is the "black bar down the right".
- **Elements past the right edge** — any element whose `right` exceeds the
  viewport width.
- **Console errors and warnings**, including React minified errors.
- **Unnamed interactive controls** — buttons/links with no text, no
  `aria-label`, no `aria-labelledby`. The transport had three.
- **Clipped text** — `scrollWidth > clientWidth` on text nodes that aren't
  deliberately truncated.
- **Contrast-critical states** — LIVE/PAUSED, overrun red, the result dock.
- **Touch target size** on phone — anything interactive under ~32px.

## Part 3 — the behaviour passes

Each of these on at least one sheet, on phone and on desktop:

1. **Transport** — start, pause, resume, next, prev, stop (two-step confirm).
   Does the sheet follow? Does the timer agree with the row?
2. **Clock follow** — on/off, and that it steps through untimed rows at their
   real length rather than racing.
3. **Cue and hold** — cue a row ahead (strike warning), hold past the end, GO.
4. **Nudges** — live-only now; confirm they are absent off air and present on
   the on-air row.
5. **Result chooser** — full time, each of win/lose/draw, golden point, and
   **calling a result late**, after the show has walked past the endings.
6. **Golden point, generated** — on a sheet with no block written in.
7. **Golden point, written in** — the Golden Point Test sheet.
8. **Finals** — extra time played out, then the cue must HOLD on the
   open-ended golden point rather than walk into the next match.
9. **Walkthrough** — click any row, prev/next, the popup, no cue dialog, and
   that scrolling hands control to the reader.
10. **Endings** — the expand triangle, the coloured bar and its vertical label,
    fork layout, and that the colours carry into the live sheet.
11. **Selection bar** — group, milestone, strike, colour, the corner close, and
    the win/lose/draw labelling menu.
12. **Import** — the finals CSV, a re-import over an existing rundown, and a
    malformed file.
13. **Export** — CSV and PDF, **from a narrow window**, and confirm every
    column survives.
14. **Prompter and timer** — do they follow the live cue and the walkthrough?
15. **Roles** — a follower must not see the transport; check what they *do* see.
16. **Reconnect** — kill the sync server, act, bring it back. Does the sheet
    recover without a reload?

## Part 4 — the bug list

Write each finding as:

```
ID · severity (show-stopper / wrong / rough / cosmetic)
WHERE   surface, sheet, viewport
WHAT    the observable failure, with the number that proves it
WHY     the cause, if known — file:line
```

Rank by **what it costs someone calling a live show**, not by how easy it is to
fix. A control that disappears mid-show outranks a misaligned heading.

## Part 5 — the fixing pass

Fix in rank order. For each:

- write the failing test **first** where the rule is testable in core or lib;
- fix;
- **mutation-test the guard** — break it deliberately and confirm exactly one
  named test fails;
- re-run the audit for that surface to confirm the finding is gone and nothing
  next to it moved;
- changelog and devlog entries in the same commit.

Anything not fixed goes back to the user with the reason, not silently dropped.
