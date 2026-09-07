# Feature ideas, held for later

Twenty-three features seen on other run-sheet and cue-automation products
during the competitive sweep of 5–6 September 2026, rewritten here in terms
of what they would do for a showcaller on OpenCall. None is scheduled. The
notes on which product does what, and how, are in the local-only research
notes (not in this repo).

Read this when the day-to-day list in `BACKLOG.md` runs dry, or when a user
asks for something that sounds like one of these.

Suggested order when the time comes: 1, 2, 3, then 4 and 7 together, then
5, 6 and 9. Items 21–23 are only worth it once the ones before them exist.

## The list

1. **As-run report.** Every track-in stamped with the time, run counts and a
   note, exported as a spreadsheet. The server already keeps the transitions;
   this is a screen and an export. *Why first:* it is the one thing a
   producer asks for the morning after, and the data is already there.
2. **Over and under trail.** A chip on each played row saying how light or
   heavy it ran, a running total in the header, and a reset for the next
   rehearsal. *Why:* our Proj. end says where the night will land; this says
   which items put it there.
3. **Command palette.** Cmd+K to jump to any row by number or word, or run
   any action. *Why:* long sheets, and a caller who cannot take their eyes
   off the room to scroll.
4. **Reusable elements library.** Sponsor reads, anthem, half-time package
   kept once, dropped into any sheet, with an update pushed to every sheet
   using them.
5. **Read-time to duration.** Open a script cell, see the word count and a
   read time at three speeds, set the row's duration from it.
6. **Speaker messages.** Flash "wrap up" or "stretch two minutes" onto the
   timer and prompter screens.
7. **Copy and paste rows across sheets**, with columns mapped by name and
   type. Pairs with 4.
8. **Per-cell history with restore.** Who changed this cell, when, and put
   it back. Cheap: the document keeps every update already.
9. **Lock a row** so an approved cue cannot be edited during the show.
10. **Display view.** A big-screen strip for backstage: the item on air, the
    next three, one chosen column, the clock.
11. **Fire something on cue.** When a row goes on air, send an OSC or HTTP
    message so graphics, lighting or a Stream Deck follow the sheet.
12. **Collapsible groups with sub-numbering** for long sheets.
13. **Files, links and images in cells**, with links that survive into the
    PDF.
14. **Multiple concurrent callers** with a follow picker, for two pitches or
    a stage and a concourse.
15. **Export finish.** Word export of the script column, paper sizes, page
    breaks, saved per-department presets.
16. **Event guest page** with a QR code: one landing page listing every
    sheet for the day.
17. **Find and replace** across the sheet.
18. **Checklists in cells** with a strike-through when done.
19. **Editor presence.** See who else is in the sheet and which cell they
    are on.
20. **Hardware shuttle for the prompter**, with mappable speed presets.
21. **Step mode for crew phones.** A countdown to each person's next item
    that follows the caller without timecode. The role bar is most of this
    already.
22. **Rehearsal switches for automation.** Once item 11 exists: disable a
    single fire, or a whole device, and keep the cue visible.
23. **Timecode as a clock source.** Only if a pre-programmed segment is ever
    run.

## Already in OpenCall, for comparison

Named here so nobody builds them twice: live transport with Space to step,
clock-follow, planned and projected end, endings that branch on the result
(win, lose, draw, extra time, golden point), timing check with one-click
reconcile, strike and mute, key times, cue pool, crew notes against rows,
role bar with "you're on", prompter and timer screens, view-only links with
a viewer list, guest passes, per-user ink, version history and restore,
PDF and CSV export, import from XLSX, CSV and PDF with re-import, kinds of
show per sheet, five access levels.
