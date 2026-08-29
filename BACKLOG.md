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
always write a block for it — the RD25 draft has no ending rows at all.

DECIDED, and no longer open:
 · Whether a fixture can go to extra time is a property of the FIXTURE, not of
   what somebody typed. A junior, trial or exhibition match is now its own kind
   of show. DONE.
 · The block is four rows: HOLDING / first half 5:00 / HOLDING / second half
   5:00. HOLDING is the word real sheets already use. DONE, tested.
 · Printed times after it MOVE by the whole length; times already gone to air
   never move; rows without a printed time are not given one. DONE, tested and
   mutation-checked.

WHAT IS LEFT is the wiring, and it is the part that can put a dead button on a
live screen, so it wants doing carefully:

- [ ] **Offer golden point on a sheet that has no golden rows.** There are TWO
      gates and only the second matters: `visibleOutcomesOf` filters what is
      offered by the outcomes actually PRESENT in the sheet, so a sheet with no
      golden row can never show the button however the competition is modelled.
      That filter has to relax for the generated case.
- [ ] **Insert the block when it is chosen**, and apply the shift. The core
      decides what the block is and what moves; this decides when.
- [ ] **Only then remove the `extraInSheet` sniffing.** Removing it first is a
      REGRESSION: on an exhibition sheet carrying win/lose/draw rows it is
      currently the thing that produces the Draw button, and without it the
      second gate reduces the offer to win/lose. Fixtures need re-typing to the
      new kind of show first, which is a migration decision.
- [ ] **Is two minutes the right hold?** It is a guess in the code and says so.
- [ ] **NRLW rules** — still unverified; nrl.com sends the page behind a
      sign-in. Same ten minutes in two halves? Can a regular-season match be
      drawn? If they differ it wants its own kind of show.

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

## 2. Coming back to a live show — DONE

- [x] **Reopening goes straight to the live row.** The position is now decided
      in the same frame the rows appear, before they are drawn, and refined once
      the real row heights are known.
- [x] **Mobile flashes through two wrong states.** Nothing that depends on the
      state of the show is drawn until the server has said what it is AND the
      clock has been measured. Proven by holding the answer back and looking.

## 3. Live-show controls

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

## 4b. Sheets that import with no title, time or lengths

Found 29 August by the import check's shape tests. Three sheets were reported.
Two are resolved and one is not a run sheet at all:

- [x] **`Runsheet Rd 11 v Dragons NRLW.pdf`** — FIXED. Its heading is on line 51,
      behind a title block, a Key Timings list and a Match Day Contacts table,
      and the search only looked at the first thirty lines. 242 rows with
      nothing mapped became 65 rows, 11:30 to 15:40, numbered 1-63.
- [x] **`190725 - Bulldogs v Dragons - Event Plan.pdf`** — NOT A BUG. It maps
      TIME and ACTIVITY correctly and simply has no duration column, because it
      is a schedule rather than a rundown. The import check was wrong to call
      zero seconds a fault; it now asks whether the sheet had lengths to lose.

- [ ] **`Event Information Plan - NRL Round 21 - Bulldogs v Sea Eagles.pdf`** —
      genuinely has NO table. It is a label-and-value information document
      (CODE & ROUND, GAME, DATE, then pages of prose); there is no heading-like
      line anywhere in it. Importing it produces 291 rows of nothing, and the
      shape check correctly says so.
      THE QUESTION IS A PRODUCT ONE, not a parsing one: what should the import
      screen do when handed a document that is not a run sheet? Saying "this
      does not look like a run sheet, here is what I found" is more useful than
      importing 291 empty rows and letting the person discover it. Wants
      deciding before building.

## 4c. A fix inside `packages/` never deploys on its own

Found on 29 August, after four import fixes sat undeployed for over an hour
while production kept serving a build from the day before.

Railway watches PATHS to decide whether a push needs a build. The web service's
watched paths do not include `packages/`, so a commit touching only
`packages/core` is answered with:

    "No deployment needed - watched paths not modified"

`apps/web` depends on `@opencall/core`, so this is wrong: a core fix changes the
web app. It went unnoticed because a later commit that happened to touch
`apps/web` finally carried all of them out together.

- [ ] **Add `packages/**` to the watched paths of BOTH Railway services**, or
      turn watched paths off. Needs the user's Railway login — Claude cannot
      change it.
      Until then the rule is: a commit that only touches `packages/` is NOT
      live, whatever the changelog says, and the version badge bottom-right of
      the dashboard is the only honest answer to "is it deployed".

- [ ] **A public build-identity endpoint.** "Is this deployed?" is currently
      answerable only by signing in and reading the badge, because there is no
      unauthenticated route that reports the build. `GET /version` on the sync
      host returning `{version, sha, builtAt}` would settle it from a script,
      and would have saved a good deal of guessing on 29 August.

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
- [ ] **Should a whole-minute time drop its trailing `:00`** in the planned
      figures — `9:00 AM` rather than `9:00:00 PM`?
- [ ] **Rename Skip to Strike, and surface "∥ Alongside"?** Both features exist
      and do what was asked; the words are the app's, not yours. Alongside is
      also buried behind a duration, where nothing suggests it means "not part
      of the show".
- [ ] **Should the timing nudges be available while EDITING a sheet, without
      CUE?** They are live-only now. If nudging a selected row is useful while
      building, the answer is to split the strip — CUE cannot be off-air
      whatever happens to the arrows.
- [ ] **Should a refused command look like the behind-the-clock bar?** That one
      now spans the screen; the refusal notice is still a centred pill, and how
      loud a refusal should be is a judgement rather than a tidy-up.

## 8. Housekeeping

- [ ] **Check who lost company access.** A migration deleted grants that named
      no company. Anyone who was meant to have that access needs it granted
      again, deliberately.
- [ ] **Delete the damaged dev databases.** `.pglite.damaged-*` and
      `.pglite.corrupt-*` are 93 MB of wreckage from 5 and 9 August.
