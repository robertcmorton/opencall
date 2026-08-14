# Kinds of show

A cue sheet for a rugby league match and a cue sheet for a product launch are
the same document in almost every respect: rows, times, durations, who does
what. They differ in one thing — **how the day can end**. A launch ends the way
it is written down. A match has three or four endings on the page and only one
of them will be played, and somebody has to say which, live, with about thirty
seconds' notice.

The **kind of show** is the setting that carries that difference. This document
is the whole of it: what it governs, how a sheet gets one, how the app finds
the alternate endings inside a sheet, and when it asks.

Everything else about a sheet — its columns, its roles, its timing — comes from
the sheet itself and deliberately not from here.

---

## 1. What a kind of show governs

Exactly four things:

| | |
|---|---|
| **Whether there are endings at all** | A corporate day has one ending. No chooser ever appears. |
| **What the endings are called, and their order** | The buttons offered at full time. |
| **Whether a level score goes somewhere first** | Golden point in the NRL, extra time then penalties in a knockout, a super over in T20. |
| **When the result becomes worth asking about** | A phrase — "second half", "4th quarter" — the sheet's own rows are searched for. |

It governs nothing else. It does not change the grid, the roles, the columns,
the timing model, the prompter, or any permission.

**Where it lives:** [`packages/core/src/eventTypes.ts`](../packages/core/src/eventTypes.ts)

---

## 2. How a sheet gets its kind

Three places, most specific first:

```
    the SHEET's own kind   (rundowns.sport)
        ↓ falls back to
    the EVENT's default    (events.sport)
        ↓ falls back to
    none  — no endings, no chooser
```

Resolved server-side, once, in
[`apps/sync/src/server.ts:261`](../apps/sync/src/server.ts) —
`rundownRow?.sport ?? eventRow?.sport ?? undefined` — and sent to every surface
in the `welcome` frame, so a console, a phone and a prompter cannot disagree
about what kind of day it is.

**Why the sheet wins over the event.** A double-header event holds an NRLW sheet
and an NRL sheet; a stadium's Saturday holds netball in the afternoon and rugby
at night. When the kind of show lived only on the event, re-importing one sheet
retyped the other. The event's value is now only a *default* for new sheets.

**Who sets it.** A person, always — the app never guesses a sport from a sheet's
contents. It is offered on the import screen (seeded from the event's default,
or, when updating an existing sheet, from *that sheet's* current kind) and can be
changed later from the dashboard row. Import will not complete without one when
the event has no default: `"Event type"` is a required field.

There is no auto-detection, and that is a deliberate choice. Guessing wrong is
worse than asking: the cost of a wrong guess is a chooser that offers Draw in a
knockout, or no chooser at all in a match that needs one, discovered at full
time.

---

## 3. The built-in kinds

Three shapes cover all of them.

**`drawAtFullTime`** — Win / Lose / Draw, settled at full time, nothing after.

**`extraCanDraw(label)`** — no Draw at full time (a level score does not end the
match, it sends it on); after the extra period Win / Lose / **Draw**, because
the extra period can itself end level.

**`extraMustSettle(label)`** — no Draw at full time; after the extra period Win /
Lose only. Offering Draw would be offering a result the competition cannot
produce.

| id | Label | Shape | Extra period | Result due after |
|---|---|---|---|---|
| `nrl` | Rugby league (NRL) — regular season | extraCanDraw | Golden point | second half |
| `nrl-finals` | Rugby league (NRL) — final | extraMustSettle | Golden point | second half |
| `afl` | Australian rules (AFL) | drawAtFullTime | — | final/4th quarter or term |
| `afl-finals` | AFL — final | extraMustSettle | Extra time | final/4th quarter or term |
| `soccer` | Football — league | drawAtFullTime | — | second half |
| `soccer-knockout` | Football — knockout | extraMustSettle | Extra time | second half |
| `cricket` | Cricket — Test match | drawAtFullTime | — | *(none)* |
| `cricket-t20` | Cricket — T20 | extraMustSettle | Super over | second innings |
| `netball` | Netball | extraMustSettle | Extra time | final/4th quarter |
| `corporate` | Corporate event | no endings | — | — |
| `concert` | Music concert | no endings | — | — |
| `tv-recording` | Performance recording (TV) | no endings | — | — |

Notes on the ones that are easy to get wrong:

- **Regular-season NRL is the only `extraCanDraw`.** Golden point runs a fixed
  ten minutes and a match nobody wins in that time is a draw. Everywhere else —
  including an NRL final — the extra period is played until somebody leads.
- **Test cricket has no `resultDueAfter`.** Five days with no "second half" to
  match on; it falls back to the buffer alone, which asks late rather than never.
- **`cricket` and `soccer` keep their old ids** rather than being renamed to
  `cricket-test` and `soccer-league`. The ids are stored on events that already
  exist, and in both cases the old behaviour is the new long/league behaviour, so
  those events keep the flow they were set up with.
- **AFL has two entries** because a home-and-away draw stands and a final cannot
  be drawn. That is a property of the fixture, not the sport, so it is the
  operator's choice at import.

### Rugby league (NRL): how a match fills a run sheet

Written down because it is the shape most of these sheets have, and because
two of its numbers are easy to get wrong.

**The two halves are 40 minutes each.** They are the longest rows on the sheet
and they carry a real duration; if a half imports as anything else, something
has gone wrong reading the source.

**The 5-minute block after each half is not extra content.** Run sheets write
a 5:00 row (often labelled "Extra time", "Extra Buffer", "Extra Time Buffer")
after each half. That is the allowance for injury and stoppage time INSIDE the
half — a placeholder the showcaller draws on when play stops, not five more
minutes of show. Added to the running order it makes the day ten minutes
longer than it is. The honest treatment is to keep the number visible and out
of the sum, which is exactly what **Mute** does.

**Golden point, regular season: ten minutes, and a draw is still possible.**
Ten minutes in total, and sudden death for all of it — but structurally it is
**two five-minute periods**: five minutes, teams swap ends with NO break, five
minutes. The swap is worth a row on a sheet even though nothing stops, because
cameras and graphics change end with the teams. Any score — try, penalty goal,
field goal — ends the match on the spot, so the showcaller must be ready to cue
the next item at a moment rather than at a time. If nobody scores in the ten
minutes the match is a draw and each side takes a competition point. This is
why `nrl` offers Win / Lose / Golden point at full time and Win / Lose /
**Draw** after it.

**Golden point, finals: the same ten minutes, then it is played out.** Five
minutes each way as in the regular season; if the scores are still level there
is a short break and a new coin toss, and further periods are played until
somebody scores. A final cannot be drawn. That is a different shape from the
regular season and it has its own kind of show, `nrl-finals`, which offers no
Draw at all.

  Because the end of a final is genuinely open-ended, no sheet can put a
  duration on it. Leave the block untimed rather than guessing at one: the app
  treats a row with no duration as running until the next row starts, so an
  untimed golden-point block will not report the show as running late while it
  is being played.

**A note on 20 minutes, because it comes up.** "Two ten-minute halves" is a
real rugby league rule and a sheet built on it will look right — but it is the
rule from BEFORE golden point existed. Until 2003 a drawn final went to twenty
minutes of extra time, ten each way, and a still-drawn match was REPLAYED.
Golden point replaced that in 2003 for the regular season, and the current
finals structure (five each way, then sudden death) dates from 2016. If a
template or an old sheet carries 2 × 10:00, that is where it came from.

Sources for the two golden-point rules:
[NRL statement on extra time in finals](https://www.nrl.com/news/2016/07/08/nrl-statement-extra-time-in-finals-matches/) ·
[Golden point (Wikipedia)](https://en.wikipedia.org/wiki/Golden_point)

### Custom kinds

A company can add its own (`own:<slug>` ids, group `"Yours"`). Stored as an
`EventTypeSpec` — the same thing said in data, because `EventTypeDef` carries a
compiled `RegExp` and that does not survive JSON. The operator types **phrases**
("4th quarter"), never a regular expression; `phrasesToPattern` compiles them,
escaping every metacharacter so a stray bracket in a form field cannot become
syntax.

Custom types are resolved through `resolveEventType`, the same call the built-ins
go through, so a custom type behaves identically live rather than being a
second-class case handled in a few places and forgotten in the rest.

---

## 4. Finding the endings inside a sheet

The kind of show says *what endings are possible*. The sheet says *where they
are*. `detectOutcomes` in
[`packages/core/src/import.ts`](../packages/core/src/import.ts) reads the second
from the row titles at import time and tags each row with an `outcome` and an
`outcomeGame`.

### What opens a block

A row title is a **trigger** if it matches, in this order:

| Test on the lower-cased title | Tags the block |
|---|---|
| `drawn?` **and** `golden ?point` together | `draw` |
| `full ?time` **and** `win` | `win` |
| `full ?time` **and** `lose\|loss\|lost` | `lose` |
| `golden ?point` | `golden` |
| `full ?time` **and** `drawn?` | `golden` |

A trigger opens a block that runs until the next trigger.

Two of these rules are counter-intuitive and both were learned from real sheets:

- **"extra time" is NOT a trigger, only "golden point" is.** The phrase turns up
  in ordinary notes — "allow extra time for egress" — and treating it as a
  trigger opened an ending block that swallowed the remaining 130 rows of a real
  run sheet.
- **"Full time — draw" opens the `golden` block, not a `draw` block.** At full
  time a level score does not end an NRL match; it sends it to golden point, and
  the rows under that banner *are* the extra-time period. A `draw` ending is only
  real when the sheet names it alongside golden point.

### What closes a block

- **Another trigger** — the next ending begins.
- **A milestone** (the sheet's own marker for a fixed moment). The day has
  reached something that happens whatever the result. This closes the block but
  does **not** start a new game.
- **A kick-off** — `kick ?off`, `pre-game`, `warm ?up`. This closes the block
  *and* marks the next trigger as a new game.

### Telling one game from the next

`outcomeGame` is 1, 2, 3… A day can hold several matches, and a chooser must ask
about the right one.

Only a kick-off starts a new game. This matters because three endings for one
match (win, lose, golden point) are three *blocks* and one *game*.

The rule deliberately does **not** treat "next match" as a kick-off. Sheets close
their ending blocks with a plug for the next *fixture* — "Next Match Round 14",
weeks away — and reading that as a second game today split one match's three
blocks across three games, after which the chooser asked about a game that did
not exist.

---

## 5. When the chooser appears

`resultDueNow` in [`packages/core/src/live.ts`](../packages/core/src/live.ts).
The chooser is a bar across the foot of a live screen, so "up for the whole
second half" means "covering rows for forty minutes". It appears late and
deliberately.

With nothing called yet:

1. Past the first ending row with no result called → **always show it**, or there
   is no way to call the result at all.
2. Before the period named by `resultDueAfter` → **never**. Without this, a sheet
   with an ad break between the second half and the endings gets asked for the
   result at the end of the ad break.
3. The extra period is under way → due at the **end of that period**, not for the
   whole twenty minutes of it.
4. Otherwise → only on the row running **into** the endings, in its last
   **30 seconds** (`RESULT_BUFFER_SEC`). A row already over time counts as due:
   past the point of asking, not before it.

Once a result **is** called, the bar stays while the show is still inside the
endings — so a wrong call can be reset and the screen keeps saying what was
called — and goes once the chosen ending has played out and the show is past the
whole block. It used to stay for the rest of the day.

---

## 6. Where each piece lives

| Piece | File |
|---|---|
| Type table, shapes, custom-type compilation | `packages/core/src/eventTypes.ts` |
| Finding ending blocks in a sheet | `detectOutcomes`, `packages/core/src/import.ts` |
| When to ask for the result | `resultDueNow`, `packages/core/src/live.ts` |
| Sheet-then-event resolution, sent in `welcome` | `apps/sync/src/server.ts` |
| Setting it: import screen and dashboard row | `apps/web/components/ImportPanel.tsx`, `apps/web/app/admin/page.tsx` |
| Tests | `packages/core/test/eventTypes.test.ts`, `resultDue.test.ts`, `import.test.ts` |

---

## 7. Adding a kind of show

Add one row to `EVENT_TYPES`. Spread one of the three shapes, give it a
`resultDueAfter` matching how sheets in that sport word their final period, and
write a `blurb` — it is shown under the picker so the choice is not a guess.

Nothing else needs touching. That was the point of collecting this in one place:
it began as a `sport` string with one value, `"nrl"`, tested for in half a dozen
places, and every new kind of show would have added another test to each of them.
