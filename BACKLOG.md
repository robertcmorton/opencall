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

- [x] **Find where the result has to be called.** DONE — `findDecisionPoints`
      in `packages/core/src/goldenPoint.ts`, 6 tests, mutation-verified.

      THE ANALYSIS ABOVE WAS WRONG and it is worth saying why. It named the
      `present` filter in `visibleOutcomesOf` as the blocker. Measured: **24 of
      the 27 sample sheets carry no outcome rows at all**, so the chooser never
      appears and that filter never runs. The binding constraint was that
      nothing told the app where full time is.

      The sheets do say — 22 of 27 name it in a row title, once per match on a
      double-header. `findDecisionPoints` reads that: the title must READ as
      full time (not "Full Time Wrap", not "READ 20 - Full Time Wrap"), and the
      row must carry a printed time OR be the banner that closes a match, which
      several production houses use instead. 19 of the 24 untagged sheets get a
      decision point; the 5 that do not are two documents with no match in them
      and three test fixtures.

- [x] **Ask at a decision point.** DONE 29 Aug, and it needed no new state,
      which is why it shrank. On a TAGGED sheet the chooser's Win/Lose/Draw
      play one block of rows and skip the others — the skipping IS the stored
      result. On an untagged sheet there are no rows to skip, so three of those
      four buttons would move nothing. The dock therefore offers the ONE thing
      that does something: build the extra period.
      NOT VERIFIED: the dock needs the show live AND a row active, and
      `activeRowId` stays null while a show counts down to its first item. Could
      not be exercised on the only production sheet. The hover strip beside CUE
      was verified live; the guard against building the block twice was verified
      with a full round trip.
- [x] **Insert the block when it is chosen**, and apply the shift. DONE 29 Aug —
      `insertGoldenPointAfter`, verified on production: four rows in, everything
      below +14:00, header end +14:00, one undo taking all of it back.
- [ ] **Only then remove the `extraInSheet` sniffing.** Removing it first is a
      REGRESSION: on an exhibition sheet carrying win/lose/draw rows it is
      currently the thing that produces the Draw button, and without it the
      second gate reduces the offer to win/lose. Fixtures need re-typing to the
      new kind of show first, which is a migration decision.
- [x] **Is two minutes the right hold?** ANSWERED 29 Aug: keep it, as an
      agreed PLACEHOLDER rather than a measurement. Said so in the code. The
      number to change when somebody times a real one.
- [x] **NRLW rules** — ANSWERED 29 Aug, and the answer is that the women's game
      needs NO kind of show of its own. Endings are identical to the men's:
      regular season is two five-minute halves of sudden-death golden point and
      a draw is declared if nobody scores (`nrl`); a final plays the ten minutes
      out whatever the score and then goes to continuous unlimited golden point
      (`nrl-finals`). Recorded in `eventTypes.ts` beside the types themselves.

      The competitions DO differ — an NRLW match is 70 minutes to the NRL's 80,
      two 35-minute halves against two of 40 — but that is not modelled here and
      does not need to be: a half's length comes from the sheet, which allots
      the wall clock for it (42:00 and 47:00, the extra seven minutes being the
      stoppages).

      ONE REAL GAP CAME OUT OF IT, now closed: a final that is still level after
      the ten minutes goes to an unlimited period, and the generated block ended
      at the second half. It would have run out of rows with a final still being
      played. `goldenPointBlock(label, mustSettle)` now adds a HOLDING and a
      sudden-death row carrying NO length, because nobody can say what that
      period costs until it is over.

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

- [x] **A pause that delays an item and ripples downward.** DONE 29 Aug as HOLD,
      beside CUE. The decision it was blocked on answered itself: `shiftFixedTimes`
      ALREADY moves printed times below on every nudge and every cue, so a hold
      rippling the same way follows the app's existing behaviour rather than
      inventing a rule for hard starts. Reuses `nudgeRow` outright — a hold is a
      nudge whose length nobody knew in advance.

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

## 4c. Deploy watch paths — DONE 29 August

Railway watches PATHS to decide whether a push needs a build, and neither
service watched `packages/`. A commit touching only `packages/core` was
answered "No deployment needed - watched paths not modified" — wrong, because
both apps depend on those packages. Four import fixes sat undeployed for over
an hour on 29 August and only shipped because a later commit happened to touch
`apps/web`.

- [x] **`/packages/**` added to the watched paths of BOTH services**, 29 August,
      via the Railway dashboard:

          opencall        /apps/web/**    +  /packages/**
          opencall-sync   /apps/sync/**   +  /packages/**

      Applied and redeployed; the deploy that followed carried the commits that
      had been stuck. Verified afterwards at `/api/version`: `92050e5`.

- [ ] **Root-level files are still unwatched** — `package.json`,
      `pnpm-lock.yaml`, `turbo.json`, `tsconfig`. A dependency bump or a
      workspace change deploys nothing on its own, for the same reason
      `packages/` did not. Not urgent and not yet hit, but it is the same trap
      with a different path. Decide whether to add them or turn watched paths
      off entirely.

## 4d. Each game has to stand out on the sheet

Asked for 29 August: "we need to make each game visually stand out in the
runsheet in both walkthrough and live".

A double-header sheet runs two matches through one running order — on the R26
sheet the NRLW game is items 31-50 and the NRL game 82-102 — and today they
look the same as the ad breaks between them. A showcaller scanning for where
the second game starts has only the words to go on.

- [x] **Give each match its own visible band** — FIRST CUT SHIPPED 29 Aug.
      Boundary is full time (`findDecisionPoints`), so it never has to find
      where a game begins; the band is a tinted edge on the row-number column,
      alternating, and absent on a single-game sheet. It shows in the editor,
      the walkthrough and live alike, because it is one row class.

      STILL OPEN, and wants the user's eye on it rather than more guessing:
      whether an edge is enough or it wants a labelled rule across the sheet;
      whether live should be louder than the editor; and whether the band
      should cover the whole run-up to a game (as now) or only the match
      itself, kick-off to full time. The run-up is included because full time
      is the only boundary the sheets state — narrowing it means finding the
      kick-off, which they word far less consistently.

      Original notes, still true:
      · matches already ARRIVE as long anchored rows carrying the whole half
        (42:00 for a 35-minute women's half, 47:00 for a 40-minute men's), and
        since 29 Aug the rows printed inside them are marked `contained` — so
        the extent of a match is already computed, not guessed;
      · `outcomeGame` already numbers games 1, 2, 3 where a sheet tags its
        endings, and `findDecisionPoints` now finds full time where it does
        not. Either could name the bands;
      · the grid already has banner rows (`group`) and branch lanes with their
        own styling, so there is a visual language to extend rather than
        invent.
      NEEDS A DECISION: colour per game, a labelled rule across the sheet, or
      an indent — and whether the walkthrough and live views want the same
      treatment as the editor or a louder one.

## 5. Fix, unscheduled

- [x] **The header at awkward widths.** HALF FIXED, half did not exist.
      The name really did stack over three lines — the one-line rule was capped
      at `max-width: 1024px` and 1025-1150 is exactly where the header is most
      cramped. Now unconditional.
      "Stop drops below Pause" DOES NOT REPRODUCE: measured live at 880, 1000,
      1030, 1120 and 1180, the transport keeps one row throughout.
- [x] **Sign out exists only on the dashboard.** FIXED 29 Aug — the Credentials
      block is a component the four admin pages share, so it cannot drift
      between them.

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
