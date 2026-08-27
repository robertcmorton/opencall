# Backlog

Everything agreed but not yet built, roughly in the order it is worth doing.
When something here is finished, delete it from this file in the same commit
and describe it in [CHANGELOG.md](CHANGELOG.md) instead.

Kept in the repo rather than in a local note on purpose: a machine can be
restored from a backup a day old, and a list of what was still owed is exactly
the thing nobody writes down twice.

---

## 0. Golden point when the sheet does not mention it

Every proper rugby league game can go to golden point, and showcallers do not
always write a golden-point block into the sheet — the RD25 draft has no ending
rows at all. So the app must not decide whether extra time is possible by
looking for it on the page, which is what it does today.

THE COMPETITION RULES ARE ALREADY MODELLED, AND CORRECTLY. Checked against
en.wikipedia.org/wiki/Golden_point: level after 80 minutes plays five minutes,
teams swap ends, five more — ten minutes, any score wins at once, and in the
regular season nobody scoring means a draw. A final cannot be drawn and is
played on. `EVENT_TYPES` already says exactly this: `nrl` offers win/lose/golden
then win/lose/draw, `nrl-finals` offers win/lose after extra time and no draw.

SO THE ONLY THING WRONG IS THE OVERRIDE. `outcomesFor` takes `extraInSheet` and,
when the sheet carries no extra period, strips "Golden point" and offers "Draw".
Its comment defends a real case — "a junior or exhibition match is rugby league
and goes on a rugby league sheet, but nobody is playing golden point" — and the
case is real, but the SHEET is the wrong place to read it from.

- [ ] **Let the kind of show decide, and delete the sheet-sniffing.** A match
      that genuinely cannot go to extra time is a different KIND OF SHOW, and
      kinds of show are already a first-class per-sheet concept with a custom
      editor behind "Kinds of show". A junior or exhibition fixture should be
      its own kind that settles at full time — not a proper game whose sheet
      happened to omit a block.
- [ ] **A sheet with no golden rows still has to absorb the time.** Roughly ten
      minutes plus holding, and everything after full time moves. SAME MECHANISM
      AS THE RIPPLE PAUSE in section 3 — build one and the other is nearly free.

### The shape of a golden-point block

The laws say the teams swap ends with **no break**. The show still needs time
around it, so a run sheet is not simply two five-minute periods:

    HOLDING          before the first half of golden point
    Golden point 1   5 min
    HOLDING          before the second half
    Golden point 2   5 min

"HOLDING" is the label to use. Anything generated for a sheet that never
mentioned golden point should be built to this shape.

### Kick-off does not move

Broadcast carries exact times. So changing anything before the game starts must
NOT move the actual game start — trimming or extending the pre-game can only
consume its own slack, never push kick-off.

This is the answer to the question the ripple pause was waiting on, at least in
part: a row can be an anchor that absorbs change rather than passing it on, and
kick-off is the clearest example. Whatever the ripple does, it stops at kick-off
when it is coming from above it.

### Needs your answer

- [ ] **NRLW golden point rules.** Could not be verified — nrl.com/nrlw sends
      the page behind a sign-in, and following an authentication redirect is not
      something to do automatically. Are the women's rules the same ten minutes
      in two halves, and can an NRLW regular-season match be drawn? If they
      differ it wants its own kind of show, as the men's final already has.

## 1. Look before building — these may already exist

Three of the agreed changes may be half-built already under other names. Each
is an hour of reading that could save a week of building a second mechanism
beside the first.

ANSWERED. Two of the three already existed; the third is fixed.

- [x] **Items that are not part of the show** — ALREADY BUILT. `parallel` is
      exactly this, and it is offered as "∥ Alongside" in the duration popover:
      takes no time in the running order, and the transport steps over it.
      REMAINING QUESTION, for a person not a programmer: it is buried behind a
      duration and its name does not say "not part of the show". Rename or
      surface it?
- [x] **Strike / unstrike a cue item** — ALREADY BUILT as Skip, in the selection
      bar, already a toggle, and the row already renders struck through.
      REMAINING QUESTION: the app says "Skip" where you say "strike". Rename?
- [x] **"My role" opens outside the margins on mobile** — FIXED. It ran 39px off
      the left at 390px wide. Note for whoever reads the old claim here:
      `keepTipsOnScreen` could NOT be reused — it positions CSS pseudo-elements
      through custom properties, not real elements.

## 2. Coming back to a live show

Both of these are about what a returning caller sees, and both are worst on the
device most likely to have been locked in a pocket.

- [ ] **Reopening goes straight to the live row.** It opens at the top, syncs,
      then travels down — so the first thing shown is the wrong part of the
      sheet. The windowed list knows a row's offset before that row exists, so
      the first paint can already be in the right place.
- [ ] **Mobile flashes through two wrong states.** Returning shows the
      walkthrough, then the show with the timing wrong, then the correct cue
      row. The show state and the document arrive separately and every partial
      combination is being drawn. Nothing should be drawn until there is
      something true to draw.

## 3. Live-show controls

- [ ] **Strike a row instead of deleting it, while a show is live.** Delete
      becomes Strike: the row stays, visibly struck, and stops counting. A row
      deleted at 8:47 takes its history with it; a struck one leaves the as-run
      record honest about what was dropped and when.
- [ ] **A pause that delays an item and ripples downward.** When something
      overruns, push it and everything after it by the same amount rather than
      editing times by hand. Distinct from the transport Pause, which holds the
      clock — this moves the plan. NEEDS A DECISION FIRST: what it does to rows
      carrying a hard start time. Those are anchors, and rippling through one
      silently would move a time somebody printed.

## 4. Editing

- [ ] **Comments on line items.** A note attached to a row so a change can
      carry its reason. NEEDS DECISIONS FIRST: per-row or per-cell; whether
      they survive an import that replaces the sheet; who can see them.
- [ ] **Click a row during walkthrough to make it the active row.** It steps
      with Prev and Next only, so reaching a row means walking to it.

## 5. Fix, unscheduled

- [ ] **The header at awkward widths.** The sheet's name truncates to a few
      characters over three lines and the transport wraps so Stop drops below
      Pause. The left and middle cells, at the widths where the header goes
      vertical.
- [ ] **Sign out exists only on the dashboard.** The Credentials block is
      supplied by that page; every other admin screen passes a nav section
      without it. So there is one page with a way out and several without.

## 6. Known limits, accepted for now

Recorded so nobody rediscovers them as bugs.

- [ ] A write holds a pooled client across two statements since the transaction
      went in. It cannot deadlock, but many simultaneous live shows would
      serialise more than before. Not measured, and no pool size is configured.
- [ ] The transaction is proven on the embedded database only. The production
      driver's path was read, not run — production is the first place it
      executes.
- [ ] No test harness in `apps/sync` to host the rollback proof; it lives in a
      scratch script that ports over almost directly.
- [ ] The scope rules are proven from the browser for a caller signed in with a
      company token. The equivalent path for an ACCOUNT holding a company grant
      is three lines away in the same function and was never clicked.

## 7. Waiting on a decision

Nothing can start on these until they are answered.

- [ ] **The update button.** Designed, nothing built. Needs: whether deploy-on-
      push gets turned off (without it the button is decoration), the branch
      name, what "update automatically" is allowed to do, and a token created
      and set as an environment variable.
- [ ] **The grey concurrency bars** — keep, change or drop.
- [ ] **Should a stale session ever end by itself**, or only be flagged as it is
      now? Flagging was chosen deliberately: ending one on a timer would
      eventually stop a real show that sat quiet through a long delay.
- [ ] **Should the PLANNED block also show while live?** The instruction was
      that live carries only the end time and the clock; the reference images
      show it present at all times.
- [ ] **Should a whole-minute time drop its trailing `:00`** in the PLANNED
      block — `9:00 AM` rather than `9:00:00 PM`?

## 8. Housekeeping

- [ ] **Check who lost company access.** A migration deleted grants that named
      no company. Anyone who was meant to have that access needs it granted
      again, deliberately.
- [ ] **Delete the damaged dev databases.** `.pglite.damaged-*` and
      `.pglite.corrupt-*` are 93 MB of wreckage from 5 and 9 August.
