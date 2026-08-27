# Backlog

Work agreed but not yet started. Newest additions at the top of their section.
When something here is built, delete it from this file in the same commit and
describe it in [CHANGELOG.md](CHANGELOG.md) instead.

Kept in the repo rather than in a local note on purpose: a machine can be
restored from a backup that is a day old, and a list of what was still owed is
exactly the thing nobody writes down twice.

## Live show

**Strike a row instead of deleting it, while a show is live.**
During a show the destructive Delete becomes Strike: the row stays on the sheet,
visibly struck through, and stops counting. A row deleted at 8:47 takes its
history with it and cannot be explained afterwards; a struck one leaves the
as-run record honest about what was dropped and when.

**Strike and unstrike any cue item.**
The same mark, available as a toggle rather than only through the transport, so
a decision can be taken back. Note this overlaps with the existing `skipped`
flag — check whether striking IS skipping with a clearer name and a visible
treatment, or genuinely a second state, before building a second mechanism.

**A pause that delays an item and ripples downward.**
When something overruns, push it and everything after it by the same amount
rather than editing times by hand. Distinct from the existing transport Pause,
which holds the clock; this moves the plan. Needs a clear answer for what it
does to rows carrying a hard start time — those are anchors, and rippling
through one silently would move a time somebody printed.

**Items that are not part of the show — a coin toss, a production meeting.**
They occupy a place in the running order but must not shift the timing when
cues change around them. CHECK FIRST: `parallel` (runs alongside, takes no time)
and `milestone` (a deadline to hit, not an item to call) may already be this, or
most of it. If they are, this is a naming and visibility problem rather than a
new kind of row.

## Coming back to a running show

**Reopening goes straight to the live row.**
Today it opens at the top, then syncs, then travels down — so the first thing a
returning caller sees is the wrong part of the sheet. It should arrive already
there. Related to the retry loop in `RundownEditor` that waits for the live row
to be rendered before centring; the windowed list knows the offset before the
row exists, so the first paint can be in the right place.

**Mobile flashes through two wrong states on return.**
Coming back to the mobile view shows the walkthrough, then the show with the
timing wrong, then finally the correct cue row. Three states rendered before the
right one — the show state and the document arrive separately, and each partial
combination is being drawn. Nothing should be drawn until there is something
true to draw.

## Editing and layout

**Comments on line items, for changes.**
A note attached to a row so a change can carry its reason. Open questions worth
settling before building: whether they are per-row or per-cell, whether they
survive an import that replaces the sheet, and who can see them.

**Click a row during walkthrough to make it the active row.**
Walkthrough steps with Prev and Next only, so getting to a row means walking to
it. Clicking it should take it directly.

**"My role" opens outside the margins on mobile.**
The popup is positioned without keeping itself on screen. `keepTipsOnScreen` in
`apps/web/lib` already solves this for tooltips and is the obvious thing to
reuse.

## Known, not yet scheduled

- A write holds a pooled client across two statements since the transaction went
  in; many simultaneous live shows would serialise more than before. Not
  measured, and no pool size is configured.
- The transaction is proven on the embedded database only. The production
  driver's path was read, not run — production is the first place it executes.
- No test harness in `apps/sync` to host the rollback proof; it currently lives
  in a scratch script.
- The header at awkward widths: the sheet's name truncates to a few characters
  over three lines and the transport wraps so Stop drops below Pause.
