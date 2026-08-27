# Backlog

Everything agreed but not yet built, roughly in the order it is worth doing.
When something here is finished, delete it from this file in the same commit
and describe it in [CHANGELOG.md](CHANGELOG.md) instead.

Kept in the repo rather than in a local note on purpose: a machine can be
restored from a backup a day old, and a list of what was still owed is exactly
the thing nobody writes down twice.

---

## 1. Look before building — these may already exist

Three of the agreed changes may be half-built already under other names. Each
is an hour of reading that could save a week of building a second mechanism
beside the first.

- [ ] **Items that are not part of the show** — a coin toss, a production
      meeting. They hold a place in the running order but must not shift the
      timing when cues change around them. `parallel` (runs alongside, takes no
      time in the order) and `milestone` (a deadline to hit, not an item to
      call) may already be exactly this. If so, this is a naming and visibility
      problem, not a new kind of row.
- [ ] **Strike / unstrike a cue item** — there is already a `skipped` flag that
      takes a row out of the timing. Decide whether striking IS skipping with a
      clearer name and a visible treatment, or genuinely a second state.
- [ ] **"My role" opens outside the margins on mobile** — the popup is
      positioned without keeping itself on screen. `keepTipsOnScreen` in
      `apps/web/lib` already solves this for tooltips.

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
