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
- [x] **The `extraInSheet` sniffing is gone** — DONE 30 Aug. Whether golden
      point can be played is now asked of the KIND OF SHOW alone. Checked the
      live data first: production carries one event, typed "Rugby league (NRL)
      — regular season", which is professional and correctly offers golden
      point, so nothing needed re-typing. Original note:
- [ ] ~~Remove the `extraInSheet` sniffing~~ The user gave
      the rule on 30 Aug: *junior and exhibition matches have no golden point;
      all other professional NRL and NRLW do.* So the fixtures can be typed
      (`nrl-no-extra` for junior/trial/exhibition, `nrl` or `nrl-finals`
      otherwise) and the guess deleted after. Original note:
- [ ] ~~Only then remove the `extraInSheet` sniffing.~~ Removing it first is a
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

- [x] **Comments on line items.** DONE 30 Aug as crew notes. The decisions it
      was waiting on, answered: PER ROW, not per cell — the crew say "this
      one", and a cell is a level of precision nobody uses on a headset.
      They survive an import: `row_notes.row_id` is deliberately NOT a foreign
      key, so a note outlives the row it was raised against rather than both
      being lost. Who can see them: anybody who can READ the sheet can raise
      one, and whoever is calling it can read and resolve.

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

- [x] **`Event Information Plan - NRL Round 21 - Bulldogs v Sea Eagles.pdf`** —
      DONE 30 Aug. Answered: warn clearly, never block. The shape checks moved
      out of `scripts/import-check.mts` into `packages/core/src/sheetFaults.ts`
      so the screen and the offline sweep cannot drift, and they now render
      above the Import button — "No column became the item name", "No column
      became the duration, but 30 cells read as one", "The whole sheet is zero
      seconds long". The button drops out of primary but stays live: these are
      judgements about a document and the person holding it knows better.
      Verified in a browser on this very file, all three faults verbatim.

      Original note follows.

      **`Event Information Plan`** —
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

- [x] **Root-level files are now watched** — DONE 30 Aug, on BOTH services
      (`opencall-sync` and `opencall`): `/package.json`, `/pnpm-lock.yaml`,
      `/turbo.json` added beside the existing paths and applied.
      Original note:
- [ ] ~~Root-level files are still unwatched~~ — `package.json`,
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

      DECIDED AND SHIPPED 30 Aug, and the answer to all three questions came
      from the user looking at it:
      · an edge was NOT enough — there is now a labelled rail down the far
        left naming the period of play, written vertically, sticky so it names
        whichever period is on screen;
      · live is NOT louder. Loud means "happening now";
      · the band covers the GAME, not the run-up. It used to run from the top
        of the sheet to full time, which tinted three hours of rehearsals;
        it now spans the periods of play, derived from the same reading the
        rail uses so the two cannot disagree.
      Breaks are deliberately unnamed — half time and the quarter breaks are a
      gap in the rail, which reads as the break by itself, while the row-number
      tint runs unbroken through them because half time is part of the game.
      Quarters (netball, AFL, basketball) are read too: the corpus goes from 12
      sheets banded, to 18 with kick-off as a fallback, to 21 with quarters.

      Superseded notes follow.

      OLD, no longer open:
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

- [x] **The pooled client — INVESTIGATED 30 Aug, and the transaction was not
      the problem.** Both statements do run on one dedicated client (drizzle's
      `transaction()` takes it out of the pool), `createDb` is called once so
      there is a single pool per process, and the Postgres path was exercised
      against a real server earlier. What the investigation DID find was two
      things nobody had looked at, both now fixed:
      · `connectionTimeoutMillis` was 0 — "wait forever". A starved pool would
        hang a transport command rather than fail it, and a button that never
        answers is worse mid-show than one that says no. Now 10s.
      · no `error` listener on the pool. Postgres restarts for maintenance,
        node-postgres emits `error` per idle client, and an `error` event with
        no listener is thrown — which this process catches as an UNCAUGHT
        EXCEPTION and journals as a crash. A routine restart has been arriving
        in the error log dressed as something far worse. Now handled and logged
        as the recoverable event it is.
      Neither has been observed in the journal; both are things the log would
      have MISREPORTED if they had. Original note:
- [ ] ~~A write holds a pooled client across two statements since the transaction~~
      went in. It cannot deadlock, but many simultaneous live shows would
      serialise more than before. Not measured, and no pool size is configured.
- [x] The transaction is proven on the embedded database only. CLOSED 30 Aug.
      Ran the whole thing against a real Postgres 16: all 15 migrations applied
      and built 21 tables (that path had never executed either), the session row
      and its as-run entry committed together, and a failure in the second
      statement left NEITHER — no orphaned session claiming a row nothing says
      was cued. Production is no longer the first place any of it runs.
- [x] No test harness in `apps/sync` to host the rollback proof. CLOSED 30 Aug —
      `apps/sync/test/transaction.test.ts`, 3 tests. It SKIPS unless
      `DATABASE_URL` is set, because the point of the embedded database is that
      `pnpm dev` and `pnpm test` need no infrastructure; the file carries the
      two commands for running it against a container. The scratch script is
      deleted rather than left to rot beside it.
- [x] The scope rules are proven from the browser for a caller signed in with a
      company token; the ACCOUNT-holding-a-company-grant path was never clicked.
      CLOSED 30 Aug. The derivation was inline in the request handler, where it
      could not be reached without a server — moved to `scope.ts` as
      `companiesAdministeredBy` and given 8 tests, all mutation-verified.
      The one that matters: an EVENT grant reaches no company. Running one show
      is not deciding who gets into the company that owns it, and the two were
      one character apart in the filter.

## 6b. Opened 30 August, not yet done

- [x] **Extra time has a band** — DONE 30 Aug (52dae66), in the overrun red,
      reading both the inserted block and one a sheet already carries. Rejects
      "Extra Time Buffer", "Extra Time Estimate" and "NO EXTRA TIME".
      Original note:
- [ ] ~~Extra time has no band.~~ Asked for. `goldenPointBlock` inserts rows
      after full time and they fall outside every period, so the rail says
      nothing over them. Wants a band of its own — and a label, which on a
      sheet that went to golden point is the most important thing on it.
- [x] **The misplaced tooltip** — FOUND AND FIXED 30 Aug (2891bd0). The
      selection bar was centred with `translateX(-50%)`, and a transformed
      element becomes the containing block for `position: fixed` descendants —
      which the tooltips are, deliberately. Proven with a probe: a fixed box
      inside the bar resolved to (593,355) before and (0,0) after. My earlier
      hypothesis (React wiping inline custom properties) was WRONG.
      Original note:
- [ ] ~~The misplaced tooltip.~~ Reported with a screenshot: the Skip tooltip
      appeared far below its button. NOT REPRODUCED — measured locally and the
      bubble's `--tip-left`/`--tip-top` are computed correctly, and the whole
      hovered chain is one element. Hypothesis only: `place()` writes those as
      INLINE custom properties, React owns `style` on that button, and custom
      properties INHERIT — so a re-render that drops the inline values would
      leave the bubble using an ancestor's. Unproven. Do not "fix" it blind.
- [x] **The prompter follows the walkthrough** — DONE 30 Aug (5daf8e7),
      with the same browse-and-rejoin. Its read caret still keys off the live
      cue only, deliberately.
      Original note:
- [ ] ~~The prompter has its own follow~~, and did not get the walkthrough
      browse-and-rejoin behaviour. The user said "any viewer", and a prompter
      operator is one. Not touched, not tested.
- [x] **The half-time choice reads a LIVE number** — FIXED 1 Sep. A rival now
      has to be a clear 60s longer before it takes the break, so no hold, nudge
      or add-time can move the band. The measured gap on the sample sheets is
      900s against 110s, thirteen times the margin, so no real answer changes.
      Mutation-tested — and the first version of that test proved nothing,
      because its second fixture row ("HALF TIME music bed") does not match the
      half-time pattern at all: it wants a separator before trailing words. A
      fixture that fails to match tests nothing.
      Original note:
- [ ] ~~The half-time choice reads a LIVE number.~~ It takes the longest
      half-time-named row between the halves by `durationSec`, and durations
      change during a show (HOLD, nudges, add-time).
- [x] **Landscape safe-area** — CONFIRMED BY THE USER 30 Aug ("resolved").
      Original note:
- [ ] ~~Landscape safe-area NOT VERIFIED ON HARDWARE.~~ `env(safe-area-inset-*)`
      is 0 in an emulator, so what was tested is that the change is a no-op
      without a notch. Needs the user's phone, turned sideways.
- [x] **Extra-time rules for the quarter sports** — ANSWERED 30 Aug by not
      answering: there are not enough run sheets, so netball, AFL, football
      and cricket are marked "(coming soon)" in the picker instead of having
      rules guessed for them. Revisit when sheets turn up.
      Original note:
- [ ] ~~Extra-time rules for the quarter sports.~~ The netball sheets prove
      4 x 15-minute quarters and that extra time is played in the REGULAR
      season, not only finals — both sample rounds carry the graphics. The
      format itself (period lengths, and whether it settles by margin or next
      goal) is not in the sheets and will not be guessed. Same for AFL and
      basketball. Needed before any of them can join `eventTypes.ts`.

## 6b2. The "2H covers too many rows" report — WITHDRAWN, my measurement was wrong

Chased across four commits on 30 Aug and reported twice as "still broken for games two
to four", with pixel heights to prove it: 2H at 371px, 774px and 284px against a correct
35px.

**Those numbers were measured with `oc:virtualrows=0` set in my own browser.** I had
turned the row window off so I could read whole sheets, and that switch also turns off
height measurement — the effect that reports row heights returns early when the window
is inactive. With no measured heights, `offsetOf` falls back to a flat 34px per row, and
any band whose boundary row is not in the DOM (the ending rows, hidden by the collapsed
layout) is placed by that guess. Hence enormous bands, in my browser only.

With the window at its default, on the same sheet, every band is 35-73px — one row each.
Verified on production too, freshly loaded: 1H on row 77 alone, 2H on row 79 alone,
rows 93-105 unbanded and untinted.

The user's screenshot was a STALE TAB: it still showed GP, which f49aba0 had already
removed, so that page was running an older build.

Nothing to fix. Recorded because the same mistake has now happened three times in one
day — measuring a page whose state I had altered, or which had crashed, and reading the
result as a finding. `oc:virtualrows=0` in particular is not a neutral observation tool
and must not be left on while judging geometry.

## 6c. The row window undershoots the bottom — FOUND AND FIXED 1 September

FOUND, and it was not an undershoot at all — it was the window reading the
scroll position BEFORE the sheet scrolled itself to the live cue. No further
scroll event followed, because nobody was scrolling, so the window went on
measuring from zero while the scroller sat 99,465px down. It rendered the top
of the sheet, positioned above the viewport, and drew an empty grid.

Measured on the golden-point sheet in layers mode: scrollTop 99,465 of a
197,468 scroll height, 19 rows rendered and all of them rows 1-19 of the sheet,
tbody top at -99,079. One synthetic scroll event brought 22 rows into view,
which is what proved the position rather than the geometry was wrong.

Fixed in `useRowWindow`: re-read after the frame and again once things settle,
and re-read whenever `count` changes — an import or expanding every ending
moves every offset without producing a scroll event either.

Verified by reloading with no manual scroll: 22 rows visible, live cue among
them. Before the fix, one blank row.


UPDATE 30 Aug, later: two SEPARATE faults that looked like this one were
found and fixed, and between them they account for most of what was being
seen. Neither was the estimate.
  · **the rail invented scroll** (69f2a5b) — bands are absolutely positioned,
    so one placed past the end of the table extended the scrollable area.
    Measured: 394px of empty scroll. Now clamped to the table's real bottom.
  · **hidden rows kept a phantom height** (1e6f563) — rows the collapsed
    ending layout hides render nothing and were never measured, so they held
    the average. Eighteen of them was 1,300px of sheet that did not exist, and
    it pushed every row after full time out of reach. Now reported as zero.
    Latent for a while; exposed by making the collapsed layout the default.
  · and **the follow was fighting the scrollbar** (4845952), which is what
    "jumpy" actually was — see below.
What remains is the original estimate problem only: rows nobody has visited
are drawn at the average of the ones they have. Smaller now, still real.

### Original entry — two failed fixes

Reported 30 Aug: *"data is missing at the bottom of the runsheet and scrolling
is jumpy"*, on desktop.

REPRODUCED AND MEASURED on RD25 (356 rows):
- dragging the scrollbar to the bottom lands on **row 339 of 356** — the bar
  looks like it is at the end, seventeen rows are below it. In a later run the
  scroller reported **1,237px short** of its own bottom.
- scrolling down BY HAND converges perfectly: scroll height settles, the last
  row is reachable, no phantom spacer. The fault is specific to a JUMP, which
  on a desktop is how anybody reaches the end of a long sheet.
- with the window off (`localStorage oc:virtualrows=0`) everything is correct:
  356 rows, right rows visible, no spacers. That is a working escape hatch.

CAUSE: rows nobody has scrolled past are drawn at the average height of the
ones who have, and that average is biased LOW — the top of a run sheet is
short rows, the middle is paragraphs of action text. So the total is
underestimated and the bottom of the scroll range is not where the bar says.

NOT CAUSED BY the 30 Aug work, but MADE WORSE by it: the period rail and the
endings gutter took ~46px off the item column, so text wraps more, rows are
taller, and the gap between guess and truth is wider.

TWO FIXES ATTEMPTED AND BOTH REVERTED, so nobody repeats them:
1. **Scroll anchoring** — compensate `scrollTop` by however much the space
   above the window grew when the average moved. Correct in principle, wrong
   here: after a deliberate jump it drags the reader back toward where the
   content used to be, and it ran away (the window ended up at the top with
   the scroller at the bottom).
2. **Stick to bottom** — if the scroller was at the bottom when heights
   arrived, put it back at the bottom afterwards. Had no effect; the flag and
   the layout effect do not order correctly against the row measurement that
   triggers them.

WHAT IT PROBABLY NEEDS: measuring rows before they are scrolled to, rather
than guessing — or dropping the estimate model for one that keeps a running
correction anchored on a known row. That is a real piece of work on the most
load-bearing hook in the app and should not be attempted at the end of a long
session, which is exactly how both attempts above happened.

## 7. Waiting on a decision

Nothing can start on these until they are answered.

- [x] **The update button — DROPPED 1 Sep, on the user's instruction.** "Lets
      remove this development altogether. People can update it themselves from
      GitHub manually." So the app will not deploy itself, and the four
      questions it was blocked on (deploy-on-push, the branch name, what
      automatic updating may do, the token) are moot.
      REMOVED with it: the read-only Railway client and the admin `/deploys`
      endpoint built on 31 Aug. Nothing else read them.
      KEPT, because it is useful and needs no credentials: the build badge's
      "What's new" dialog, which reads this repo's own CHANGELOG.md, and the
      notice that appears when the running deployment has moved past the build
      a tab loaded, with a button that reloads onto it.
      ACTION FOR THE USER: delete `RAILWAY_API_TOKEN` from the `opencall-sync`
      service's variables in Railway. Nothing reads it now, and a live token
      nothing uses is worth removing.
- [ ] ~~Should a stale session ever end by itself~~, or only be flagged as it is
      now? Flagging was chosen deliberately: ending one on a timer would
      eventually stop a real show that sat quiet through a long delay.
- [x] **Trailing `:00` stays** — DECIDED 30 Aug by the user: keep it. No
      change made.
      Original note:
- [ ] ~~Should a whole-minute time drop its trailing `:00`~~ in the planned
      figures — `9:00 AM` rather than `9:00:00 PM`?
- [x] **Skip is Strike, and a rolling pre-record is a tally light** — DONE
      30 Aug (0bc3907). The text marker was rejected in favour of a red bar;
      it uses a distinct `--rec` red, NOT the overrun red, so a showcaller
      scanning for trouble does not keep finding pre-records.
      Original note:
- [ ] ~~Rename Skip to Strike, and surface "∥ Alongside"?~~ Both features exist
      and do what was asked; the words are the app's, not yours. Alongside is
      also buried behind a duration, where nothing suggests it means "not part
      of the show".
- [x] **Nudges work while editing** — DONE 30 Aug (aa7cd80). The ± buttons
      are on off air; CUE and HOLD stay live-only, since both are claims about
      what is happening this second. Off air the strip requires a caller.
      Original note:
- [ ] ~~Should the timing nudges be available while EDITING a sheet, without
      CUE?** They are live-only now. If nudging a selected row is useful while
      building, the answer is to split the strip — CUE cannot be off-air
      whatever happens to the arrows.
- [x] **Should a refused command look like the behind-the-clock bar?** ANSWERED
      1 Sep: NO, and the question turned out to be hiding a real fault.
      A full-width band is the right shape for a STATE — "the live cue is five
      rows behind" is true until somebody fixes it, and the drift bar says so
      for as long as it lasts. A refusal is an EVENT: you pressed something and
      it did not happen. It needs to be seen once and dismissed, and dressing a
      moment as a standing condition makes the sheet cry wolf. It stays a pill.
      What was actually wrong: `.cmd-error` stacked above `--rolebar-h` and
      nothing else, while the outcome dock and the touch nudge dock sit in the
      same corner and publish their heights for exactly this purpose. A refusal
      could be drawn UNDERNEATH the result chooser — which is up at full time,
      the moment a refused command matters most. Fixed.
      Also dropped its `translateX(-50%)` for auto margins. Nothing inside it is
      `position: fixed` today, so it was harmless today; a transformed element
      becomes the containing block for fixed descendants, and this repo has
      already lost an afternoon to that exact bug.
      Original note:
- [ ] ~~Should a refused command look like the behind-the-clock bar?~~ Its
      LAYOUT was fixed 30 Aug — it was 188px wide holding an 87px sentence on a
      phone, five lines of one word each, because a fixed box with `left` and
      no `right` shrinks to half the screen. Whether it should also adopt the
      drift bar's full-width treatment is still the open question. That one
      now spans the screen; the refusal notice is still a centred pill, and how
      loud a refusal should be is a judgement rather than a tidy-up.

## 8. Housekeeping — CLEAR

- [x] **Who lost company access.** NOBODY. The install is still a test one, so
      the grants that migration deleted were test data. Confirmed by the user
      29 Aug; nothing to grant back.
- [x] **The damaged dev databases.** Deleted 29 Aug — `.pglite.corrupt-20260805`
      (29M), `.pglite.damaged-20260809-1205` (37M) and `.pglite.damaged-1315`
      (27M), 93M in all. The live one, `.pglite`, is untouched: the sync server
      resolves it from `PGLITE_DIR` or the repo root, and the three removed were
      dated copies of failed runs from 5 and 9 August.
