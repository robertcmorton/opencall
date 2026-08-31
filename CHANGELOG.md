# Changelog

All notable changes to this project are documented here, newest first.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project is not yet versioned, so everything sits under **Unreleased**.

> Versioning: the root `package.json` version is the app version, shown bottom-right of the dashboard together with the build commit. Bump the **minor** for a feature batch, the **patch** for fix-only releases, and cut the `[Unreleased]` section into a matching heading in the same commit.

> Maintenance rule (see CLAUDE.md): update this file in the same commit as any meaningful change. Entries are written generically — no references to external vendors or reference material.

## [Unreleased]

### Fixed
- **Alternate endings are timed from full time, and their durations count.** On a sheet carrying enough of them, every ending was being timed from the START of the last half rather than from the hooter that decides which one is called — minutes early — and the durations of the endings themselves were being discarded, so a golden-point period counted for nothing and the day never budgeted for the one thing it cannot predict. Two readings caused it, both the same mistake: an ending has no printed time because nobody knows whether it will happen, not because the sheet lists the contents of a block. A row is no longer read as covering the endings that follow it, and endings no longer count towards the judgement of what kind of sheet this is. On the sheet that showed it: 119 unexplained timing gaps, now none.

### Fixed
- **The rows of an alternate ending are told apart again.** A branch is a run of rows — "full time, they win" is followed by the song and the presentation — and every row in it was being given the same name. Three rows answered to `50GP`, so calling "go to fifty-GP" named three rows at once. Where the sheet printed numbers for those rows, the screen now says what the paper says, as it already does for every other row; where the sheet left them blank they are numbered within the branch, `50GP.1`, `50GP.2`. Across the sample sheets this was 1591 rows sharing names, and is now none.
- **A golden-point ending no longer reads `GP` twice.** Its number already ended in `GP` and the marker beside it said `GP` again, printing `1661GPGP` where the row number goes. The marker now appears only when the number has not already said it — which is where it earns its place, beside a number the sheet printed.

### Added
- **The server can see what has been deployed.** An administrator-only reading of the recent builds — which commit, when, whether it succeeded, and which half of the app it belongs to. The app runs as two services that deploy separately, so "what is deployed?" has two answers; a reading that showed only one of them would say all was well on exactly the day one half was a day behind. Read only: nothing here can change what is running. It is the groundwork for a button that can put a previous build back, and it exists first on its own so the connection is proven before anything is allowed to act on production.

### Added
- **Two rehearsal sheets, for things that are otherwise hard to sit and wait for.** Both run a full day on a short repeating cycle, so whatever time it is, the thing they are for is a minute or two away rather than an evening away.

  **Concurrency Test — many things at once**: two-minute cycles, each with several things happening at once beside a main item that runs through all of them, and a two-minute bell. 720 overlapping groups across the day, and it imports with no timing checks — because a row shot beside the running order keeps its real length for everything that reads it, while moving the order on by nothing.

  **Golden Point Test — a match every twelve minutes**: a complete match every twelve minutes — kick-off, two short halves either side of half time, then full time with all four endings written out. 120 matches a day, each with win, loss, golden point and drawn-after-extra-time. It imports with no timing checks at all, so anything the check does report while testing is a real finding.

### Fixed
- **A database restart no longer looks like a crash.** Managed Postgres restarts for maintenance, on somebody else's schedule, and when it does the connection pool reports each idle connection it lost. Nothing was listening, so those reports were being caught by the app's last-resort handler and written to the error log as uncaught exceptions with stacks that pointed nowhere useful. They are handled now and read as what they are: the pool drops the dead connection and opens another.

- **A busy database fails visibly instead of hanging.** If every connection was in use, a request waited indefinitely — so a transport command would simply never answer. Mid-show, a button that hangs is worse than one that says it could not. It now gives up after ten seconds and says so.

### Changed
- **Starting a show hands it to the clock and lands on the right row.** Going live used to leave the sheet wherever the start put it — the first item, or nothing — and following the clock was a second, separate press. So a show started at eight in the evening on a sheet whose current item is number forty sat on item one until somebody noticed. Start now does both: the sheet lands on the row the printed times say should be on air, or waits with nothing cued if the day has not begun, and never on the first row by default. It stays a toggle — anybody calling the show by hand switches it off, and that sticks for the session.

### Changed
- **Whether a game can go to golden point is decided by the kind of show, not by guessing from the sheet.** The app used to look for a golden-point block in the running order and, finding none, quietly decide the day ended at full time — offering Draw instead. But a run sheet writes down what is *planned*, and nobody plans extra time: twenty-four of the twenty-seven sample sheets carry no such block, professional fixtures included. So the guess was telling most real matches they could not go to golden point, which is the opposite of true, and it did so silently. The fixture already answers the question — junior, trial and exhibition matches take "Rugby league — no extra time" and everything else does not — and the app can build the block on the night, which is what the offer is for.

### Changed
- **Extra time is marked when it is being played, not because the sheet carries it.** Sheets keep a golden-point block against every game in case it is needed — full time, scores level, a break, a period — whether or not anybody ever plays one. Marking those rows as a period of play put a permanent GP down the edge of a sheet where extra time never happened, which says something untrue about every game on it. The mark now appears when the block is actually in the running order: its alternatives struck, and itself not. A block the sheet never tagged is left marked, since nothing contradicts it.

### Fixed
- **A period of play ends at full time.** The last period of a game was running to the end of the game's whole stretch, which on a sheet that writes its own endings into the running order means every win, lose and draw branch and the build-up to the next match — so a "2H" mark could sit over gates-open, the walk-in and the anthem of the following game. It now stops at the siren. A full-time *wrap* or a highlights read is not the siren and does not stop it.

### Fixed
- **The blue tint marks the game again, not the whole day.** On a sheet that writes its own endings into the running order, the tint had spread into one unbroken stretch across every match, interval, venue reset and build-up on the sheet — the very thing it had been narrowed to avoid. A game's end was being taken from the *last* row of its ending block, but an ending block **begins** at full time, so the second half was handed every win, lose and draw branch that followed it. Two of them ran to the last row of the day. It now ends where play does.

### Removed
- **The grey mark on rows scheduled at the same time.** It shared the edge of the number column with the blue mark for "running right now", so two different things — a plan and a state — sat in the same place and were told apart only by colour. The plan was the one worth losing: that several rows share a time is already visible in the TIME column. Hovering such a row still says which others it runs with; the blue mark now has the edge to itself.

### Changed
- **The kinds of show we have not proven cannot be picked.** Australian rules, football, cricket and netball were marked "(coming soon)" and still selectable; they are now greyed and unselectable. Choosing one today would mean its endings and its extra period came from a rule book rather than from a real run sheet, and rugby league is the only sport the sample corpus is made of. A sheet already set to one keeps it — nothing is taken away, only new choices are.

  Types a company has added itself are untouched and stay selectable: "provisional" is a statement about our homework, not theirs.

### Changed
- **The period mark sits in the middle of the stretch it covers.** It used to ride the top of the view, which was right when the strip also banded half time — those ran to thousands of pixels and a centred mark would rarely have been seen. The strip names the periods of play alone now, and the marks are two characters, so the middle reads as belonging to the whole stretch.

### Changed
- **The strip down the left says 1H, 2H, 1Q–4Q, GP.** Short forms everywhere, at every size. The full names were shown wherever they happened to fit, so the rail said "1st half" against one band and nothing at all against the next — and "nothing at all" was the common case, because a first half is usually a single row about thirty pixels tall and "1st half" written sideways needs fifty-five. This is a narrow strip read out of the corner of the eye; it wants the same two characters every time.

- **The timing buttons sit on the middle of the row** they act on, rather than against its top edge.

### Changed
- **The timing buttons belong to the item on air, not to whatever the mouse is over.** During a show the strip followed the pointer down the sheet, so reading ahead put CUE and a row's timing under the mouse over rows that are not live — and one stray click took the show there. Now: the item on air gets all of them; a row **ahead** of the cue gets **CUE alone**, because "take this item now" is a thing you do to something that has not happened yet; a row already played gets nothing, since its times are the record of when it went to air. Off air, where there is no cue to belong to, hovering still reaches any row's ± buttons.

- **A banner row is one flat colour.** It was painted with a fade that restarted in every column, so it read as banding across the row rather than as one marked line.

### Fixed
- **Every row after full time is reachable again.** With the endings collapsed to one line, the sheet stopped at the "Full time" line: below it sat a screenful of empty sheet, and the items after the match — the venue reset, the de-rig, the end of the day — could not be scrolled to at all. The rows the collapsed block hides draw nothing, but the sheet was still setting aside the space they would have taken if they were drawn, and that invented space pushed everything below them out of reach. Hidden rows now take no room, because they take no room.

### Fixed
- **The sheet ends where the last row ends.** A stretch of empty sheet had appeared below the final item, with a stray coloured stripe down the side of it. The strip that names the periods of play is drawn as free-floating blocks, and when one was placed using an estimated position rather than a measured one it could land past the end of the table — and because it floats, it did not simply sit out of sight, it made the sheet scroll further to reach it. Measured on a real sheet: 394 pixels of scroll that nothing was in. Bands are now held inside the table's real extent, so a period can never begin after the last row or end past it.

### Fixed
- **Scrolling a live sheet with the scrollbar no longer fights you.** The sheet learns that somebody has taken it over by watching for the mouse wheel and for a finger — and between them those miss almost every way a desk actually scrolls: the scrollbar, the trough, Home, End, the arrow keys, the space bar. So scrolling away from the live cue on a desktop left the sheet still believing it was following. Nothing happened at first, which is the confusing part, and then the show advanced a row and the sheet jumped back to the cue, over and over. The Sync Cue button never appeared either, because it only shows once the sheet knows it has been let go of. Any real scroll now hands it over, and Sync Cue brings it back.

### Fixed
- **Scrolling a banded sheet is light again.** The strip naming the periods of play measured itself after every single render, and measuring means asking the browser to lay the page out there and then. The sheet re-renders on every scroll event, so scrolling a sheet with a game in it forced a layout each time and wrote state behind it. Nothing was wrong on screen, which is why nothing failed — it just made scrolling feel heavy. It now measures only when something can actually have moved the bands.

### Changed
- **Endings are named for what they are, and stop taking numbers from the running order.** The win, lose, draw and golden-point rows now read **17W**, **17L**, **17D**, **17GP** — the row the decision hangs off, plus what each one is — instead of counting on through the sheet as though all of them were going to happen. On a sheet numbered from one, three endings used to push every row below them three numbers out of step with the paper.

  The letters are chosen so they can be said out loud: "go to seventeen-W" lands, where "seventeen-B" needs everyone to remember which alternative B was, in a dark room, off paper. They are also order-independent, and the last one follows the competition's own word — `17GP` where it is golden point, `17ET` where it is extra time.

- **The endings start collapsed to one line.** A sheet that has not reached full time was drawing three or four versions of the same minute, stacked, when only one of them will happen. It now shows a single "Full time — one of these will happen" line, and fills in the branch that was actually called. This was already available and is now the starting point; the stacked view is still one press away in the toolbar, and the choice is remembered.

### Added
- **The build badge tells you what changed, and whether you are looking at it.** Clicking the version bottom-right used to copy it to the clipboard — something one person does twice a year when filing a bug. It now opens **What's new**: every change since the last release as a one-line summary you can open for the detail, taken from this file rather than from a second list written beside it, because a summary kept next to the real thing stops matching it about two releases in.

  It also answers a question nothing answered before: a tab left open through a release keeps running the JavaScript it downloaded when it opened, and says nothing. The badge now checks what the server is actually serving — on load, and again when you come back to the tab — and shows a dot when they differ. **Update this tab** puts you on the new one.

  It reloads; it does not deploy. Calling it a deployment would be a lie the first time somebody pressed it and nothing shipped.

### Added
- **The prompter follows the walkthrough too.** It followed a live cue and nothing else, so while a showcaller walked the crew through the sheet the prompter sat at the top and its operator had to find every row by hand — on the one screen in the building whose whole job is to be on the right words. It now follows the same highlight the run sheet does, and carries the same **Out of sync — rejoin** when the showcaller moves on while you are reading somewhere else.

### Changed
- **A pre-record rolling alongside the show reads as a tally light.** Rows shot beside the running order — the coin toss being recorded in the tunnel — already carried a tint and a `∥` beside the number, but while one was actually rolling its progress bar was the ordinary live bar at 40% opacity. That said "something is happening here, quietly" about the one thing on the sheet nobody is watching, and if it overruns, somebody is standing in the wrong place. It now fills at full strength in a recording red, and the row takes a hard red edge down the number column so it can be seen without reading the bar.

  Deliberately **not** the red that means overrun: a second track running is not a problem, and a showcaller scanning for trouble should not keep finding a pre-record. It is a distinct, deeper red — a tally light, not an alarm.

- **Skip is now Strike.** The row is not passed over and forgotten; it stays on the sheet with a line through it, out of the timing and out of the transport — which is what a paper run sheet does when something is cut, and what the copy elsewhere on the screen has always called it. "Skip" described what the transport does; "strike" describes what the crew see. (The import screen's "Skip" is untouched — that one means "do not import this column", which is a different thing entirely.)

### Added
- **The timing nudges work while a sheet is being built, not only while it is on air.** Giving an item thirty more seconds is how a sheet gets written as well as how it gets corrected, and doing it on the row beats opening the duration cell and working it out. Off air they lengthen the item and push everything printed below it later. **CUE** and **HOLD** stay live-only: both are claims about what is happening this second, and neither means anything on a sheet for tomorrow.

### Changed
- **A show nobody stopped now ends itself after a day.** Sessions have been flagged after six hours of silence and left alone, on the reasoning that ending one from a timer would stop a real show sitting through a long interval — true at six hours, not true at twenty-four. Nothing runs for a full day without a single command, and a forgotten session is not harmless: only one show can be live per run sheet, so the abandoned one blocks the next real one until somebody finds it. It is still flagged at six hours for a person to judge; it is ended at twenty-four, when there is no judgement left to make. Ending it writes the closing entry in the as-run record, the same as pressing Stop.

### Fixed
- **A period too short to spell its name now shows a short one.** A first half is very often a single row — the whole forty minutes arrives as one item — and sideways text cannot spell "1st half" in the height of one row. The band was drawn and left blank, next to a second half that read perfectly, which is what "I can see 2nd half but I can't see 1st half" looks like from the outside. Bands that cannot fit the full name now show **1H**, **2H**, **Q1**, **HT** or **GP**; only a band with no room for even that stays bare.

### Fixed
- **A tooltip appears next to the thing it explains.** On the bar that appears when rows are selected, the explanations were landing hundreds of pixels away — most visibly Skip's, which turned up halfway down the sheet against an unrelated row. The bar was centred with a transform, and a transformed element quietly becomes the frame of reference for anything positioned against the window inside it. The tooltips are positioned against the window deliberately, so that no scrolling container can clip them; the two features cancelled each other out. The bar is centred with margins now, the way the sheet's other floating control already was. Menus lost a four-pixel rise on opening for the same reason and now simply fade.

### Changed
- **Kinds of show we have not proven yet say so.** Australian rules, football, cricket and netball are marked **(coming soon)** in the picker. Every rule the app holds about rugby league was checked against a corpus of run sheets from real broadcasts — which is how it knows a half-time row can be a thirty-second sting, and that "Extra Time Buffer" is not extra time. For the other sports there are the laws of the game and nothing else, and the laws are not the part that goes wrong: what goes wrong is how a particular production writes them down.

  They are marked rather than hidden, and still work — somebody who knows their own sheet may well be right to pick one. Only the lists say it; a sheet already set to one reads "Netball", not "Netball (coming soon)", because the choice has been made and repeating our uncertainty at them helps nobody.

### Added
- **Extra time gets its own band, and it is the loudest one on the rail.** A sheet that has reached golden point is a sheet where nothing printed below it will happen when it says it will, so it is marked in the overrun colour rather than the ordinary one. It reads both the block this app inserts at full time and the one a sheet already carries.

  Three things it deliberately does not band, all found by sweeping the sample sheets rather than imagined: **"Extra Time Buffer"**, which five sheets print *before* full time as a slot held in case it is needed; **"Extra Time Estimate"**, the same idea by another name; and **"NO EXTRA TIME"**, which is a shortened exhibition game's rule and the opposite of a game playing it. A row saying "Holding" means nothing on its own either — one sheet has nine of them across the afternoon.

  It also fixes a band that was wrong before: on a sheet with no full-time row, the second half was given every remaining row for want of anywhere better to stop, which on one cue sheet meant swallowing forty rows of golden point. The last period now stops where extra time starts.

### Changed
- **The rail names the periods of play and nothing else.** The breaks between them had bands of their own — half time, and the five minutes at quarter time — which made the strip busier without saying anything the rows did not already say. They are left as a gap now, which reads as the break by itself. The tint down the row numbers still runs unbroken through it, because half time is part of the game even though it is not a period of it.

### Added
- **Anybody watching a walkthrough can read the sheet at their own pace.** Scrolling away used to be a losing argument: the highlight dragged you straight back to the showcaller's row, over and over, so there was no way to look ahead at the item you were about to be asked about. Scrolling now hands the sheet to whoever is holding it.

  And if the showcaller moves on while you are reading, **Out of sync — rejoin** appears; one press takes you to where they are and follows along again. It appears only once they have actually moved: scrolling away on its own is not being out of sync, because the highlight is still where you last saw it and nothing has happened behind your back. The button moves your screen and nobody else's, so everyone gets it whatever their role.

### Fixed
- **Opening a menu no longer flashes a scrollbar.** The menu was drawn where the stylesheet put it and only then measured and pulled back inside the window, so for one frame the page contained something hanging off the bottom of it and grew a scrollbar to reach — which vanished again as the correction landed. It is placed before anything is drawn now, so the first frame anybody sees is the right one. Most obvious on the import screen, where the menu sits low in a tall panel.

### Added
- **Games played in quarters are banded too.** Netball, Australian rules and basketball run four quarters rather than two halves, and the rail now names them — 1ST QTR through 4TH QTR. Read the same way as everything else, off the sheet's own words: all three netball sheets held for testing read completely, every quarter and every break, and the sample corpus goes from 18 sheets banded to 21.

  Quarters are looked for before halves, because the two vocabularies overlap — a netball sheet names Half Time at the end of its second quarter, and read as a game of halves that would make the first two quarters one long first half. Two quarters are required before believing in them, since "Quarter Update" turns up on sheets with no quarters in them at all.

### Fixed
- **The period name no longer hides behind the column headers.** It comes to rest just below them, and how far down that is is now measured rather than assumed — a sheet whose headings wrap onto two lines made the header taller than the guess, and the name of whichever period you had scrolled into disappeared underneath it. The one below still showed, which is what made it look arbitrary.

### Fixed
- **Clicking a row during the walkthrough works the first time.** Stepping the crew through the sheet, clicking a row did nothing until you had pressed Next at least once — a guard meant to stop a producer selecting rows pre-show from dragging everyone's highlight around. The cost was that the click looked broken. A plain click now takes the walkthrough there and every following screen with it, first time. Building a selection — shift for a range, cmd or ctrl for a scatter — still moves nobody's highlight, which is the case the guard was really for.

- **The show page stops offering controls to people who cannot use them.** A follower on a phone was shown "Follow clock" twice — once in the toolbar, once in the warning that the sheet has fallen behind — and pressing it came back "didn't go through, caller role required". The transport bar had always checked; nothing else on the page did. The warning still appears for everyone, because "the sheet you are reading is behind" is worth knowing wherever you are sitting; the remedy is now shown only to whoever can apply it. Same for the walkthrough's Prev and Next.

- **A refused command is readable on a phone.** The notice is fixed to the middle of the screen, and a fixed box given a left edge and no right one shrinks to fit whatever is left — half the screen. On a 375px phone that made a 188px bar holding an 87px sentence: five lines of one word each, over the sheet. It now takes the width it is allowed and wraps like a sentence.

- **The sheet clears the notch when a phone is turned sideways.** Full-bleed backgrounds are meant to run under it; the content was going under it too, and in landscape the notch is down the side — so the row numbers and the Notes button sat behind it. Content is inset now and the background still bleeds.

### Changed
- **The band down the left marks the game, not the day.** It ran from the first row of the sheet to full time, so three hours of rehearsals, comms checks and gates-open were tinted the same as the football. It now covers the periods of play only, taken from the same reading the period rail uses, so the two cannot disagree.

### Changed
- **Test fixtures no longer quote real run sheets.** The sample sheets this was built against belong to the productions that made them, and their wording had been used verbatim in fixtures and comments — sponsor names, segment names, track titles, club-versus-club row names. Replaced with invented equivalents that keep the shape each test actually depends on. No behaviour change; the same 422 tests pass on the same assertions.

### Added
- **The period of play is written down the far left of the sheet.** A run sheet is one unbroken list, and the halves of football inside it look exactly like the ad break before them — a showcaller scanning for "are we in the second half or half time" has only the words to go on, in a column of two hundred other words. There is now a strip down the left edge naming it: 1ST HALF, HALF TIME, 2ND HALF, one set per game, so a double-header has two of each. The name rides the top of the view for as long as its stretch is on screen, rather than sitting once in the middle of it, so it always names the period actually being looked at.

  Read off the sheet's own words, so nothing has to be marked up: it works out where a game starts from kick-off or from a row named for the half, where the break is, and where play resumes, and it takes full time as the end. Of the sample run sheets held for testing, 18 of 27 say enough to be banded — the rest either have no game in them or play in quarters. Where a sheet marks the break but never the restart, the rows after it are left plain rather than labelled with a guess: half of them would be football.

- **The import screen says when a document has not come in as a run sheet.** Handed something that is not one — or one whose columns were misread — it used to show 291 rows of nothing and leave you to notice. It now says which structural thing is wrong, in plain terms: nothing became the item name, no column became the duration although thirty cells read as one, the whole sheet is zero seconds long, the same line is sitting inside twenty-six different rows (which is a page footer that has been read as part of a cue). The Import button stays live beside it, only demoted out of primary — the checks are judgements about a document, and the person holding it knows better than they do.

  These are the same checks the offline sweep runs over the sample sheets, moved into shared code so the screen and the sweep cannot drift apart and start saying different things about the same file.


### Fixed
- **Who may administer a company's people is now checked, not assumed.** There are three ways to reach that: the administrator, a company signing in with its own token, and a person who has been granted access to a company. The first two were verified from a browser months ago; the third sat inline in the request handler where nothing could reach it without a running server, and had never once been exercised. It now lives beside the other access rules, which exist precisely so they can be checked without one, and carries tests for the distinction that matters — being given one show to run is not the same as being given the company that owns it, and those two were a single word apart. Also held down: a grant naming no company reaches nothing rather than everything.

### Added
- **The crew can flag a line, and whoever is calling the show sees which one.** A sheet's comments column is written before the day starts and read by nobody after it. This is the other direction: somebody holding a view-only link taps the row they mean, adds a line if they want one, and it appears against that row on the caller's sheet with a count beside the row number. The panel lists what is outstanding — the row's own number and title, who raised it, how long ago — jumps to the row, and clears it when it has been dealt with.

  Resolved rather than deleted, because "this was queried at the time, by camera 2" is worth having at the debrief. Anyone who can read the sheet can raise one, since the person looking at it is the person who can see the problem; the name and role attached are the ones they already told the sheet and are not pretending to be credentials. And it is polled rather than carried on the show channel, which exists for transport and must not queue behind messages between people.

### Added
- **The production database's code path is no longer taken on trust.** Development runs on an embedded database so the app needs no Docker and no install to start; production runs Postgres. The two share a schema, the queries and the migrations, and differ in one fifteen-line branch — but the single transaction in the codebase, the one that writes a show's session row and its as-run entry together, had only ever been *read* for Postgres. Production would have been the first place it ran. It has now been run: all fifteen migrations applied against Postgres 16 and built the schema, both rows committed together, and a failure in the second write left neither behind — no session claiming a row with nothing to say it was ever cued. That last part is the entire reason the transaction exists, and it had never been demonstrated on the driver that matters.

  It is a test now rather than something somebody did once. It sits out of the way unless a database is pointed at it, so the ordinary test run still needs nothing installed.

### Fixed
- **The column grab handle sits on the column edge, half either side of it.** The resize cursor appeared well before you reached a divider and stopped once you had passed it, and the blue bar that shows where the edge will land was drawn thirteen pixels left of the edge itself. Three causes, one symptom. The hover rule set a left offset beside a width, which quietly overrides the right-anchoring above it and moved the bar instead of widening it. The grab area sat wholly inside the left-hand cell, so all sixteen pixels of it were on one side of the line. And once it was widened to straddle, half of it vanished: every header cell is sticky with the same stacking order, so each covers whatever the cell before it overflowed, and the half that reached across the line was buried under the neighbour — measured, the pointer found the handle from eight pixels left of the edge to one pixel left, and nothing at all beyond it.

  The handle now belongs to the column on the RIGHT of the boundary and reaches back over it, which is where nothing covers it — and is what the sheet already does below the header, where every divider is drawn as the next cell's left border. The bar is drawn down the handle's middle rather than measured from an edge, so it cannot drift again the next time the grab area is resized, which is what happened on both previous attempts.

- **HOLD keeps an item on air past its end, and spends what it cost.** Something overruns and the answer used to be arithmetic: work out how long it went, then press +30 four times. HOLD sits beside CUE — the other thing you do to the item that is on air, since CUE says the next one starts now and HOLD says this one is not finished — and starts a stopwatch on it. Pressing GO spends whatever it reads: the item takes that long, and every printed time below moves by the same amount. That is exactly what the nudges either side of it already do, because a hold is a nudge whose length nobody knew in advance, and one undo takes the whole thing back.

  The stopwatch belongs to the screen holding it; what is shared is the result once it is let go. A half-finished hold is not a fact about the show, it is somebody with a thumb on a button. Cueing anything else settles it first, so the time lands on the item that was actually held rather than following the button to the next row. On a phone it docks at the foot with the other corrections, because a touch screen cannot hover — not because it needs less.

### Fixed
- **The sheet's name keeps to one line at every width.** It was held to one line only below 1024px, and the band immediately above that is where the header is most cramped: at 1030 a long name stacked over three lines and pushed the planned figures and the transport down with it. The reason it earns one line — you already know what you opened — does not change with the width of the window, so neither does the rule now. Where there is room the ellipsis never appears, and the full name is still in the tooltip.

- **A menu no longer raises scrollbars on a page that fits.** Opening the actions menu on a rundown row put both a horizontal and a vertical scrollbar on the dashboard. The menu is kept on screen by measuring the window — and the window's width counts the strip a scrollbar will occupy, so the menu was placed into space that stopped existing the moment one appeared. Then each bar caused the other: seven pixels of overhang raised the horizontal one, which took fifteen pixels of height, which pushed the page past the bottom and raised the vertical one, which took fifteen pixels of width and pushed the menu further out again. It measures the page's own box now, which is what the menu actually has to fit inside.

- **The prompter button is gone from the walkthrough.** Walking a crew through the sheet is planning — nobody is reading anything out, and the prompter is a full screen that takes whoever presses it away from the sheet they are stepping through. It comes back when the show does.

### Added
- **On a day that holds two games, the sheet says which one you are looking at.** A double-header runs both matches through one running order, and the second game's build-up looks exactly like the ad break before it — a showcaller scanning for where it starts has only the words to go on. Alternate matches now carry a tinted edge down the row-number column: the one part of a row that is never text, so nothing has to be read through it, and it survives whatever colours somebody has set on their own rows. Quiet on purpose, because the loud marks on that grid mean something is happening *now* and this is context that sits there all night. Nothing at all on a sheet with one game or none, where it would be decoration.

  Full time is the boundary — the one thing the sheets agree on, and already found for the extra-time work. Everything up to and including a full time belongs to that game and what follows belongs to the next, which means it never has to work out where a game *begins*: sheets say that far less clearly than where one ends.

- **At full time, a sheet with no endings written into it now says so.** When the show reaches the row that says full time, the same bar that asks for a result on a tagged sheet appears with one thing on it: build the extra period. Only one, because on this sheet it is the only thing that would do anything — Win, Lose and Draw exist on other sheets to play one block of rows and skip the others, and a sheet with nothing tagged has no rows to skip, so three of those four buttons would be ornaments at the one moment nobody can afford to press an ornament.

  It will not offer twice. Once the block is there, the row is read as answered — the hold and the period that follow it are checked by name, both of them, so a sheet that happens to carry its own hold after full time is not mistaken for one that has already been built.

- **Extra time can be built into a sheet that never wrote it down.** Hover the full-time row and the same strip that carries the live corrections offers to add the block: the holds and the periods, and in a competition that cannot end level the further period that has no length, because nobody can say what that one costs until it is over. Every printed time below moves by however long the block runs — those times are rewritten rather than left to be wrong, since the sheet is what the room reads and one showing a time nobody can reach is worse than one that has been honestly moved. Times above are never touched: that part of the night has been played, and they are the record of when things went to air. One undo takes the whole thing back out.

  Offered only where it can happen: on a sheet that carries no endings of its own, on the row that says full time, and only when the kind of show has an extra period. A junior, trial or exhibition fixture is rugby league on a rugby league sheet but nobody is playing golden point, and it is not offered one.

  It sits on the hover strip rather than anywhere else because that is where a showcaller's hand already is — the corrections for the row under the pointer live there, and this belongs to a row in the same way. Unlike those corrections it also appears before the show has started: taking five seconds out of an item means nothing to a sheet nobody is calling yet, but building the block is preparation, and it is most often wanted on a night nobody planned for it.

- **A final that is still level plays on, and the sheet now has rows for it.** The generated extra-time block ended after the second period, which is right for a regular-season match — those ten minutes are sudden death, the first score wins, and if nobody scores a draw is declared. A final is not that: the ten minutes are played out whatever the score, and if the teams are still level the game goes to a continuous golden point that ends only on a score. The sheet would have run out of rows with a final still being played. It gets a further hold and a period carrying no length at all, because nobody can say what that period costs until it is over, and a run sheet should not pretend otherwise.

  Also settled while checking: the women's competition plays the same endings as the men's and needs no separate kind of show. The two do differ — 70 minutes against 80, two 35-minute halves against two of 40 — but a half's length is read from the sheet rather than modelled, so nothing follows from it. Written down beside the event types, because it is the kind of thing that gets re-asked.

- **The app can find where a result has to be called, on a sheet that never wrote its endings down.** Extra time was only ever offered on a sheet that already carried a golden-point block, which sounds reasonable until you count: of twenty-seven real sheets, twenty-four tag no endings at all. On those the question never came up, whatever the competition allows — and a level score at full time is exactly when a showcaller cannot be looking things up. The sheets do say where full time is, though; twenty-two of the twenty-seven name it in a row title, once per match on a double-header. That row is now found. It has to read as full time rather than merely mention it, so the wrap that follows the siren is not mistaken for the siren, and it has to carry a printed time or be the banner that closes a match — several production houses end a match with a heading and no time, whose position is the second half's own start plus its own length. Nineteen of the twenty-four untagged sheets get a decision point; the five that do not are two documents with no match in them and three test fixtures.

  Nothing changes on screen yet: this is the part that knows WHERE, and the chooser still has to learn to appear there.

### Fixed
- **What happens during a match is no longer counted after it.** A rugby league half is 35 minutes for the women's game and 40 for the men's, but the clock stops for injuries and referrals while the afternoon does not — so a sheet allots 42:00 to a 35-minute half, 47:00 to a 40-minute one, and lists against it the things that fill those stoppages: the try, the goal, the video ref, the music under a break in play. Those were being added end to end after the match instead of inside it, which pushed everything later: on one sheet a coin toss printed at 4:30 was computed as 4:59 and the timing check reported twenty-nine minutes of content that would not fit. The same shape turns up wherever something long contains something short — a two-minute bell while the teams run on, comms and a tech check and a team list all called for the same minute.

  A row printed inside another row's window is now understood to happen during it: its length is shown but not spent, and the row containing it carries the time. It stays in the sheet, stays in the walkthrough, and can still be cued — which is the whole point, because the alternative the app already had for this ("runs alongside") also removes a row from the transport, and a team entry you cannot call is worse than a total that is wrong.

  The proof is the sheet's own arithmetic and it has to be exact: the row that closes the window must land on the container's end to the second, as full time at 4:52 does against a half starting at 4:10 and running 42:00. Anything less exact is left alone, because a sheet that merely looks overlapping is one to ask about rather than to quietly re-time. Across the sample sheets no row moved and none was lost; what changed is that the double-counted lengths came out — one sheet's planned running time fell from 537 minutes to 504, and the timing warnings on the worst of them dropped from 135 to 108.

- **A run sheet whose heading is printed a long way down the page is found.** The search for the column heading looked at the first thirty lines only. One match-day document opens with a title block, a Key Timings list and a whole Match Day Contacts table before its run sheet begins, which puts the heading on line 51 — so it was never seen, and the fallback is the first line of the document. That is the title block, so every column was named after a piece of the title and a 63-item run sheet imported as 242 rows with no title, no time and no lengths. The search now covers a share of the document rather than a fixed count. It stays bounded on purpose: a heading sits at the top of the rows it heads, and searching to the end would let a coincidence far down the page throw away everything above it. That sheet now reads 65 rows from 11:30 to 15:40.

- **A column headed with an abbreviation is recognised.** "DUR." and "ITEM No." are how sheets actually head those columns, and the full stop stopped them matching anything — so a heading line that should have scored four scored two, which is enough to lose to whatever else is in the running.

### Changed
- **The import check no longer reports a schedule as broken for having no lengths.** A sheet that gives a time for each activity and never a duration is a legitimate shape, not a failed import — one sample event plan is exactly that, and both of the new "no durations" reports were firing on it. Both now ask first whether the sheet had any lengths to lose.

- **A row is called the same thing on every screen.** The walkthrough counted its own position among the rows it can step to, which is a filtered list — banners and skipped rows keep their number on the sheet and are stepped over there. So on an imported sheet it said "1" while the row it was highlighting read 11 in the sheet beside it, and the gap between the two numbers moved as you walked. It now names the row the way the sheet names it, and how far through the rehearsal you are moved to the tooltip, where a progress count belongs. The prompter and the guest view had a quieter version of the same disagreement: where the sheet left a row unnumbered they filled in the row's position instead, so a row showed a number the sheet never gave it — and that number belongs to a different row further down. All four screens now ask one rule.

### Added
- **The offline import check looks at the shape of the result, not only at what it could read.** It called a 26-page run sheet clean while that sheet was missing its first ten items, had no durations at all and carried a page footer inside thirty-two of its cues — because every cell it could see parsed, and the damage was in what never became a cell. It now also reports when no column became the title, the time or the duration; when a whole sheet comes out zero seconds long; and when one line of text is sitting inside row after unrelated row, which is what an absorbed running head or footer looks like from the outside. That last test deliberately does not consult the running-header detector, since a check that asks the detector whose blind spot caused the problem can only ever find what it already found. Its thresholds were measured against the sample sheets rather than guessed. Three sheets that had been passing turn out to import with no title column and no lengths.

### Fixed
- **A run sheet whose heading is printed part-way down page one keeps the items above it.** Some sheets open with a block of build-up — content check, production meeting, comms, tech check, rehearsals — and only rule in the ITEM/TIME/DURATION heading once the doors are about to open. Everything above that heading was read as title matter and discarded. On one match-day sheet that silently removed its first ten items and moved the show's start from half past eleven to a quarter to three. The heading is now lifted to the top of the block it belongs to, on the test that the numbering runs straight through it: items 1 to 10 above a heading followed by item 11 is a heading printed late, and anything else is left alone.

- **Two column headings printed side by side are no longer read as one column.** A PDF hands over runs of text rather than cells, and a narrow DURATION column butted against ACTIVITY can arrive as the single run "DURATION ACTIVITY". It was filed under one column and the other was left unnamed — so on a sheet whose durations are perfectly legible, nothing was mapped to duration, the whole sheet imported with no lengths and a total of zero, and the title fell through to the item-number column, leaving every cue titled with its own number. Split only where the sheet is unambiguous: the cell must be exactly two known headings, and the column receiving the second must have no heading of its own to lose.

- **The page footer stays out of the run sheet.** A footer carries the page number, so it reads differently on every page and never matched the test for a line a document repeats — and an unmatched footer is not left sitting on its own, it is absorbed into whatever cue precedes the page break. A production company's name and a distribution notice were arriving inside cues, on thirty-two rows of one sheet and twenty-five across two others. The page number is now ignored when deciding what repeats, and only the page number: a number is disregarded solely where its value is the number of the page it is printed on. Ignoring numbers in general would catch a team list printing the same position against different jersey numbers, which was measured to delete ten live cues; a jersey number has nothing to do with the page it lands on.

- **A sheet that spreads one item over several printed lines keeps its notes column separate from its cue.** Where each item runs to several lines — a WHO column listing AUDIO, then GFX, then GA — only the first line carries the activity, which made a perfectly good title column look two-thirds empty. It was then treated as a column whose contents had strayed, and the notes column beside it was adopted as the title as well, so the two imported glued together and every cue read as its own name followed by its production notes. The title column is now judged on the rows that actually open an item.

### Changed
- **A column heading printed over two lines is read as one heading.** A narrow column headed "TIME OF DAY" is printed as "TIME OF" above "DAY", and a PDF hands those over as two separate lines. The reader picked the middle line — the one carrying most of the headings — and that line has a hole exactly where each stacked heading was. So the column arrived with no name, its times were never recognised as times, and a sheet of 259 items came in with a single fixed start between them: the app reported a whole match day as fifteen minutes long. A neighbouring line is now folded into the heading when it does nothing but fill those holes — every word sitting where the heading has nothing, fewer words than the heading has, and words rather than values. A row of the sheet fails all three tests, including the awkward one: a sparse first row that fills only the gaps.

  The sheet this was found on now reads 10:15 to 18:18 instead of fifteen minutes, and recovers the names of its own columns. It also now reports four places where its times do not add up — all four genuinely in the source, including a bell warning stamped a minute *earlier* than the two items printed above it. It could not report them before, because it had no times to check.

- **Values from one column no longer arrive welded onto the end of a neighbouring cell.** A PDF hands over its text as separately positioned pieces, and the reader was ordering each line of them by the height they sit at rather than by how far across the page they are. Columns set at different type sizes sit fractions of a point apart, so a line arrived in a jumbled order — and the rule that decides whether two pieces belong to the same cell measures the space between them, which came out *negative* when the next piece was further to the left. A negative space is a small space, so the rule said "same cell" and glued them together. An item number two hundred points away ended up on the end of a time of day, a duration ended up on the end of a title, and a start time on the end of a caption. On one match-day sheet this hit 251 cells: twelve of them were times and durations, which the import screen at least flagged as unreadable, and the rest were text, which it had no way to question — so a run sheet imported at more than twice its true length, with 593 rows where the sheet has 259 and every count and column shifted. Lines are now read left to right, as they are written.

  Across the sample sheets this takes two more of them to a clean import, removes every unreadable cell on the worst one, and drops the timing warnings on nine others. It also surfaces two warnings that were being swallowed rather than invented — where a source sheet's own duration and its next fixed start genuinely disagree, the duration used to disappear into the item's title and take the discrepancy with it.

### Changed
- **Each unreadable cell on the import screen sits in its own box, and is named by its own words.** A dozen of them ran together separated by nothing but a line break, when the one thing to do there is take each in turn. They were also labelled "Row 26" on a sheet that carries no row numbers — an index into what the app extracted, naming nothing the reader could point at on their own document. The row's own text comes first now, and a number is shown only when the sheet actually has one.

- **Rows are struck rather than deleted once a show is on.** Deleting a row mid-show takes its as-run history with it — what was cued, when, and for how long — so afterwards nobody can explain what happened, because the evidence went with the row. Delete is withheld while the show is running and the reason is said where the button was; striking leaves the row on the sheet, visibly struck and out of the timing, which is what dropping an item actually means at a quarter to nine.
- **Clicking a row during a walkthrough goes there.** Prev and Next were the only way, so reaching a row meant walking past every row before it — fine for stepping through with the crew, useless when somebody asks to go back to the anthem. Only once a walkthrough is running: the highlight is shared with every screen watching it, and selecting rows before the doors open should not drag the crew's place around behind you.

- **The timing nudges and CUE appear only once a show is running.** Every button on that strip is a live correction — take five seconds out, put fifteen back, cue this row now — and none of them mean anything to a sheet nobody is calling yet. It was showing whenever the sheet could be edited, which included the walkthrough and the editing view, where it offered to re-cue a show that had not started.

- **The bar of actions for selected rows sits in the middle of the sheet.** Tucked against the left edge it covered the row numbers and the time column — the two things you read to check you have selected what you meant to. In the middle it covers a part of the row whose text has already been read. Its count no longer breaks across two lines either.

- **The import preview uses the whole screen.** It was capped at a fixed share of the window, which sounds generous until you notice the panel opens part-way down a long page — so most of that share landed below the bottom of the screen and you were left checking a 356-row sheet through a gap a row or two high. It now measures from where the preview actually starts down to the bottom of the window, so it always reaches the edge and never overshoots it, and it re-measures when the window changes or anything above it moves.

- **The notice about the cue falling behind spans the screen.** It was a pill floating clear of both edges — the shape of a passing message, when what it says stays true until somebody acts on it. A bar that meets both sides reads as a state the page is in, and stops competing with the sheet for the middle of the screen.
- **The planned figures lost their heading.** Start, duration and end each say what they are, so the word above them was a fourth line on a block whose whole point is being read at a glance.

- **The sheet's planned shape sits beside the cue timer while the show is on.** It was hidden once a show started, on the reasoning that a caller wants two numbers rather than five. That was wrong about what the block is for: the planned start, length and end are what the night is being measured against, so they belong next to the timer rather than out of the way of it — the plan on one side, what is actually happening on the other.
- **Even space around the next item under the timer.** The progress bar sat directly on the line naming it, so it read as belonging to the bar rather than having room of its own.

- **The side panel no longer offers to log in to somebody already logged in.** "Login" sat at the top of it pointing at the same page as the wordmark directly above, while a few inches below the panel named who you were signed in as and offered Sign out.

- **Hovering the clock button says what time the show will actually come off.** The header carries the end the sheet plans, which does not move; this is the other one — the plan shifted by however late the show is running — and it sits beside the drift that explains it, rather than as a second end time in the header contradicting the first.

- **The sheet's planned shape reads as a small table, and the clock says "time of day".** Start, duration and end were one run-on line with separators standing in for labels, so nothing could be found at a glance — least of all the end time, which is the one people look for. They are now a labelled block under the sheet's name, each number saying what it is. The clock beside them was called "event time", which invited the reading "the time the event starts" next to a readout that is the time right now; it says time of day, and still names the zone it is keeping.

- **A live screen carries two timing readouts, not five.** Calling a show, the questions are what time it is and what time you come off; the sheet's start, length and end are setup facts that were sitting on the one screen you can least afford to read past anything. They now appear while the sheet is being set up and walked through, and step aside once it is on air. The end time shown is the sheet's own — there were two ends a few inches apart disagreeing by however late the show was running, both calling themselves the end, and neither saying which kind it was.

- **The projected end and the event clock sit side by side.** On a narrower window they stacked, which bought width at the cost of a second row of header — and height is the scarcer of the two here, because every pixel the header takes is a row of the run sheet nobody can read. They are also the pair anybody reads together, so splitting them across two lines separated the comparison being made.

- **The timer shows only what comes next.** The item just finished was there too, above the line, and it earned its space less than it cost — nobody asks what has already happened, and a third line of text on the biggest readout on the page is a third thing to read past.

### Fixed
- **Opening a live sheet puts the cue on screen straight away.** The sheet was drawn at the top first and moved to the cue a fraction of a second later, so every return to a running show began with a jump. The position is now worked out in the same moment the rows appear, before anything is drawn, and refined once the real row heights are known.

- **Coming back to a running show no longer flashes through states that were never true.** Opening a sheet drew its whole not-on-air face first — Start show, the walkthrough controls, the timing check — because the document arrives before the server has said what the show is doing, and "not known yet" was being read as "not live". Then the answer landed and it all changed. The readings had the same problem: until the server's clock has actually been measured, the times are this device's own, so a phone that has been asleep showed figures that were not late but wrong, and corrected them a moment later in front of somebody with no way to know which to believe. Nothing that depends on the state of the show is drawn until both are in. The sheet itself still appears immediately.

- **The roles menu stays on the screen on a phone.** It hangs off the right edge of its button, which is right on a desktop where that button ends a wide toolbar. On a phone the button is nowhere near the edge, so the menu ran off the side — thirty-nine pixels of it unreachable, with no sideways scroll to go and get them. It now moves by exactly as much as it needs to and not at all when it already fits.

- **The cue stops hopping about when the show moves to the next item.** Only part of a long sheet is really drawn at once, and the space above it is sized from the average height of the rows measured so far. Sliding the sheet to the new cue over half a second meant that average kept changing while it travelled, so it arrived in the wrong place and had to correct itself — visibly, every time. It moves at once now, which leaves no gap for the sheet to shift underneath it.

### Fixed
- **The nudge strip no longer covers the column titles.** It is meant to stay below the pinned header, and the check that kept it there measured the header's row rather than the cells that actually stay pinned — so it worked while the sheet sat still and stopped working the instant anybody scrolled, letting the strip paint over the column titles it exists to avoid. Measured on a real sheet: the whole header row was covered.

### Fixed
- **The as-run record can no longer fall behind the show.** Every accepted command writes two things — where the show now is, and the entry saying how it got there — and they were written as two separate steps. Anything that ended the process between them (a hard kill, a crash, a failure in the second write) left a sheet claiming to be on an item with nothing recording that it was ever called. They are now one write that either lands or does not.
- **A paused show reads as paused on the dashboard**, in amber, rather than keeping the red on-air badge and changing only the word.
- **The evidence for "left running" is readable on a tablet.** It lived in a tooltip, and tooltips do not exist on a touch screen — which is where this dashboard is most often propped. The chip now carries the age itself ("left running · 19h"), which also sidesteps whose clock the time was in.

### Added
- **Crew can raise a note against a row (groundwork).** Camera operators see things the showcaller cannot — no shot of what a row describes, a caption spelled wrong, a presenter who has walked off — and until now they had a radio, which arrives while the showcaller is calling something else. Anyone holding a view-only link can now raise a note on a row: who they are, which row, and a line if they had time to type one. It is a message about the running order and never part of it, so nothing about it can change what goes to air. Notes are resolved rather than deleted, because the row somebody queried at the time is often the interesting part of a debrief. The screens for this come next; this is the part underneath.

- **The shape of extra time a sheet never wrote down.** Every proper rugby league game can go to golden point, and plenty of real run sheets carry no block for it — so when the siren goes on a level score there is nothing on the page to play. The app can now describe that period itself: a hold, five minutes, a hold, five minutes, using the same word real sheets already use for the pauses. Times printed against rows after it move by the whole length, because a sheet showing a time nobody can reach is worse than one honestly moved; times already gone to air are never touched. This is the shape and the arithmetic — the screens that offer it come next.

- **A kind of show for rugby league that cannot go to extra time.** A junior, trial or exhibition fixture is rugby league and goes on a rugby league sheet, but nobody is playing golden point and a level score is simply a draw. The app used to work that out by looking for a golden-point block on the sheet — the wrong place, because showcallers do not always write one, so a proper game whose sheet omitted it was offered a draw and no route to extra time. It is now a property of the fixture, chosen once by whoever knows which kind of match it is.

- **Access is editable from the account list too.** The admin table's access chips were fixed once a person existed; they now open the same editor as the people list. Adding access somebody already holds is refused with a word rather than failing on save.
- **The web app has tests.** It had no test runner at all, so pure logic in it was checked only by the type checker.

### Changed
- **A show nobody stopped now reads as "left running" rather than LIVE.** Nothing ends a session except pressing Stop, so a run sheet closed by shutting a laptop kept claiming to be on air. Where nothing has moved for hours the dashboard says so quietly, in grey rather than red, and the tooltip gives the time it last moved and how to end it. It is a doubt rather than a verdict — a real show that sat quiet through a long interval reads the same way — so nothing is stopped automatically.
- **Version history opens over the sheet instead of pushing it down**, like the sharing panel. On a live sheet, moving the rows moves the cue somebody is reading.

### Fixed
- **Error messages say what went wrong.** A refused action showed the address it was refused at, a number and some raw data. It now shows the sentence the server actually sent, while the full detail still reaches the error log, which is what makes the log worth reading.
- **The nudge strip no longer rides up over the header.** It was positioned without accounting for how far the sheet had been scrolled, so following a row upward carried it onto the show's own header.
- **Two ways the first render could disagree with itself.** The run sheet read the clock while drawing, and a formatted cell rendered differently before and after reaching the browser. Neither showed while a sheet was empty on arrival, and both would have appeared as soon as one was not.

### Changed
- **A show that was never stopped is now reported as such.** Nothing ends a session except pressing Stop, so a show closed by shutting a laptop stays "running" indefinitely — this machine has carried four since yesterday morning. Anything asking whether a show is live got a yes that only meant somebody once pressed start. The list of live shows now also says when each was last touched, and marks any untouched for six hours as doubtful. It reports rather than corrects: ending somebody's session on a timer would eventually stop a real show that sat quiet through a long interval.

### Added
- **The prompter says how long until the show starts.** Somebody at the prompter desk before anything is called was told STAND BY against a dash, which is true and no use. While the show is open but its first item is still ahead, the same countdown the show page carries now appears there — the screen the reader is actually sitting in front of answers the question they actually have.

- **The timer shows what you just came off and what is next.** The item on air has the one before it above and the one after below, in the order the sheet runs — so the three read as a strip of the running order rather than three separate readings. "What's after this?" is asked far more often than "what are we in?", and the answer used to mean finding your place in the table. Both are dimmer than the item being called, deliberately: they are context, and the eye should not be pulled off the thing you are calling. Headings and reminders are skipped; only items that can actually be called appear.

### Fixed
- **Restarting the server no longer risks losing the row that was just cued.** Transport commands are written to the database without waiting, so the sheet moves the instant a button is pressed rather than when a database agrees — which means there is often a write still in flight. Shutdown closed the database out from under it, so a restart could bring the show back pointing at the previous item, with nothing connecting the two events. It now finishes what is in flight first, and gives up after two seconds so that a stuck write turns a clean stop into a slower one rather than a killed process.

### Added
- **Access can be changed after it is given.** Somebody put on the wrong event, or moved between companies, no longer has to be deleted and re-invited. An administrator may change anyone's; a company may change the access of people it can already see, within the companies and events it holds. An edit only ever touches the part of somebody's access the editor can see — the rest is left alone, so a company correcting a freelancer's events cannot disturb the other companies that person works for, or notice they exist. Whoever holds several companies can also now be shown their own companies by name, without being shown anyone else's or any company's sign-in token. Each person on Users & access now has a Change access button: it lists what they hold, takes any of it away, and adds a company or an event from a menu.

## [0.36.0] — 2026-08-17

### Fixed
- **The connection lamps could be cut off the right of the screen with no way to reach them.** On a tablet-width window the header's three groups added up to more than the window, and the overflow came off the right-hand end: the two lights that tell you whether the sheet and the show are still connected sat past the edge, with nothing to scroll to reach them. A status light that fails by disappearing is the worst way for one to fail. The middle group is now allowed to give up width and wrap, which it has plenty of room to do. The header's three groups also line up along their tops again — the pre-show box had been sitting thirteen pixels below its neighbours.

### Changed
- **The pre-show controls are one group, at one size, and the LIVE marker is built like the buttons beside it.** Rehearsing the sheet and starting the show are one sequence, but the walkthrough sat in the sheet's toolbar among Undo, Redo and Add row — editing controls, which it is not — while the button it leads to was elsewhere on the screen. They now share a single bordered group, which disappears once the show is live and there is nothing left to rehearse. Everything in it is built to one size: there had been three different heights among four controls sitting side by side. The LIVE marker was a rounded pill next to two square buttons, shorter than them and on a different line; it keeps its colour, its pulse and its capitals, but the box is now the same shape and height as Pause and Stop.

### Fixed
- **Going live before the first item is due no longer puts that item on air.** Opening a show at eleven in the morning on a sheet that starts at eight in the evening cued the first item immediately and began timing it — so the biggest readout on the page counted an item nobody had called, and since that item was only ten minutes long, the show read as hours overdue before anyone had arrived. The show can now be open while the first item is still ahead: the timer counts down to it and says which item it is waiting for. Following the clock takes it when its time comes; a showcaller calling by hand takes it with the spacebar, which now steps to the first item from a standing start instead of doing nothing.

### Fixed
- **An account put in charge of two companies is asked which one it means.** Choosing "everything at this company" sent no company name, because the server filled it in — correct for somebody who has one, a guess for somebody who has several, and the guess was whichever company the database happened to list first. It now asks. Access given to a kind of thing the app does not recognise is refused outright rather than allowed on the strength of naming an event the giver could reach.

### Changed
- **A timing gap you have said is deliberate stays said.** Days often open with a hold — doors, a walk-in, a changeover — where the printed times and the printed durations are both right and simply do not meet. The timing check has always offered to accept that, but the acceptance lived in the screen rather than in the sheet: it lasted until the panel closed, was gone on the next visit, and never applied to anybody else, despite the wording promising the check would stop flagging it. It is now part of the run sheet — it survives a reload, everyone sees it, and one undo takes it back. The check keeps the SIZE of the hold you accepted rather than simply marking the row settled, so if a duration above it changes and the gap becomes a different length, that is a new question and it asks again. Accepted holds are listed with a way to put each one back under the check, and the list is reachable whether or not anything else is still outstanding.

### Fixed
- **Access that names no company is cleared out.** Some accounts carry a record of company access pointing at a company that does not exist — either left by the invitation fault above, or naming a company that has since been deleted. It never granted anything, because access is decided by matching the company and nothing matches. It was not quite harmless: holding one counted as holding company access for the purpose of the check that guards people administration, so its holder could see other people in the same broken state. These are removed when the server next starts. Anyone who was *meant* to have company access will need it granted again, deliberately — the note in the migration says how to list who is affected before updating.

### Changed
- **The lists you choose from on Users & access are in an order you can predict.** Companies read A to Z, and events run oldest first, the way a diary does — in the invitation form and in the account form alike, which previously disagreed with each other because both simply showed whatever order the server happened to return. Names sort the way a person reads them: capitals do not jump the queue, and "Studio 2" comes before "Studio 10".

### Fixed
- **An invitation can name which company the person may open.** On a server running more than one company, the invite form offered a single "Everything at this company" — which had no company attached to it. An administrator, who can reach every company, had no way to say which one they meant, and the choice was not refused either: inviting somebody with an existing account recorded access to a company that does not exist, and reported success, while inviting a new email address failed outright. The form now lists the companies by name, one option each. Whoever is signed in as a single company still sees the same one-line choice as before, because for them there is nothing to choose. The people list now names the company somebody has access to, rather than saying only that they have a whole one.

### Fixed
- **A narrow window no longer empties a run sheet whose columns have been dragged.** Below roughly 500px the app decided it could not afford the minimum widths that protect the time and duration columns — and instead of dropping just those minimums, it abandoned the whole calculation, handing every column a width of zero. The item column collapsed to nothing, so the sheet's own text disappeared: on a 520px window the run sheet rendered with no readable content at all. It only ever affected sheets whose columns had been dragged to a width, since untouched sheets never reach that calculation. The widths chosen by dragging are now kept on any screen; only the minimums are given up when there is no room for them.

### Fixed
- **The admin dashboard no longer breaks its first render for anyone signed in.** Whether the browser was holding an access token was checked while the page was being drawn — and the server drawing that same page has no browser storage to check, so it always decided nobody was signed in. A signed-in admin was therefore sent a page saying no sign-in was needed and offering no way out, and their browser then drew the opposite; the two disagreeing is an error the page recovers from by redrawing, every single load. The question is now asked once the browser is running, which is the only place it can be answered.

### Changed
- **View-only links open over the run sheet instead of pushing it down.** The panel used to appear above the grid, so asking a question about sharing moved every row somebody was reading — and on a live sheet that means the cue moves while you are looking at it. It now floats over the page: the rows stay exactly where they were, and the panel leaves the moment it is answered. Escape closes it as well as clicking away, because it can be opened mid-show and a way out that has to be aimed at is not a way out.

### Fixed
- **The header readouts cannot be hidden by a narrow window any more.** The clocks and the projected end were sliding under the cue timer and being cut in half, because the columns either side of the timer were allowed to be narrower than what was in them — so the readouts were crushed rather than the one thing that can shrink gracefully. The sheet's name absorbs it now, down to a floor where it still reads as a name; losing the end of a title you chose is nothing like losing the clock. The timer stays centred while there is room, and gives up exact centring only when the alternative is hiding a reading.

### Changed
- **The view-only link is a link, and there is one button to get it.** It no longer asks who the link is for — it is one URL and anyone holding it can watch, so naming it described the sender's intention rather than anything the link does. Copy now works whether or not a link has been made yet: if there is not one, it makes one. The panel shows the address itself rather than leading with a six-character code, with the code kept in small type underneath for anyone reading off a printed sheet instead of a screen.

### Fixed
- **Copying a view-only link no longer loses it when the clipboard refuses.** Browsers decline that write for several reasons that have nothing to do with the link — no permission, an insecure page, a browser that wants the write nearer the click — and when it happened the address was thrown away, though the link itself had already been created. The link is the point and copying is the convenience; the address now comes back either way, on screen to copy by hand.

### Fixed
- **The error log records where a browser error happened, not where the server wrote it down.** Every error reported by a browser was filed with the server's own stack — the same three lines pointing at the code that receives the report — while the browser's real stack was kept somewhere the log does not show. A fault in a page therefore read as a fault in the server, which is worse than having no stack at all: it sends whoever is reading the log to the wrong file. The browser's stack now goes where the log is read from.

### Changed
- **The show's drift has left the header for the clock button's hover.** While the clock is running the show it was pinned at +00:00 all night — the follower puts every item on the time the sheet gives it, so the number could only ever restate what the green chip already said. It is a real reading when a person is calling the show, and it is there when you want it: hovering the clock button now says how far off the plan you are, WHICH ITEM that is measured on, and what time the sheet gives that item — which the bare figure never did. The header is now one line where there is room for one: the time it is now, the time we come off, and the two connection lamps — the two clocks side by side, which is the comparison anybody in the room is actually making. On a narrower screen it steps down rather than overflowing: the gaps close first, then the event clock drops beneath the projected end. Nothing is ever hidden behind the timer. Projected end comes first — it is the number people ask each other for, "what time are we off?" — with the show's drift beside it as the reason that number moves. The two connection lamps sit together at the far right, one above the other: they answer one question between them, and they are the only thing up there that is a state rather than a number, so the eye can skip them until one goes red.

### Removed
- **The follower screen has gone.** It showed the item on air, a countdown and the one after — which is the timer's job with more context. Two companion screens instead of three: one fewer thing to explain to a crew, and one fewer to be looking at the wrong one of. View-only links are untouched; they never used that screen.

### Fixed
- **The column dividers in the header line up with the sheet again.** The header's divider was drawn inside the grab area you use to resize a column, positioned from that area's edge rather than the column's — so widening the grab area to make the resize cursor easier to find slid every header divider several pixels away from the sheet's. It is now drawn on the column boundary itself, the same pixel the rows below use, and the grab area can be any size without moving it.

### Changed
- **The event clock reads like the other readouts.** It sits on its own row beneath them, aligned with the left edge of SHOW rather than adrift at the far side, and keeps its label above its value at every width — including on a phone, where it used to flatten onto one line and become the only readout shaped differently from the rest.
- **Sync Cue is the size of the other buttons.** It was the largest control on the page, for an action that is a convenience rather than a transport command.
- **The resize target on a column divider is easier to hit.** It read as a hairline, so the cursor only changed once you had hunted a few pixels to one side of it.
- **The menu closes when you touch the sheet.** It floats over the rows, so reaching past it for the run sheet is the clearest statement that you are done with it; making you find the button again was a toll on the one screen that should never charge one.

### Fixed
- **A run sheet no longer prints a time the document does not contain.** Where a sheet left the time column blank, the app worked out where the row fell from the durations above it and showed that — and on screen an inferred time is indistinguishable from one somebody typed, so a showcaller could hold a cue to a minute the sheet never claimed. Blank in the source is now blank on the sheet, marked so it can be filled in if you want one. On one real run sheet that is 52 rows of 119 that were showing invented times. Nothing about the running order changes: those rows keep their place and still spend their duration, so the projected end is exactly where it was — measured across every sample sheet, and identical before and after.

### Fixed
- **A reminder is no longer mistaken for the show.** A milestone is something the showcaller has to get done by a time — team sheets due, comms check, doors — not an item that goes to air. The clock could take one as the cue, and when it did, everything went with it: a milestone carries no duration, so the big timer took the reminder's name, counted up and went red, while the item genuinely on air ran on below with nothing pointing at it. Three rows signalling at once and none of them the show. The clock now passes over reminders the way it already passes over pre-records and headings.

### Fixed
- **Handing the show to the clock no longer leaves it timing an item that has not begun.** This is the sheet that opened at 1:15 in the afternoon, was started that morning, and sat counting down an item hours away while reporting the show four hours ahead of itself. The earlier attempt at this fixed the wrong moment — it guarded the start, and the clock cannot be put in charge until a show is already live, so the guard never once ran. The correction belongs at the handover: if the clock has not reached the sheet at all, it would have cued nothing, and nothing is what the show now holds — live, waiting, with the first item cued at its own time. A cue that is merely ahead of the clock in the middle of a show is left exactly where it is, because the clock refuses to drag a running show backwards and switching it on must not do what it would not do itself.

### Changed
- **The sign-in page no longer points at the administrator's dashboard.** It carried a button to it, and named administrator tokens in its help text. The sign-in page is the most public surface the app has — it is what a stranger, a search crawler, or anyone handed a view-only link sees first — and it has no business naming the administrative side or showing the way there. Administrators reach their dashboard directly, or by signing in here as before; nothing about who can get in has changed, because none of that was ever decided by a link. The help text now describes what a member of a crew needs and stops there.

### Fixed
- **A show whose clock has stepped backwards no longer floods the server log.** The clock refuses to drag a running show backwards through its own order, which is right, and it said so on every check — once a second, for as long as the show stayed that way. On a four-hour event that is around fourteen thousand identical lines, and because hosts treat that channel as errors, one show in that state buried the error log a self-hoster reads to find real faults. It is now said once, when it starts, and again if it genuinely recurs or the clock picks a different target. The refusal itself is unchanged.

### Changed
- **The sharing instructions describe what the app actually does.** They told a self-hoster to hand out caller and editor codes; those cannot be created — every code and link is view-only, and running or editing a show takes an account, because a code gets photographed off a wall and forwarded out of a group chat.
- **The settings a self-hosted server actually reads are all written down.** Six were not, including the one that decides where emailed invitation links point: unset, links are built from whatever address the admin's own browser happened to be using, so an invitation created from a staging URL sent people there instead — by email, with no way for them to tell. Mail settings are documented as optional, which they are: with no mail server an invitation is still made and the link handed back to pass on however you like.

### Fixed
- **The run sheet reads properly to a screen reader.** The page had no marked main region, so there was no way to skip past the menu and the header band and land on the sheet — every other page in the app already said where its content began; the one people actually live in did not. The sheet is now announced as the page's content.
- **The control that picks up a row has a name.** Selecting or dragging a row is done from its number, and on a sheet that arrived without numbering — or on a heading row — that control had no name at all: a button announced as nothing. It now names the row by its number, or by the item's own title when there is no number.
- **The small labels are legible.** The column headings across the sheet, and the captions above the readouts in the header, were set too faint against their background to meet the standard for text that size — measured at 3.5 and 3.7 where 4.5 is required. Lifted two steps, to 5.3 and 5.6. They stay clearly quieter than the values they label.

### Changed
- **Opening a run sheet no longer downloads the dashboard as well.** The menu is present on every page, including a live sheet, and the pages it links to were being fetched in advance the moment a sheet opened — about 130 KB of code for pages nobody is on, more than nine tenths of it never used, arriving at exactly the moment the sheet is coming down the wire. On a venue's connection that is bandwidth taken from the only thing that matters. Those pages are now fetched when they are asked for, which costs a short wait on a trip nobody makes in the middle of a show.

### Fixed
- **Starting a show early no longer runs an item that has not begun.** With the clock in charge, pressing start cued the first item and began timing it whatever the time was — so a sheet opening at 1:15 in the afternoon, started that morning, sat counting down an item hours away and reported the show four hours ahead of itself. The clock now chooses what to open on, including choosing nothing: the show goes live and waits, and the first item is cued at its own time, which is the whole point of handing the show to the clock. Starting with the clock switched off is unchanged — a person in charge, starting on the row they picked, is exactly what was meant.

### Fixed
- **The progress sweep across the live item moves smoothly.** It was being told a new position four times a second while each move was set to take nearly a second, so it never once arrived before being sent somewhere else — permanently behind, and changing speed every quarter second, which is what made it look like it was stepping rather than sweeping. The movement now takes exactly as long as the gap between updates, so it is one continuous sweep. The wash is a deeper blue while it is at it.
- **The live item stays in the middle when "You're on" appears.** That bar sits on top of the bottom of the sheet without making the sheet any shorter, so the middle of what you can actually see moves up — and the cue, still centred in the full height, dropped low at the exact moment the screen was telling somebody they were on. The cue is now centred in what is left visible, and it re-centres the instant the bar arrives or goes.

### Fixed
- **Opening the menu no longer nudges the cue timer sideways.** The room kept clear for the menu button was only reserved while the menu was shut, so opening it handed that space back to the header, the header re-laid itself out, and the timer — which sits centred between two equal sides — slid sideways by half of it. Reading a menu should not move the clock somebody is calling a show against. Measured: every part of the header and the sheet now moves zero pixels when the menu opens.

### Added
- **A run sheet is kept on the device, so opening it again is quick.** The browser started from nothing every time, so the server had to send the entire sheet on every load and every reload — 1.7 MB of it on a real one. The sheet is now held on the device and only what has changed since is sent, which for a sheet reopened between two halves is usually nothing at all. It also means the rows are on screen while the connection is still being made, instead of an empty grid: a sheet that is a few minutes old and says so beats one you cannot see. Nothing can go stale behind your back — the stored copy and the server are merged rather than one replacing the other, so anything the server knows still arrives. A sheet whose contents have been replaced wholesale is stored separately and starts clean, and the copies left behind by that are removed.

### Fixed
- **Pausing a show no longer shifts the controls sideways.** "Resume" is a wider word than "Pause" and "PAUSED" a wider word than "LIVE", so pausing moved Stop and the stopwatch along the row and resuming moved them back — the controls walking about underneath a hand that is reaching for them. Both now hold the width of their longer word, whichever they currently show. Measured: Stop moves zero pixels through a pause and a resume, where it moved twelve before.

### Changed
- **A run sheet starts connecting the moment it opens.** The document's connection could not begin until the browser had asked the server one small question and waited for the answer — a full round trip out and back, from wherever the operator happens to be, before the sheet could even start arriving. It was measured at between a third and half a second on a live sheet, sitting in front of everything else. That question is now answered while the page is being built, on the server, one hop away, and the answer arrives with the page. The same answer covers a second question the page used to ask separately, so two waits became none.
- **The stopwatch appears with the show.** Walking a sheet before the doors open is planning, not timing: there is nothing running to measure, and a stopwatch sitting there invites someone to start it during the walkthrough and wonder an hour later what the number refers to.

### Fixed
- **Correcting one row's time no longer rewrites every time below it.** Changing a start time shifts everything after it by the same amount, which is right when the show is running late — and wrong when you are fixing a time that was simply typed incorrectly. Putting an "am" back to "pm" is a twelve-hour change, so every fixed time below moved twelve hours too and an 8 PM item came back as 8 AM. Those rows were already right; being wrong was that one row's problem. The two are now told apart by the order of the sheet: a row that stays in order has been re-planned, and everything after it follows as before; a row that was out of order, or is being moved out of order, is a value being corrected, and nothing else is touched.
- **The live cue holds one position instead of drifting.** The sheet centred the row's middle, so the top edge of the highlighted row landed somewhere different for every row — measured on a real sheet, rows run from 32 to 95 pixels tall and the cue's top moved through a 32-pixel range as the show advanced through short cues and long notes. The eye follows the top edge, so it read as a sheet that never settles. The cue now lands in the same place every time, whatever the height of the row. Jumping to a cue that is not on screen yet uses that same position, so the sheet no longer arrives in one place and then shuffles to another.

### Fixed
- **Errors that happen while a page is starting up are recorded again.** The error log listened for faults from inside a component, which does not begin listening until after the page has been built — and one whole class of fault is reported *during* that build, a moment earlier. Those went to the browser's console and nowhere else, so the server's error log read as empty and healthy while every load of a run sheet was reporting a fault. Listening now starts as the page's code is first read, before anything is built, so nothing is missed by a hair.
- **A dropped connection no longer shows the wrong page.** Asking for a run sheet while the network was failing served the *sign-in page* instead — its saved copy was the only one kept, and it was being handed out for any address. The run sheet's own code then loaded on top of it, which is two different pages in one window: on a phone at the side of a pitch, a showcaller staring at a sign-in box. A run sheet is live data and there is no honest saved copy of it, so the failure now says it cannot reach the network, which is true and something a person can act on. Only the sign-in page is ever served from a saved copy.

### Changed
- **A long run sheet opens without freezing.** Only the rows near the viewport are drawn now, instead of every row in the sheet. Measured on a 3,321-row sheet, this is the difference between a console that will not answer a click for sixteen seconds and one that is ready in well under a second — the main thread went from 15.9 seconds of solid work to 67 milliseconds, and from two hundred stalls to one. The scrollbar, the printed sheet and the position of every row are unchanged. This was built earlier and left switched off because the browser's own find could not see rows that were not drawn, and failed silently; pressing the find key now draws the whole sheet before the find bar opens, so searching works exactly as it always did and the cost falls on the search rather than on every person opening a sheet.
- **The sheet is read once per change, not once per redraw.** Every time anything at all redrew this screen — a clock tick, a hover, a panel opening — the entire document was walked again and all its timing recalculated. It is now remembered between changes, which also repairs several caches that were written correctly and could never once have worked, because the thing they were keyed on was rebuilt every time.
- **"Close to viewers" is now "End event", and reads as the serious thing it is.** It is the one item in that menu that changes what other people can open, so it no longer looks like the ones that only change your own screen. The wording says what you are doing rather than describing the mechanism.

### Fixed
- **The running order no longer slows down as rows share a start time.** Working out when an untimed row ends meant scanning forward through the sheet for the next later start, for every row, on every tick of the clock — so the sheets that suffered most were the ordinary ones, where a period, a standby, a block and its first cue all share a moment. Same answers, found in one pass. Sheets whose start times run backwards somewhere — a mistyped am/pm, which the app already warns about — keep the original careful scan, so nothing changes for them.
- **The role picker no longer reads the whole sheet while shut.** It counts repeated short lines to suggest role names, and was doing so on every redraw whether or not anyone had opened it. The colouring of role names in cells was also rebuilding its search pattern once per cell rather than once per sheet.
- **The run sheet is sent compressed.** A browser starts from an empty document, so opening a sheet means sending the whole thing — and a 3,321-row sheet measured 1,715 KB going over the wire uncompressed. The document connection now compresses: the same sheet is 413 KB, measured rather than estimated, so 1.3 MB is removed from the wait before anything appears. The setting was never on, because the library it rests on defaults it off — the browser had been offering compression on every connection and the server had been declining it. Only the document connection compresses; the one carrying show state sends a few dozen bytes at a time, and squeezing those costs more than it saves.
- **A read-only screen no longer downloads the text editor.** The rich-text engine is 343 KB of what a run sheet fetches before it can even ask for its content, and it is used on exactly one path: double-clicking a cell to edit it. Somebody following the show on a phone can never reach it and was paying for it on every load. It now arrives separately, during the first quiet moment after the sheet is up, and only for people who can edit — so the first edit is as immediate as it ever was, and the wait to see the sheet is 343 KB shorter. Measured: the show page's download went from 1,103 KB to 760 KB.

### Fixed
- **A button answers the moment you press it.** Nothing in the app had a pressed state, so pressing a button changed nothing on screen until the app had finished re-rendering — measured at 104ms on the show page, and that was with row windowing on and only 42 rows drawn; on a full sheet it is far worse. The button was never slow to animate, it simply had nothing to animate until the app caught up. Pressed now darkens or lightens immediately, drawn by the browser itself rather than the app, so the answer arrives in a frame no matter what the sheet is busy with. Buttons also settle a little faster on hover than the rest of the chrome: a panel opening is a place changing and wants to be followed, but a button is answering you, and an answer that takes as long as a journey reads as hesitation.

### Changed
- **Stop keeps its size when it changes its wording.** "Confirm" is 19px wider than "Stop" in the interface face, so arming the button would have shoved Pause and the LIVE badge sideways at the exact moment somebody is aiming at them. Both words now occupy the same space, so the button is always as wide as the longer one and nothing beside it moves. Measured at 83.48px in both states, with its neighbours unmoved to the pixel. It is the words themselves doing the measuring rather than a fixed number, so it cannot drift when the wording, the typeface or the language changes.
- **Stop asks with one word, and anything else answers it.** The armed Stop button read "Press again to stop" — an instruction to read at the moment there is least time to read one. It now reads **Confirm**. Pressing it again ends the show, as before; touching anything else on the screen — or pressing Escape — puts it back to Stop. Previously the only way to back out was to do nothing for ten seconds, and waiting is the one thing nobody is doing during a show. The ten-second limit stays underneath, so a console left alone does not sit armed indefinitely with the next stray tap ending a live show.
- **One way to share a run sheet, and it is read-only.** There were two: a "guest pass" and a "view-only link", offered side by side in the same menu, and nothing on screen said what the difference was. There was a difference, and it ran the wrong way — the guest pass asked nobody for a name, so its holders never appeared in the list of who has the sheet open, it could not be revoked from anywhere in the app, and it showed a static copy rather than the live cue. The weaker of the two was the one you could neither see nor withdraw. Guest passes are no longer issued. The one remaining link opens the sheet read-only, asks for a name first, can be revoked, and can be told which columns to show. Anyone who needs to run or edit a show signs in to an account — a code is a thing that gets photographed off a wall and forwarded out of a group chat, and neither of those should end with a stranger holding the transport.
- **The front door no longer offers what it cannot give.** The join box still explained that caller codes open the full console and editor codes open the editor, months after both were withdrawn and the server began refusing them. It now says the one true thing: a code opens the sheet read-only, and anything more needs an account.

### Added
- **Guest passes already handed out can finally be revoked.** They were filtered out of the list of links, so a pass issued to somebody who has since left could not be withdrawn from anywhere in the app — the only remedy was deleting the run sheet. They are now listed under their own heading, marked as still open and no longer issued, with the link to copy and a button to revoke. Nothing is revoked for you: a link that stops working in the middle of an event is the showcaller's decision, not an upgrade's.

### Fixed
- **With row windowing on, the sheet follows the cue again.** Following the cue worked by finding the live row on the page and centring it — and under a window the live row is often not on the page at all, so it searched, found nothing, and stopped. The sheet kept perfect time and simply stopped showing where it was, which reads exactly like the connection having died. The window knows where every row sits whether it is drawn or not, so following now goes to that position first, which brings the row into the window, and then centres it exactly. Sync Cue does the same. Measured: from the top of a 3,321-row sheet with the live row not rendered at all, one press lands on it in a quarter of a second.
- **The catch-up no longer works from stale measurements.** Each retry had captured the row heights known when it started, so on a cold load — when nothing has been measured and every row is a guess — it scrolled to the same wrong place twenty times and gave up. It now reads the freshest measurements each time, so each attempt is better than the last and it settles in two or three rather than never.


### Changed
- **One Sync Cue, and it lives over the sheet.** "Sync Cue" scrolled back to the row this screen already believed was live; "Sync my screen" dropped the connection and asked the server. Both finished by centring the live row, so whenever the screen was right — which is nearly always — they did visibly the same thing, and the difference only appeared on the night the screen was wrong. That is the worst imaginable night to be choosing between two similar buttons. There is now one action: ask the server what the cue is, then go to it. The reconnect costs a moment and is invisible when nothing is wrong, which is a fair price for never having to know which button was the one that actually fixed it. Still this screen only — a button that pushed one laptop's idea of the cue to everybody would let a confused laptop move a live show. It appears where it is needed: floating over the sheet the moment you scroll off the cue, and nowhere else. The toolbar is left to the things you use every show rather than the one you use when something has gone wrong.

### Fixed
- **The show's controls and the stopwatch sit on the same line.** The controls kept a top margin from when they sat alone under the cue timer, and in a centred row a margin is counted in the box being centred — so one box rode a few pixels below its neighbour. The line's spacing belongs to the line, not to one thing in it.


### Fixed
- **The pointer is a hand over things you can click.** A run sheet's rows select and cue, and a browser gives a plain table row an arrow — which reads as "nothing here". The row number keeps the grab hand, because that one is a drag handle, and text being edited keeps its caret.
- **A stray arrow no longer follows the mouse.** Tooltips lost their little pointer when the bubble moved to being placed on the screen rather than under the element — but a later rule quietly put it back, so hovering produced a small diamond floating near nothing. The two rules had been arguing in the same file.
- **The sheet gets the left edge back.** A 34-pixel gutter ran down the entire page to reserve room for a menu button that floats over everything anyway. Only the header band ever sits behind that button, and the header already reserves its own room — so below it the sheet now runs to the edge, which on a wide cue sheet is a column's worth of width returned.
- **The connection dots sit on the same line as the readouts beside them.** They were a couple of pixels low and set in a different size and case, which is enough to look like a mistake. Two causes: different type, and the dot itself being part of the layout so the line was measured from the dot rather than from the words.

### Changed
- **The show's controls and the stopwatch are drawn with a line, not a fill.** A grey panel behind outlined red buttons read as "this area is switched off", which is the opposite of what LIVE means. Both are now a hairline around their group, matching each other.
- **The stopwatch answers the finger immediately.** It was setting React state sixty times a second for two digits nobody else depends on — cheap alone, not in company, because those updates queue behind the sheet's own rendering, and on a long sheet that is a couple of hundred milliseconds. The number stuttered and so did the press, which was waiting in the same queue. The face is now written straight to the screen and the press paints before React hears about it. Measured: press to visible, 0.2ms.


### Changed
- **A second track now colours its whole row.** A pre-record or a bell runs alongside the show and takes none of its time, and that was said with three pixels of diagonal stripe beside the row number — which read as a rendering fault to the person who asked for it, a fair verdict on a mark meant to be understood at a glance mid-show. The whole row is now tinted, because that is the claim being made: the row is a second track, not just its number. The colour is violet, and deliberately so — every other hue on a row already means something (blue is where the cue is, amber is a timing problem, teal is yours, red and green are late and on time), and a pre-record is none of those. It is simply not the show. Its duration keeps the struck-through treatment that already means "written down but not spent".
- **A pre-record that is yours still looks like yours.** The old stripe and the my-role rail fought for the same three pixels of the first cell and the stripe won, so a pre-record assigned to you stopped being marked as yours. Colour now says what kind of row it is and the rail is left to say whose it is.
- **On paper it is drawn in ink.** A tint is the first thing a printer throws away, and a printed sheet is where a second track is most easily misread as the next cue — so print gets a rule down the left of the row and the mark in black.


### Fixed
- **A pre-record's mark no longer eats its row number.** Rows that run alongside the show carry a `∥` after their number, and on a long sheet the numbers are four digits: the pair wanted more room than the column had, so the number was clipped and a row numbered 1503 read as "50…". The mark annotating the number was crowding it out. The column is now sized from the longest number the sheet actually has, plus room for the mark when any row needs one — so a long sheet gets the width it needs and a short one still gets a narrow column. Never visible on a hundred-row match sheet; obvious on a three-thousand-row one.


### Added
- **Sync my screen.** When a screen and the show disagree, this asks the server again and jumps to the cue it gives. It changes nothing for anyone else — it drops this screen's own connection and takes the answer that comes back, which is already how a screen recovers from a connection that died quietly; this is the same recovery on demand, for the moment when somebody does not trust what they are looking at and cannot wait for a watchdog to agree. Deliberately one screen only: a button that pushed one laptop's idea of the cue to everybody would let a confused laptop move a live show.

### Changed
- **One cue timer, not two.** The "Item" readout in the top-right group showed the same number as the big cue timer two inches to its left — the same computation, not merely a similar one — and a reader who notices two clocks has to check whether they agree. That group answers how the *show* is doing, cumulatively; the item countdown is a question about one row, and it already has a larger home with the row's name and a progress bar attached.


### Added
- **Row windowing, off by default, waiting for someone to scroll it.** A long sheet puts every row in the page: 3,321 rows became 19,926 cells and 37,122 DOM nodes, of which 24 were on screen. With windowing on, only the rows near the viewport are built and the rest are represented by two empty rows of exactly the right height, so the scrollbar is unchanged. Measured on the 24-hour test sheet: rows rendered 3,321 → 38, DOM nodes 37,131 → 607, and an idle console 95% → 12% of the main thread. Row heights are measured rather than assumed, because a cue sheet's rows are not uniform and a guess would make the scrollbar jump under the thumb of somebody calling a show. **It is off until a person has scrolled a long sheet by hand** — the rendering side is measured, the scrolling side is not, and shipping it on would put that in front of a showcaller at kick-off on the strength of "it ought to work". Turn it on with `localStorage.setItem("oc:virtualrows", "1")` and reload; remove the key to go back. Printing always renders the whole sheet.


## [0.35.0] — 2026-08-15

### Added
- **A public way to ask what build is running.** `GET /api/version` returns the version, commit and build date — the same three facts the badge shows bottom-right of the dashboard, but readable without signing in. The badge needs an authenticated page, so "did the deploy land?" meant logging in and looking; twice this week it was answered from a stale note instead, and the second time the answer was wrong. Nothing is exposed that was not already public: those values are inlined into the JavaScript every visitor downloads.

### Changed
- **No Prev and Next buttons on a live show.** They are how you *walk* a sheet — before the show, with the crew, stepping through to see what is coming — and the walkthrough keeps its own pair. Live they answer the wrong question: a showcaller does not take "the next one", they take a particular item because a producer just said its name, and the sheet already offers that on the row itself where the thing being called can be read. Space and Shift+Space stay, because they are muscle memory, they cost no room on the screen, and they are the one control that can be used without looking down.

### Fixed
- **The space bar could stop working for the rest of a show, silently.** A key press can arrive addressed to the document rather than to an element, and the check for "am I typing in a cell?" assumed an element. It threw there, and a handler that throws is a handler that is gone — taking the only remaining way to step a live cue with it, without a word on screen.


### Fixed
- **Choosing something from the menu closes it.** The panel floats over the page rather than pushing it aside, and most of what it offers opens *in* the page underneath — History, Join codes and Guest pass all appear at the top of the sheet. Left open, the panel covered the first 176 pixels of the very thing it had just opened. Pushing the page made that impossible and hid the question; floating asks it, and the answer a drawer always gives is to get out of the way once it has been used.


### Fixed
- **The open menu is no longer painted over by the bar above it.** The panel sat below the show's top bar, which was harmless while it pushed the page aside — it never had to cross the header. Now that it floats over the sheet the header stayed where it was and painted straight across the top of it, leaving the first entries as clipped letters behind the sheet's name. A panel that covers the page covers all of it, and the menu button stays one layer above so the way out is never the thing underneath.
- **A tooltip appeared halfway across the screen from the control it explains.** Hovering the stopwatch put "Start the stopwatch" over on the far right, tucked under My role. The bubbles are positioned in screen coordinates, and the header's centre column was offset with a transform — which quietly makes that column the frame of reference for anything positioned against the screen inside it. The bubble worked out the right coordinate and then had it measured from the wrong origin. The offset is now done in a way that moves the column without changing what its contents are measured against.


### Fixed
- **The console stops rebuilding the whole sheet four times a second.** The live countdowns are sampled every 250ms so a second is never seen to be missed, and each sample produced a new object — which the sheet's render reads, so every row was rebuilt. Idle, touching nothing, a long sheet spent three quarters of its main thread rebuilding a table to produce about thirty DOM changes across three rows, and every press had to queue behind a rebuild already under way. The clock is still sampled four times a second; it now only publishes when a value that is actually SHOWN has changed, and everything shown is whole seconds. The progress bar keeps its smoothness for free, being a CSS width with a linear transition, so it interpolates between the per-second steps.


### Fixed
- **Opening the menu no longer shoves the sheet sideways.** It added around 200 pixels of left padding, so the whole run sheet slid right and every column re-laid itself out — during a live show, mid-cue, to read a menu that is closed again two seconds later. The menu now floats over the sheet at every width, which is how narrow screens already behaved; the only space ever reserved is the 34 pixels the button itself occupies, open or shut.
- **The cue timer and its controls stay on one row.** The shared width was a number measured off the controls once, and it broke the moment the stopwatch face grew two digits for hundredths: 395 pixels of buttons in a 386 pixel box, so the stopwatch dropped onto a row of its own. The width now follows the controls whatever they become, while the timer's label is stopped from contributing to it — otherwise the longest row name would size the header, which is the jitter this all started with.


### Changed
- **Three phone-only tidies to the show header.** The event clock puts its label and the time on one line instead of two — stacked, it spent two rows of the scarcest screen there is on a label that never changes. The prompter button is gone from a phone: it opens a full screen of its own, so a phone that reaches it has left the sheet entirely, and it costs a slot in the only toolbar row there is. And My role comes back up beside Clock synced rather than sitting alone at the end of a row of its own. All three are unchanged on tablets and desktops, where the room exists.


### Fixed
- **The menu button is no longer painted over by the bar beside it.** It and the show's top bar both claimed the same stacking layer, and on a tie the later element in the document wins — so the bar covered the only way in and out of the sidenav, and a press landed on the bar instead. It now sits one layer above the bar, and still below the formatting bar and popovers, which are allowed to cover it while they are open.


### Changed
- **The cue timer and the controls under it are one width.** They sit directly on top of each other and are read as a pair, and they were 360px and 385px — a 25px step down the middle of the screen. One width now, owned by the column that holds them rather than by either box.
- **No back arrow.** It sat in the same wrapping row as the sheet's name and squeezed it into a five-line tower down the side of a tablet, for a job two other things already do: the sheet's name is the way back on any narrow screen, and the sidenav carries Dashboard on a wide one. The name also gets a single line with an ellipsis on narrow screens instead of wrapping.
- **No stopwatch on a phone.** It wrapped onto a line of its own above the sheet — a whole row of the scarcest screen there is, for something used a few times a night. It stays on tablets and desktops, where the room exists.
- **The stopwatch reads in hundredths and redraws at screen rate.** Tenths on a ten-per-second timer read as a number being reported rather than a clock running, and a press could land a tenth of a second before the next redraw, so starting and stopping felt like they lagged the finger. It now redraws on the animation frame — which also costs nothing while stopped and suspends on a hidden tab — and shows two decimals.

### Fixed
- **The TIME and DUR columns stop being squeezed into nonsense on a tablet.** Sharing the width proportionally meant a narrow screen got narrow columns: at tablet width every single time cell was clipped — "12:00:00 AM" needs 109 pixels and had 69. Those columns now hold a floor measured from the text they carry, and the columns holding prose give up the room instead, because they can. On a screen too small to afford the floors they are dropped entirely rather than leaving the item column unreadable — a shortened time beats a sheet nobody can use.


### Changed
- **The cue timer is a fixed object.** Its width used to be whatever its widest line needed, and the widest line is the name of the row on air — 232px on "HOLD", 362px on "Player Review thanks to Northbank", a 130px swing. It sits centred, so every cue change shoved the controls either side of it and moved the number under the eye that was reading it. A clock that jumps when the show does is the one thing it must not do. It is now a fixed width and the name truncates instead.
- **The stopwatch is one instrument, next to the show's controls.** It was three loose buttons strung along the toolbar, reading as unrelated controls that happened to sit near each other — and near the cue timer, which is a different clock entirely and must never be confused with it. It is now a single bordered box sitting on the end of the LIVE · Pause · Stop line, under the cue timer where the clocks belong.
- **Lap is gone from the stopwatch — start, stop, reset, nothing else.** Splits are something you read back afterwards, and a live sheet is not where anyone reads anything back. Every control on that screen is one more thing to hit by mistake during a show. A measurement already running survives the change.
- **A row with no name announces itself on the cue timer too.** The biggest readout on the page was showing a bare dash for rows the sheet never named, while the sheet beneath it had already worked out what they were. It now borrows the same stand-in. The blank test also runs *before* the formatting branch, because a dash can be a formatted dash — and those rows were slipping past the stand-in and back to the bare "—".


### Fixed
- **A row with no name says what it is, instead of showing a dash.** Plenty of real rows have no name: a sheet writes "DJ — Barracuda" under AUDIO, or "Broadcast | Tries and Goals animations" under SCREEN, and puts nothing at all in the item column. Those are cues like any other, and the import is right to leave the title empty rather than invent one — but a column of blanks and dashes reads as a column of holes, and a page of them reads as a broken import. The item column now borrows the row's own first piece of content and shows it greyed, so it is clear the words came from another column rather than being written in this one. The cell stays genuinely empty underneath: nothing is rewritten, and typing in it still starts from nothing. The department column is skipped when choosing — a sheet of rows all called "AUDIO" would be no better than a sheet of blanks.
- **A title that is only a dash is treated as no title.** Some sheets type one into an item cell they mean to leave blank. Read literally that is a row named "—", which is worse than a row named nothing: it looks like content and says less. It now counts as blank both on screen and during import — which matters because a sheet imported before the game-period fix carries these, and without it re-importing the very same file could not repair it.


### Fixed
- **The sheet reaches its own right edge again.** The grid is laid out at full width on the belief that a browser scales stored column widths proportionally to fill it. It does not — a fixed table layout honours every width it is given and leaves whatever is left over as dead space at the end. Once every column had been sized, which happens the first time anyone drags one and catches the item column too (the one that is supposed to flex), nothing absorbed the remainder: a sheet whose widths were saved on a narrower window ran 1229px of columns down a 1442px grid, first column flush to its edge and 213px of ruled nothing down the right-hand side. Widths are now written as a share of their own total instead of in pixels, so the same numbers describe the same layout and 100% of the grid is exactly the grid. Every proportion that was dragged is kept, and both edges stay pinned at any window size.


### Fixed
- **The cue timer counts the live show, and nothing else.** A pre-record is shot while the show goes on around it, and a bell is a warning — they belong on the sheet, they occupy people and cameras, and neither is ever called by the showcaller. Neither can now become the row the show is sitting on. The moment one did, the item countdown was counting something that was not on air and the show's drift was being measured against it, which is how a show came to sit on a nine-second insert with the readout climbing into the red. The refusal is on the server rather than only hidden in the console, so it holds for every device and every replayed command instead of needing to be got right once per screen. These rows can still be *fired*, which logs them to the as-run record without taking the show off air — the affordance they actually want.


### Fixed
- **A show could get stuck on a pre-record and never be let off it.** Following the clock, a show is never walked backwards on its own — the guard exists because when the clocks go back, 02:00 to 02:59 happens twice, and a sheet with rows in that hour would be called a second time. But "backwards" was measured in sheet rows, and a pre-record is written on the sheet near where it is *shot*, not where it airs, so it can sit well below the rows that follow it on air. Once a show was sitting on one, every legitimate place to go counted as backwards, the follower refused to move for the rest of the night, and the overrun on a nine-second insert climbed until the show time went red. Four of the six pre-records on the last match sheet would have held a show that way. The comparison is now made in the running order rather than in sheet rows: a row that runs alongside the show has no place in its order, so a show sitting on one is not ahead of anything, and the clock may take it back. The backwards guard itself is unchanged for every row that really is part of the running order.


### Changed
- **The two project documents are now written on the same trigger.** The changelog has gone in with every commit; the development journal, which carries the reasoning the diff cannot show, had quietly fallen twelve commits behind. Both are now tied to the commit, and the journal's required contents are spelled out — what was measured and the numbers, the alternatives rejected and why, and the hypotheses that turned out wrong. The wrong turns are the point: a later reader who cannot see why a rule matches fifteen rows instead of thirty-nine will widen it and break the sheets.


### Fixed
- **A half is forty minutes plus the five for extra time, and the sheet said so all along.** Match sheets write a period as two lengths — `0:40:00`, then `0:05:00` on the line beneath — and the merge that joins those lines into one row kept the first and threw the second away. So the app planned a forty-minute half where the sheet had planned forty-five, and then reported the missing five minutes as a fault in the sheet: twice a game, on most of the match sheets here. Adding the lengths up wherever they appear would not be safe — some rows carry two real lengths and some carry junk (one reads `00:30` and `7`), and nothing in the text tells them apart — so this asks the sheet rather than deciding. The extra is spent only when spending it lands the running order exactly on the next printed time and leaving it out does not. On a half that is decisive: kick-off at 8:02 plus forty is 8:42, half time is printed at 8:47, and plus five it is 8:47 to the second. The last match sheet went from three disagreements to one, and the one left is a genuine typo in the original document — a bell typed as `5:26:00 am` in an evening sheet, which the pre-flight check already names before anyone goes live.


### Fixed
- **A game's halves are rows of the show, not headings over it.** Match-day sheets write a period in two lines — the timing on a numbered line with the item cell left empty, and the name alone underneath, printed across the width. Read literally that is forty anonymous minutes followed by a heading, so the halves arrived as page furniture with every cue inside them hanging off it as a child. The two lines are now joined: the first half IS the row that runs from kick-off, and the cues during it are what happens while it runs, not its contents. The pair is only ever joined when the name row carries nothing but its name and no number of its own — on the densest cue sheets the looser reading would have folded a DJ cue into the GFX cue beside it, and across the sample it matched 39 places against the safe rule's 15, every one of those a game half. Three rows that used to show a bare dash for a name got their real one back as well.


### Fixed
- **The moving bar now runs across everything happening at once.** Where several rows share a moment — a half-time block, the standby that opens it, the first cue inside it — only one of them carried the timer. The cause was that a row the sheet gives no length was treated as taking no time at all, so it was never "on" for even a second; it now runs until the next row starts, which is what the sheet means by leaving the column blank. Headings are still left alone.

### Fixed
- **One heading where the sheet printed two.** A run sheet can carry the same section banner on two consecutive rows — the source of the last import has "FIRST HALF" twice, back to back, with nothing between them — and the import took them at their word, so the sheet showed two first halves. Consecutive identical banners now collapse into one. A banner that recurs later in the day is untouched: the second game has its own half time, and that is a real second heading.

### Fixed
- **The soak-test generator stopped writing dashes on rows that have no title.** Hundreds of rows keep their content in another column and have nothing in the title, and filling them with "—" made a generated sheet read as a sheet full of holes. Test material only; no effect on imported sheets.


### Added
- **Show information: the page furniture is kept, but out of the running order.** A production run sheet is a document as well as a running order, and imported flat its masthead arrived as cues — one real sheet carried its title block eight times, once per page. Those lines now sit under **Show information** on the sheet instead, so nothing is lost and nobody steps through the masthead at kick-off. Which lines they are is decided by where the PDF PRINTED them: same text, same height, several pages. Repetition alone is not enough and was not used — a cue sheet repeats itself legitimately, once per scoring scenario, and counting repeats moved 43 live cues off an NRL sheet before this was rebuilt on geometry. A row carrying a time or a duration is never moved, whatever else is true of it.


### Added
- **The drift readout says what it is measured on.** "SHOW +8:59:01" is a true number and a useless one on its own: it is measured against the row the show is sitting on, so when that row's printed time is wrong the readout is wrong with it, and nothing on the screen said which row or what time it claimed. Hovering it now reads *"The show is behind, measured on 'TWO MINUTE BELL', which the sheet puts at 5:26:00 AM."* That is the sentence it took an evening to reconstruct from a number that could have explained itself.

### Added
- **Before you go live, what's worth a look.** The first press of Start show now lists anything the sheet says about itself that does not add up — a time that contradicts the running order, and how many places the durations disagree with the printed times. The second press starts the show. A clean sheet costs nothing and is never interrupted; a dirty one costs one more press and is never blocked, because if it is 8:01 and kick-off is at 8:02 the show starts whatever the sheet thinks. On the sheet that sent a live show twelve hours out of place it reads: *5:26:00 AM on "TWO MINUTE BELL" looks like am for pm — probably 5:26:00 PM*. That was there to be seen hours before kick-off; nothing said it.

### Added
- **A stopwatch beside the transport.** For the things the sheet does not time — how long the band actually played, how long the crowd took to clear, how long that interview really ran when the sheet said ninety seconds. Press the number to start and stop it, Lap marks a time without stopping. It is LOCAL to the screen that started it: the cue timer is the shared truth, and a second shared clock next to it would only be a second thing to be wrong about. It survives a reload by storing the moment it started rather than a running count, so an eight-hour show and a refresh cannot make it drift.

### Fixed
- **The back arrow was sitting underneath the menu button on phones.** Pinning it to the corner put it exactly where the menu button already lives, and the sheet's name was being shouldered off centre by three separate left paddings that stacked — a hundred and thirty pixels on the left against forty-eight on the right, for one 34px button. There is now one reservation, symmetric, on the header itself, and no arrow on a phone at all: the sheet's name is the way back there, which leaves renaming to the wide layout where it belongs.

### Added
- **A block and its contents can both be true.** "HALF TIME (15 mins)" is a quarter of an hour, and the wrap, the review and the ad reel beneath it are also that quarter of an hour — the same fifteen minutes written twice, once as a block and once as its contents. Counted in sequence the sheet claimed half an hour it has not got, which is what put an overlap at half time on every game sheet. A block now keeps its length everywhere it is read (the sheet still says fifteen minutes, and a countdown on it still counts fifteen) and moves the running order on by nothing, because its children already do. Unlike a pre-record it stays part of the show and still takes a cue: somebody calls half time.

  Found on import by an identity rather than a resemblance — does dropping this row's own length make the chain land EXACTLY on the next printed time? A block's children fill it by construction; a cue that runs before them does not. Across the sample sheets that is true of six rows, five half-times and a half of football, and of nothing else. Two guards earned by measurement: the children must add up to something (where they sum to zero it is two rows on one time, which is simultaneity and not containment — that alone was both of the rule's false positives), and the match must be exact (sixty-seven rows come within a minute and every one is an ordinary cue).

### Added
- **`make-speed-sim.mts`: a 24-hour soak test built out of a real run sheet, run at speed.** Point it at a match-day sheet and it compresses the day by a divisor and stacks the cycles back to back — a tenth speed turns one match day into about fifty minutes, so a day of testing is roughly thirty consecutive games, each with its own kick-off and therefore its own set of endings. Derived from a real sheet rather than invented, because an invented one only exercises the cases somebody thought of: a real one brings a pre-record shot during the game, a two-minute bell, a block spanning the cues that fill it, and a time typed into a title. It reads the source through the same pipeline the import screen uses, and it reproduces the source's faults faithfully — a sheet with an am/pm typo produces a simulation with that typo once per cycle, which is the point.

### Changed
- **Phones get the sheet back.** On a real match-day sheet the chrome left about two rows of table visible: a cue timer, the show state, a two-line title, three readouts, the event clock and two rows of controls, before a single item. The name is one line now, the readouts and event clock share a centred line, and everything under the timer is actually centred rather than left-aligned beneath it. The timing nudges no longer dock at the foot of a phone — they cost a bar of screen, put a CUE button under the thumb holding the device, and opened every time a row was tapped to read it. Taking seconds out of an item is a console job.

### Added
- **The timing check can say "this row spans the ones beneath it".** Where the row opening a segment is exactly as long as the whole disagreement, it is not a cue that ran long — it is a block containing what follows: "HALF TIME (15 mins)" at 8:47, then the wrap, the review and the ad reel that fill those same fifteen minutes. Counted twice, the sheet appears to hold a quarter of an hour it has not got. One click now mutes it, keeping the fifteen minutes visible on the sheet and out of the sum. On the match-day sheet that closes the overlap exactly.
- **A checklist of times the sheet's own order says can't be right, before you import.** These parse perfectly — they are valid clock times that contradict the rows around them, so nothing catches them until the show is live. Two kinds, told apart because they need different answers: an **am typed for a pm** (adding twelve hours puts the row exactly back in order, which is the giveaway, and the correction is offered), and an **elapsed offset in the TIME column** — cue sheets write "0:00:15", "0:09:00" meaning fifteen seconds and nine minutes into a segment, which read as a quarter past midnight in the middle of a Saturday afternoon. Across the sample sheets this finds 14: two real meridiem typos and twelve offsets. Reported, never corrected — "0:00:15" is a genuine time on a sheet that runs through midnight, and the check stays silent on one. Checked the other direction too: of 2569 rows where the source printed an am or a pm, the import agrees with every one.
- **Draw is offered when the day has no golden point.** An exhibition or a junior match is still rugby league and goes on a rugby league sheet, but nobody is playing golden point — so the day ends at full time and a level score is a draw. Offering "Golden point" there offers something that cannot happen, and withholding "Draw" withholds the only button the showcaller needs. Taken from the sheet rather than asked as a setting: a day with golden point has a golden-point block written into it, and a day without one does not.

### Added
- **Rugby league finals are their own kind of show, and the NRL's timing is written down.** A regular-season match level after ten minutes of golden point is a draw; a final is played on until somebody scores, so offering Draw there is offering a result the competition cannot produce. `nrl` is now "regular season" and `nrl-finals` sits beside it. [Kinds of show](docs/KINDS-OF-SHOW.md) gains a section on how an NRL match fills a run sheet: the two 40-minute halves, why the 5:00 block after each is stoppage allowance INSIDE the half rather than five more minutes of show, what golden point does to a showcaller (any score ends it on the spot, so the next item must be ready at any moment), and why a final's extra period should be left untimed. Both golden-point rules are cited.
- **A time stranded in the duration column is put back.** The same extraction artefact that cost the halves their length also cost them their start: `0:40:00 8:02:00 PM` in one cell, with the TIME cell left empty. The duration was recovered earlier; the time now is too, filling only a gap the sheet left and never overruling a TIME cell that has a value.

### Added
- **The two-minute bell is a warning, not a cue.** Like a pre-record, it happens during whatever is on air rather than instead of it — and it was carrying four minutes of duration that the show was made to spend. It now runs alongside: no time in the running order, and the transport steps over it. Only the warning is caught, never the word: real sheets ring bells on camera as part of the show ("RINGING THE BELL", "BELL RINGING MOMENT ON CAMERA", "LX - BELL LIGHTS ON", and a read that opens "Ringing the legacy bell tonight is…"), and a "STANDBY FOR HALF TIME" spans forty minutes of play. Four sheets report fewer false faults. A second track is still held to the clock, though: a bell whose printed time lands hours before the row above it is still reported, because being off the running order does not make a wrong time right.

### Added
- **A second track runs, but is never cued.** With more than one thing on at once, the transport steps along the running order only: Next and Prev pass over a row that runs alongside, clock-follow never targets one, and a show never starts on one. It still runs, still shows its progress, and still finishes on its own — which is what a pre-record is; nobody takes a cue on the coin toss being shot in the tunnel. If you somehow land on one you can still step off it, the same escape hatch a skipped row has. Which rows those are is not guessed beyond the pre-records the importer can name: a block spanning its contents is concurrent too, and there the CONTENTS are the show, so an **∥ Alongside** toggle on each row lets the sheet say which track is which.

### Added
- **Things that happen at the same time are now shown as happening at the same time.** A run sheet is not a queue: a pre-record is shot while the game is on, an announcer reads over a music bed, a block spans the cues that fill it. The app had one word for two rows sharing a moment — the live cue — so everything else in that moment was invisible, and the timing check could only call the overlap a mistake. Every place where row windows genuinely intersect is now found and marked, each row saying what it runs with; rows on air alongside the cue carry their own progress, driven by the clock rather than by anything having cued them. Rows that merely touch — one ending exactly where the next begins, which is every ordinary row — are not concurrent, and alternate endings are not either, since only one of them is ever played. On one match-day sheet this finds 45 rows in 8 groups, among them the pre-record that runs inside the first half.
- **The grid's clock marker follows the same rule as the show.** It had a third copy of "the last row whose start has passed", missed when the other two were unified, so it could mark a row the show no longer followed.

### Fixed
- **Forty minutes of football was importing as five.** PDF extraction assigns text to columns by where it sits on the page, and on some rows the row's time lands in the duration's band — the TIME cell comes out empty and the DUR cell holds both values: `0:40:00 8:02:00 PM`. That parses as neither a duration nor a time, so the row fell through to whatever the next merged line offered, which was `0:05:00`. Both halves of the match lost their length that way, and with them 70 minutes of the day. The duration is now recovered when what follows it parses as a time — narrowly, because `45mins - 1hr` and `6 mins 15 mins` are genuinely ambiguous cells the import screen is right to ask about. On the affected sheet the two forty-minute holes the timing check reported become five-minute ones, which is the real stoppage between the end of play and the hooter, and the day it accounts for goes from 8:13 to 9:23.
- **A show sitting exactly where it should be reported itself minutes behind.** A row the sheet gives no duration was treated as zero seconds long, so every second spent on it counted as overrun — and the rows that carry no duration are the ones it matters most on. "STANDBY FOR HALF TIME" covers the forty minutes of a first half, because no sheet writes a duration for a game. Twelve minutes into the half, a live show reported itself twelve minutes late with its projected end pushed out to match; by the hooter it would have claimed forty. Such a row now runs until the next one starts, which the sheet does say by anchoring that next row to a time — so the timer counts DOWN the rest of the half, and only play that really does run past the hooter is reported as overrun. Where the next row is unanchored the gap is zero and nothing changes.
- **Follow clock could park the show twelve hours out of place.** The clock's target is "the last row whose planned start has passed", which assumes the sheet runs forwards — and it does, until one cell is wrong. A sheet with `5:26:00 am` typed for a bell at row 13 gave that row a start that had "passed" from early morning onward, and because it sits further down the sheet than anything genuinely current it won the entire afternoon: pressing Follow clock jumped the show onto a bell twelve hours out of place, and every readout followed it — the item and show timers reading +8:59:01, the projected end on the following day. A row that contradicts the sheet's order by more than an hour can no longer become the clock's target. There were also two implementations of this — one driving the live show, one driving the prompter — and the second would have kept the old behaviour; there is now one.

### Fixed
- **An am/pm typo in a TIME cell is now reported instead of passing silently.** A sheet had `5:26:00 am` typed for a two-minute bell sitting between rows at 5:25 PM and 5:26 PM. Skipping that row let the running order continue to the second, so the check read it as a row that happens ALONGSIDE the order — a bell, a deadline — and said nothing. The live screen then anchored to it and reported the show 8 hours 59 minutes behind with its projected end on the following day. A row can only run alongside the order if it sits inside it, so a start that lands more than an hour before the row above it is now read as out of order rather than parallel. Where the line sits was measured, not guessed: across the sample sheets every legitimate parallel row was 1 to 22 minutes out of place, and every mistake was 11 hours 59 minutes. Two sheets carry one; both now say so, and no other sheet gained a report.
- **The timing check no longer offers a fix that cannot work.** "Change this row's duration to 00:00" was offered wherever a row sat before the disagreement — including when the row is shorter than the disagreement, where emptying it resolves only part and the sentence beside the button still promised the durations "meet the printed time exactly". Emptying a four-minute bell out of a nineteen-minute overlap leaves fifteen minutes of it. Thirteen of the ninety-five disagreements across the sample sheets were being offered that. The option is now withdrawn where it cannot deliver, leaving the two that can: move the printed time, or accept the gap.
- **A row that spans the rows beneath it no longer reports an overlap the size of itself.** The timing check already knew that two rows on the same printed time start together; but a spanning row often has no printed time at all — "NSW CUP | HALF TIME" with a blank TIME cell, followed by the wrap that fills it carrying the time the block begins at. The test now also compares against the row immediately above, so a half-time block and the cue that opens it are read as beginning together. Same for an announcer's read over a music bed. Measured across the sample sheets: three fewer false reports on one, one each on two others, and nothing new anywhere.
- **A row with two lines in it could be 943 pixels tall.** A tooltip on a table ROW generates a pseudo-element, and a generated box inside a `<tr>` becomes an anonymous table cell: it takes the first column, every real cell shifts one to the right, and the last is pushed off the end of the table at zero width — where its text wraps one character per line. On a real sheet that made three rows 943px, 705px and 646px against a median of 133px, and on a live screen a row taller than the window hides the next cue completely. It was invisible as a cause because the rows were structurally identical to their neighbours — same cells, no colspan, no rowspan — and only their measured geometry differed. Rows no longer draw the arrow; the bubble is positioned independently and still appears on hovering anywhere in the row.

### Added
- **Pre-records run alongside the show, and no longer disturb its timing.** A pre-record is shot while the running order carries on around it — the coin toss in the tunnel at 7:02 while the crowd is being warmed up — and played out later as a VTR. Read as an ordinary cue, its start time became the point every later row was measured from and its length was charged to a show that never spent it: one real sheet had its whole remaining evening pulled back to the moment a ninety-second chat was recorded. Pre-records are now marked on import, carry a striped rail and a ∥ beside the row number so they read as a second track at a glance, take no time in the running order, and are left out of the timing check entirely.

  The rule is that a line of the title must OPEN with "pre record", because every pre-record has a second half — the VTR that plays it back — and that one is an ordinary cue which genuinely takes its seventy-five seconds. Across the sample sheets this separated all 32 mentions correctly: 15 recordings marked, 17 playbacks and passing mentions left alone. A row's length and its own start are untouched, so the crew shooting it still see a real time and a real countdown.

### Added
- **[Kinds of show](docs/KINDS-OF-SHOW.md) — the whole of the sport logic, written down.** What a kind of show governs (four things, and nothing else), how a sheet gets one and why the sheet beats the event, the table of built-ins with the traps called out, how alternate endings are found inside a sheet's own row titles, how one match is told from the next, and when the result chooser is allowed to appear. Includes the rules that look wrong until you have seen the sheet that taught them — why "extra time" is not a trigger and "next match" is not a kick-off.
- **`import-load.mts`: load a whole folder of sheets into a running server.** The companion to `import-check.mts`, which only proves a sheet parses. This one proves it lands — the API accepts what the import screen would send, the document builds, and there is a rundown to open at the other end.

### Fixed
- **A time or a length written into an item's name is now read as one.** Run sheets are typed by people, and a row whose TIME cell is blank often carries its time at the end of the description — "Clear Field 6:25:00PM", "TWO MINUTE BELL 8:56:00 PM". Scheduled from the durations above instead, one sheet put its production meeting at 4:00 when the page plainly said 4:45. The same habit fills the DUR column: "1st Quarter (15 Mins)", "Half Time (15mins)". Both are now taken, and a row that was only a moment because it had no length becomes a proper block. Guards, both measured against the sample sheets rather than guessed: the value must END the name (a time mid-sentence is prose), and a time must fit between the anchors bracketing it — two of the forty-two found were typos in the source, and those stay in the title where a human can see them.
- **Cue-sheet detection was drawing the line in the wrong place.** A sheet where only the parent rows are timed lists its sub-rows' durations rather than spending them — the thirty seconds of each ad inside a three-minute reel. That was applied to any sheet under half timed, which swept in match-day run sheets whose durations are the whole point. Importing every sample sheet both ways and scoring each against its own anchors separated the two groups cleanly, with nothing in between: run sheets sit at 44–49% timed, cue sheets at 11–22%. The threshold moved to 35%. Five run sheets were reporting two to three times the faults they have.
- **Two rows on the same start are no longer called an overlap.** Wherever a row spans the rows beneath it — "HALF TIME (15 mins)" at 8:45, then the wrap, the highlights and the ad reel filling those same fifteen minutes, the first also at 8:45 — the timing check charged the parent and then the children and reported a quarter-hour overlap. It did this on every game sheet, at the moment of the night with the most rows in it.

### Changed
- **Past an hour, the prompter says when — not how long.** `ON IN 36:27:21` is a number nobody reads down; on a multi-day sheet it was most of the day. Beyond an hour both the cue readout and the NEXT chip give the clock time the read lands on instead — `ON AT 11:50:00 PM +1d` — carrying the day, which a bare time would not. Inside the hour nothing changes: it counts down, and STAND BY still takes over in the last thirty seconds.
- **The dashboard's actions finish on one line.** A company's own buttons hung 17px outside the events beneath them, and each sheet's row 4px outside that — three ragged right edges down a screen that is mostly a list. All three land together now.
- **One way out of a show that has fallen behind, not two.** "Catch up now" jumped to the row the sheet pointed at and left you driving; Follow clock goes to the same row and keeps going, so the pair read as a choice when one was simply the other's first move. Catching up without handing over is still there — it is cueing the row, which is all that button did.


### Added
- **Cricket is two kinds of show, not one.** A Test can be drawn because time runs out; a T20 cannot be drawn at all — a tie goes to a super over, which is played until somebody wins. One cricket type offering Win/Lose/Draw put a Draw button on a format that cannot produce one, the same mistake netball had. Sheets already set to Cricket keep the drawn-match flow they were set up with, now named **Cricket — Test match**, and **Cricket — T20** joins it.

### Fixed
- **A reconnecting show channel no longer throws.** Every socket handler closed over whichever socket was current rather than the one it belonged to, so when a reconnect replaced it, a late "open" from the abandoned socket sent the greeting down a socket that was still opening — `Failed to execute 'send' on 'WebSocket': Still in CONNECTING state`, uncaught, recorded three times in production. Handlers now belong to the socket that raised them. A socket that has already been replaced also no longer starts its own reconnect, which could leave two channels each reconnecting the other's losses.

- **A show no longer reports a whole day of drift the moment it crosses midnight.** The sheet's own clock counts past midnight — 24:00 is the small hours of the second day — while the wall clock wraps to zero, and the two were subtracted from each other. A show sitting exactly on its cue read **−24:00:00** on the readout a caller uses to know whether they are late. Caught on a 48-hour sheet running across a real midnight: `+00:00` before, `−24:00:00` after. The day is now chosen by nearness rather than assumed, so it holds on the third day too, where a single day's correction would still have been wrong.
- **End times on a multi-day sheet say which day they are.** `end 12:00:00 AM` on a three-day run sheet reads as tonight; it was midnight three days out. The summary end and the projected end now carry `+1d` / `+2d` when the sheet has run past midnight, and are untouched on an ordinary same-day sheet.

- **The speaker timer no longer cuts the end off a long overrun.** It was sized for `02:10`; an item running an hour over gains three characters, and the last of them went off the side of the screen — on the one surface whose whole job is being readable from the back of a room. Measured at 800px wide: 216px of the time was cut off. The size now takes account of how many digits there actually are, and only ever shrinks, so ordinary times look exactly as they did.
- **The prompter no longer offers controls the server will refuse.** Opened on a crew join code it still showed the clock and a CUE on every row, and every press came back "caller role required". Whether a device may drive the show is decided from identity, so those controls now appear only for someone who can use them. The script, the countdown and the follow are untouched — reading is not driving.

- **The result bar goes once the ending it chose has played.** Calling the result left it across the foot of the screen for the rest of the day — on a sheet with four games, three of those bars were reporting decisions made hours earlier. It now stays while the show is still inside that game's endings, so a wrong call can still be Reset and the screen keeps saying what was called, and disappears once the show has moved past the block. A sheet that cannot say where its endings finish keeps the old behaviour rather than guessing.
- **The prompter no longer opens on a sentence saying your script does not exist.** An empty sheet reads as "nothing marked to read yet" — a claim about the sheet, not about the network — so that was the first thing on screen while the rows were still arriving, followed by a resize and a jump as they landed. It now says it is loading, settles the size and the scroll position, and reveals once. It reveals on a timer regardless, because a screen held blank by a flag that never fired would be far worse.
- **Sync Cue no longer drags scrollbars onto the page.** Its shared style animates `transform`, and a CSS animation overrides an inline one — so the centring was wiped the moment it appeared and the button sat with its full width hanging off to the right, pushing the page wide. It is centred with auto margins now, which no animation can touch.

### Changed
- **A long read is trimmed in the run sheet and whole in the prompter.** A passage written to be spoken is a paragraph, and a paragraph in a grid row buries every other item on screen. The sheet shows two lines and trails off; the prompter, which exists to be read from, carries every word. Printing and PDF export keep the full text — paper has no live show to run.


### Changed
- **The prompter now shows the whole run sheet and scrolls through it like the sheet does.** It used to render only the rows there were words for, so the live cue was usually not on the page and a reader could not see where the show had got to. The running order is there in small grey type, the words to be read are set large among it, and the caret follows the show item by item.
- **The size controls only touch the words to be read.** Making the running order that big would bury the script in the very context it needs to stand out from.
- **The script fills the width of the screen.** Side padding of 8vw was throwing away a sixth of a surface whose whole job is fitting words on it; the scrollbar is gone too, since nothing on this screen is dragged.

### Added
- **The words are paced to the item they belong to.** A fixed scroll speed is a guess — the same slider carries a forty-word welcome and a three-minute address, and one of them runs out of words while the other is still talking. The script is now sized to fit the time available and scrolled so it lands exactly as the item ends, solved continuously from the live clock rather than set once, so a pause, an overrun or a jump corrects itself. Touching size or speed by hand takes it off auto; the button puts it back.

### Added
- **A Prompter button sits with the transport on the run sheet**, beside Prev/Next and the clock, rather than three levels into the Views menu — it is opened mid-show by somebody already holding the sheet. Same tab, like every link in the app; the prompter carries its own way back.

### Changed
- **Sync Cue sits top-centre on the prompter**, over the script, where the run sheet puts it — the same button in the same place doing the same job.
- **The play/pause button is gone from the prompter.** The show starts the words; the space bar still drives a hand-scrolled rehearsal when nothing is running.

### Added
- **The prompter carries the clock and CUE, the same as the run sheet.** `◷ Follow clock` hands the show to the server to run off the TIME column, reading `Following clock` while it drives and `Clock synced` once the live cue is actually on the row the sheet points at — the same three states, the same command. Every row that is not live carries a `CUE` that takes the show there. A button rather than a tappable row: a stray touch on a page somebody is reading from must never move the show.
- **A refused command says so on the prompter.** Whether this device may drive the show is the server's decision, and a press that silently did nothing is indistinguishable from a broken button when you are live.

### Changed
- **The script starts prompter-sized.** 42px was a big paragraph on a web page, not something read off a stand across a room; it now opens at 84px, and the scroll speed starts in the middle of its range so the first press of play is a usable reading pace.

### Added
- **A countdown to being on camera, and the reads either side.** A bar across the top carries what was read last, what is read next, and how long until it — measured from where the show ACTUALLY is (what is left of the item on air, then everything planned in between), not from the clock time the sheet plans. It turns amber inside the last thirty seconds and red while a read is on air, the same colours the rest of the app uses.
- **A Sync button on the prompter**, the same bargain the run sheet strikes: scrolling by hand takes the script off follow rather than fighting you, and one button hands it back and jumps to the live cue.

### Changed
- **Links inside the app open where you are, not in a new tab.** Opening the follow, timer or prompter view from a run sheet spawned a tab, and so did Open on a view-only link. Piling up tabs during a show is its own small mess, and the one you wanted is never the one in front of you.

### Added
- **Every companion screen has a way back.** Follow, timer and prompter had no exit at all — closing the tab was the way out, which stops being an answer the moment they open in place. Back returns you to the sheet you came from, or to the dashboard when there is nothing behind it, so a link opened cold on a borrowed phone is not a dead end. On the timer it is deliberately faint: that screen is pointed at a speaker.

### Fixed
- **The prompter follows the show again.** It scrolled to the live cue by looking that row up on the page — but this screen shows only the rows to be READ, a handful out of a whole sheet, so for almost every cue the lookup found nothing and the page sat still. It appeared to follow only on the rare cue that was itself a read. It now follows the show's position in the sheet: the read that is on air, or the next one coming, marked **ON AIR** and **NEXT** so the two can never be confused. Once every read is behind, it holds the last one instead of snapping back to the top of the day.
- **"following" now means following.** It reported the state of the websocket, so it said "following" for hours while the screen tracked nothing. It distinguishes reconnecting, following, and a show that is not running.
- **The followed read lands on the read-position caret**, not the top edge — that fixed marker is where the reader's eye is. It also keeps placing until the scroll has demonstrably taken: the sheet arrives over a websocket, and an earlier attempt that gave up on a timer left the right row marked and the screen never moved.

### Fixed
- **"Done editing" no longer strands you on a sheet you cannot edit.** Handing the sheet back left the editing screen with no banner and no way to take it again: a page that says EDIT, refuses every keystroke, and explains nothing. The same silence covered a first claim that never landed because the server was briefly unreachable. Not holding the sheet is now always stated, with **Start editing** to take it — a read-only screen must say that it is read-only.
- **The live console no longer asks who holds the edit lock.** Only the editing screen ever shows a lock, so the request every console made on load was answered and thrown away.

### Fixed
- **The live console has its cue buttons back.** Taking the edit lock on every surface that can change a sheet cost the showcaller console its CUE buttons, its timing nudges, its Undo and its "Edit sheet" toggle the moment anybody else held the lock — which is exactly what the lock was never supposed to do. The lock now lives on the editing screen only; whoever is calling a show keeps every control they had, whoever else is editing.
- **The edit lock is no longer enforced on the sync channel.** That channel cannot tell somebody CALLING a show from somebody editing it, so a lock held on the edit screen silently turned a live console read-only — cue, nudges and undo dead, with nothing on screen to say why. A lock that can do that during a show is more dangerous than the problem it exists to solve. It is advisory on the editing surface until the connection can declare which it is.

### Fixed
- **A show that has ended no longer keeps counting on a screen that was left open.** A connection can die without a close event — a laptop sleeps, wifi drops, a proxy times the socket out — and the browser goes on reporting the socket as open to something with nothing at the other end. The screen kept counting from state frozen at the moment the connection died, and Stop went into the dead socket and vanished, so the page had to be reloaded before the show could be stopped. The channel now treats forty seconds of silence as death, reconnects, and re-reads the show. It also checks the instant the machine wakes or the tab is looked at again, rather than on the next tick — a sleeping laptop runs no timers, so waking is exactly when the screen is most likely to be wrong.
- **A transport command is no longer sent into a dead socket.** While the channel is silent, commands are queued for the reconnect instead of being handed to a socket that only looks open. A Stop that disappears is the worst thing this app can do.
- **Delete disappears the moment you confirm it.** It used to sit there until the server had answered and the list had reloaded, which reads as "that did not work" — and the second press it invites is the one you cannot take back. It comes back only if the delete actually failed.

### Fixed
- **You are no longer told that somebody else is editing your own sheet.** Every tab was given its own lock token, so the console on one screen and the sheet on another — or the same tab after a refresh — looked like two different people, and locked you out of a sheet you were editing. The token identifies a TAB, which is what the heartbeat needs; whose sheet it is, is a question of identity. Answering the second with the first was the bug. A genuinely different person is still kept out.

### Added
- **One person edits a run sheet at a time.** Opening a sheet to edit takes it; the next person sees who has it and reads along until it is handed back. The document underneath merges cleanly — that was never the problem. The problem is a run sheet being a shared statement of what will happen, and two producers quietly rewriting the same block both believing theirs is the sheet.
- **A lock nobody can be stranded by.** There is no Save button in this app — the sheet stores itself continuously — so the lock is released by finishing: press **Done editing**, close the tab, or go quiet. A holder who shuts their laptop stops counting after forty-five seconds, and the sheet says who had it and offers it to whoever wants it. A run sheet nobody can edit because a producer went home is a worse problem than the one locking solves.
- **Calling a show is never locked.** The transport, the result chooser and clock-follow stay open to whoever is running the show. A lock that stopped somebody pressing Next would be a far worse fault than the one it prevents.

### Fixed
- **Calling the result no longer cuts what is on air.** Pressing Win took the show to the winning song immediately — but the siren has gone and the second half is still on screen. Calling the result says which ending WILL be played, not that it starts now; the chosen branch is simply the next thing in the running order, so the show reaches it when the current item ends, by Next or by the clock, exactly as it would have anyway.
- **Floating bars are readable again.** The "live cue is behind the clock" bar and the refused-command bar were painted in a 12%-alpha tint with nothing behind them, so the run sheet read straight through the words — worst for exactly the messages that say something is wrong.

### Changed
- **The result chooser appears 30 seconds before the end of the half, not throughout it.** A bar across the foot of a live screen for the whole second half is something covering rows, and it stops being seen. It now arrives for the last half-minute of whatever runs into the decision — sliding up, bordered in amber, pulsing, with the seconds counting down — and the same again at the end of the extra period rather than for the whole twenty minutes of it. It stays if the show reaches the endings with nothing called, because otherwise there would be no way to call the result at all.
- **A kind of show's named period now means "no result before this"** rather than "ask from here on". The buffer decides the moment; the phrase decides whether the question can be asked yet — so a sheet with an ad break between the second half and the endings is not asked for the result at the end of the ad break.

### Added
- **A switch on the run sheet toggles the two ending layouts** — layered, or one line until called — so they can be compared against a live sheet without going three levels into a menu. It appears only on a sheet that has alternate endings.

### Removed
- **"Step it myself" is gone.** It stopped the clock advancing the cue and resumed from the clock's current row, which is exactly what the Follow clock toggle beside it already did — the same behaviour behind two controls, which is why neither label could explain why the other existed. The clock is now a plain toggle. Old as-run records keep their hold entries; a history that will not parse is worse than one naming a command nothing sends any more.
- **Columns is not offered while the show is running.** Which columns are on screen is a preparation decision, and the live screen is not where anybody should be rearranging the sheet they are calling off. It returns the moment the show is not live.

### Fixed
- **Catching up to the clock no longer reports the show as late.** Following the clock and then pressing catch-up made the show read +1:19 — the size of exactly the overdue it had just corrected. The jump stamped the row as starting at the moment the button was pressed, but catching up is a claim about where the show ALREADY was, so the row now inherits its planned start. The automatic follower had always done this; a hand-pressed catch-up went down a different path and did not. An ordinary jump still starts the row when you take it, because that one really does mean "we are taking this now".
- **Menus stay on the screen.** A menu was anchored to one side of its button — a decision made before anything knows how wide the menu is or where the button ended up — so the ⋯ on a row near the right edge put Rename, Archive and Delete past the window. It is now placed against the viewport, flipping above the button when there is no room below.
- **The import screen shows what each column will become.** Every column mapped to its own column displayed a bare ellipsis: the option read "New column (keep header)" in a box about half that wide. It says "New column", with the rest in the tooltip.

### Added
- **Rename a column heading on the import screen by double-clicking it.** Sheets arrive with whatever the last person typed at the top of the column, and this is the moment somebody is looking at it and knows what it should say. A column kept as its own carries the new heading through.

### Changed
- **The clock button says whether the show is actually on time.** "Following clock" only ever meant "the server is driving" — it said nothing about whether the cue was where the sheet points, which is the thing anyone glancing at it wants to know, and the two came apart badly enough once to be worth separating for good. It now reads **Clock synced** in green when the live cue is on the row the clock points at, and Following clock in amber while it is not there yet.
- **"I'll drive" is now "Step it myself".** The control stops the clock advancing the cue so you step it with Next — which the old label described only by metaphor.

### Fixed
- **A drawn match no longer starts at the same moment as the extra period that has to be played before it can happen.** Every ending was being stacked at full time, draw included — so the sheet said the drawn-match wrap began at 3:32 while golden point ran 3:32 to 3:57. Endings are a diamond, not a list: win and lose hang off full time AND off the extra period, golden point hangs off full time only, and a draw hangs off the extra period only.
- **The day now plans for the extra period AND the ending that follows it.** Twenty-five minutes of golden point and then an eighteen-minute winning presentation is forty-three minutes, not twenty-five. Taking the longest single branch is the time the day needs only if the match is settled at full time, and getting off air is the one thing that cannot be caught up.

### Added
- **Two ways to read the endings, switchable per device under Endings in the menu.** *Show all, in layers* keeps every branch on the sheet, grouped under a header that carries the one time its whole layer starts at, with the second possible start shown against the endings that have two ways in. *One line until called* collapses the whole block to a single full-time row and lets the chooser at the foot of the screen fill the sheet in. Both run against the same sheet so they can be compared before one wins; the setting is per device and never leaves it, so two screens can disagree on purpose.

## [0.34.0] — 2026-08-09

### Added
- **Each run sheet says what kind of show it is.** It used to be a property of the event, which cannot describe a match day that runs a netball game off one sheet and a rugby league game off the next — and the setting decides what the result chooser offers at full time, so one answer for both is the wrong answer for one of them. Sheets made before this keep what they had: the move carries the event's setting down onto every existing sheet rather than clearing it. The event keeps its own as the default for the next sheet made under it.
- **A company can add its own kind of show.** The built-in list was only ever going to cover the sports we had run sheets for. Adding one asks how a match ends in plain terms — whether a level score is the result or sends the match on, and whether the extra period can itself end level — rather than presenting a grid of outcomes and hoping for a coherent combination. Phrases like "4th quarter" are typed as they appear on your own sheets; nobody is asked for a regular expression. A kind you add behaves live exactly like a built-in one, because the definition travels with the show rather than being looked up.
- **Imported run sheets are reviewable, grouped by kind of show.** The files were already kept so Update import could re-read them; they are now listed and downloadable under Kinds of show. Import rules are the part of this app most likely to be wrong for a sport nobody tested it against, and grouping the evidence by kind is what makes the gaps visible.

### Changed
- **Creating an event no longer demands a kind of show.** It was a required field describing something that now belongs to each sheet, and a day running two sports had no honest answer to give. It is still offered, as the default sheets inherit.
- **Import and New rundown name line up.** Two boxes of the same width sitting one above the other read as a pair, so their contents have to start on the same line; the button was centring its label while the input's placeholder sat at its left padding.

## [0.33.1] — 2026-08-09

### Fixed
- **No Draw button on a competition that cannot produce a draw.** Netball, knockout football and an AFL final all send a level score to an extra period that is then played until somebody leads — so offering Draw after it offered a result that does not exist, at full time, with the stadium waiting. Only rugby league keeps it, because golden point runs a fixed ten minutes and can genuinely run out.
- **A league football match can be drawn again.** It was modelled as going to extra time, which league football does not do, and the Draw that actually happens was withheld. League and knockout are now separate choices, as are the home-and-away and finals forms of Australian rules — the formats differ in what can happen at the end, which is the only thing this setting governs.
- **Netball checked against real cue sheets** rather than written from the rules: the period is called "Extra time" and the last quarter is worded "4th Quarter Commences", both of which the app now recognises.

## [0.33.0] — 2026-08-09

### Added
- **Invite someone by email.** Their access is chosen by whoever has it to give and travels with the invitation, so accepting can never grant more than was offered. The link works once and expires in seven days; the person accepting sets their own name and password and is signed in on the spot rather than being made to log in with the password they typed a moment earlier. Where no mail server is configured the invitation still exists and the link comes back to be passed on by hand — sending is never a prerequisite. Somebody who already has an account gets the access added to it instead of a second identity.
- **A company can see and manage its own people.** Who works here, what each of them may open, and which invitations are still outstanding.

### Changed
- **A company is shown only the access that points at itself.** Crew are freelancers who work for several companies at once and every grant lives in one table, so a company reading another's roster off a shared person was a disclosure waiting to happen, not a display bug. The filtering is on the server: the same person can appear in two companies' lists with entirely different access in each, and neither is told about the other. An administrator still sees all of it.
- **Access that is not yours to give is refused outright**, rather than the disallowed part being dropped and the rest carried out. Quietly trimming a request reports success for something that did not happen — a company adding a freelancer to two events and owning one of them would have been told it worked, and found out at the venue.
- **"Everything at this company" works when a company invites somebody.** The picker never shows an id, because a company signed in as itself has exactly one; the server now resolves it to the company doing the inviting instead of rejecting the request as incomplete. An administrator, who has more than one company, is still asked which.
- **Fields in a row line up again.** They were aligned by their bottoms, which looked right until a field grew a hint line underneath — then that field's control floated above the rest of the row while its hint kept the bottoms level. Timezone and Event type both did it. Rows align by their tops now, so every control sits on one line and a hint hangs below where it belongs.
- **The menu button has room.** It is fixed in the top-left corner and floats over whatever is there, and the run sheet's back arrow sat exactly edge to edge with it — the two read as one control. The top bar reserves the space; the rest of the page keeps its full width.
- **Import a run sheet sits on its own line**, above the name-and-create pair. It opens a whole screen where the others make one empty rundown, and side by side they read as three equal choices.
- **Paste CSV is gone.** Importing a file does everything it did and more — the mapping preview, the roles, the column order — and it was a second way in that had to be maintained and explained.

## [0.32.0] — 2026-08-09

### Added
- **Importing a run sheet asks what kind of show it is for.** This is the moment somebody is looking at the sheet and knows, and the answer decides what the live result chooser offers — which is the wrong thing to discover at full time. It is stored on the event, so a second sheet for the same day inherits it.
- **Creating a company is a form, not a prompt.** A `window.prompt` cannot say what it wants, cannot mark what is missing and cannot be styled, so an empty name failed by silently doing nothing. The token it produces is shown once, with a copy button and a warning that it will not be shown again.
- **Every creation form names what is still missing** — company, event and import. Fields are marked and listed by name, so nobody hunts the form for the empty one.

## [0.31.0] — 2026-08-09

### Added
- **Event types.** What kind of show this is now lives in one place and says what changes: which endings are offered at full time, whether a level score goes somewhere before it can be a draw, what that period is called, and how far into the match the result is worth asking about. Rugby league, Australian rules, football, cricket and netball; corporate events, concerts and performance recordings, which have one running order and one ending. Adding another is data, not a hunt through the app — it replaced a `sport` string with one value tested for in half a dozen places.
- **A form says what is still missing.** Creating an event named every empty field rather than refusing silently, which is indistinguishable from being broken. The fields are listed by name, so nobody has to hunt the form for the empty one.

### Changed
- **The drawer opens with a hamburger.** The small triangle said "there is something to the left", which is true but not the point.
- **Tooltips are placed in viewport coordinates.** As children of the thing they describe they were at its mercy: clipped by any ancestor with hidden overflow — the back button's tooltip lost its first three words — and painted under the grid's sticky header, which sits in a different stacking context, so "ITEM / ACTION" showed through the Undo tooltip. Out of the flow they belong to nobody, so neither can happen.

### Fixed
- **A second sync server refuses to start instead of taking the database with it.** It opened the store first and discovered the port clash afterwards, so it died half-way through initialising — and an embedded database abandoned at that point will not open again, failing next time inside WASM with nothing that names the cause. The port is checked before anything is opened, and the message says what to do.

## [0.30.0] — 2026-08-09

### Changed
- **One view-only link, replacing join codes and guest passes.** They were two mechanisms doing nearly the same job with nothing on screen to tell them apart — one opened the live document, the other a filtered copy — so a showcaller had to know which was which to know what they had shared. There is now one kind of link. It opens the run sheet read-only, and that is all it can ever do.
- **Running or editing a show needs an account.** Caller and editor codes have been withdrawn. A code is a thing that gets photographed off a wall and forwarded out of a group chat, and neither should end with a stranger holding the transport. **This is a breaking change:** caller and editor codes already handed out stop working. They are not ignored — whoever holds one is told the code is view-only and to sign in — and they are listed under "No longer working" in the sharing panel so they can be tidied away.
- **A view-only link asks who is watching.** These links are meant to be forwarded, so a count of connected devices told a showcaller nothing about whether camera 2 had the running order. The name is asked for once per device, before the sheet appears, and appears against that device in the sharing panel. Recorded with it: browser, operating system, screen size and network address — said plainly on the screen that asks, not buried in a policy. It goes when the link is revoked.

### Fixed
- **The sync server closes its database before it exits.** Nothing did, so every stop was effectively pulling the plug. Postgres survives that; the embedded database used in development does not — killed mid-write it leaves a directory that will not open again, and the next run fails inside initdb with nothing that names the cause. A deploy sends the same signal, so this is the right thing in production too.

## [0.29.0] — 2026-08-09

### Added
- **Golden point now flows on to the result it produces.** The two-stage flow a level score really takes: at full time the choice is Win, Lose or ⚡ Golden point — never Draw, because in the NRL a level score does not end the match, it sends it to extra time. Picking golden point plays that block and asks again, now with Win, Lose and Draw, since a draw is only a real ending once extra time has been played out. Calling the result then keeps the extra time in the running order — it happened — and runs the winner's ending after it rather than on top of it. Previously the second pick skipped the golden block, so the twenty minutes everyone had just watched vanished from the sheet and every time below it jumped back.
- **The result is asked for at the foot of the sheet, not in the toolbar.** At full time the showcaller is watching the game and the bottom of the screen, not a row of buttons above the grid. The chooser is now a docked overlay stacked above the cue-point dock and the role bar — never covering either — with every pick the same size, and it pulses as the endings come into range.

### Changed
- **The run sheet is the page.** It takes the full width and height of the window: the side padding was costing 48px of grid at every size, and the strip of keyboard hints along the bottom was costing a row of the sheet to say things you learn once. The item column is now sized by measurement rather than left to the browser — a fixed-layout table does not reliably hand its spare width to the column left on auto, and it had been giving the action text 218px while 439px sat empty beside it.
- **The way back is one fixed square.** As a text button it changed width with its label and sat in the same wrapping row as the sheet name, so it moved whenever the window did.
- **The result chooser only appears when a result is possible.** In the NRL nothing can be called before the second half, so the bar stays out of the way until the live cue reaches it — up all afternoon it was just something covering rows. Without a recognisable second half it falls back to appearing as the endings come into range.
- **A tooltip cannot run off the screen.** The bubbles are centred on whatever they describe, which is right until the thing being described is in a corner — and the controls most likely to need explaining are the ones in the corners. They are nudged back by exactly the overflow, and flip below when there is no room above.
- **The prompter is a role.** It was deliberately excluded from role detection as "something the app writes, not a crew position". It is both: whoever runs the prompter wants to pick it as their role, see their rows lit and find them on the role bar. It still drives the prompter view, and it keeps the same colour on every sheet.
- **The sheet's name is changed by clicking it.** It was set once from the file name at import and could only be altered from the dashboard, so every sheet was called whatever the PDF was.
- **Columns can be dragged into order on the import screen**, not only after. The grid itself is reordered, so the mapping, the detected roles and the run sheet's own column order all follow — and since a narrow screen folds columns from the right, this is also where you choose what survives.
- **The run sheet never scrolls sideways, at any size.** A horizontal scrollbar hides half of every row behind an edge and asks someone calling a show to go looking for it — one-handed, mid-item. The grid now always fits, and what will not fit as a column of its own is folded under the item it belongs to, labelled. Folding runs right to left, so the column ORDER is the priority order: drag a column left and it survives a narrower window. The "All columns" toggle is gone; its only job was to turn the side-scroll back on.
- **The item number reads down instead of across on a narrow screen.** Stacked one digit per line it costs about a character, and every one of those characters goes to the action text instead.
- **Importing a run sheet opens it in the same window.** Every import spawned a new tab, so a few sheets left a row of near-identical tabs and no way back to the dashboard except closing one.
- **The run sheet has a way back.** "← Dashboard" sits in the header. It was only in the settings drawer, which meant opening a panel and hunting for a link.
- **One button height across the sheet's toolbar.** It mixed 32px buttons, 26px buttons and chips in a row that reads as a single set of controls, so three heights looked like three kinds of thing. Set on the toolbar itself, so a new control cannot reintroduce it.
- **The dashboard uses the window.** It was pinned to a 960px column, which left half a widescreen empty and wrapped rows that had room to sit on one line.

### Fixed
- **A show that runs past midnight no longer jumps back a day.** Sheets write times of DAY, so a New Year's Eve sheet goes 23:55 then 00:05 — and read as seconds-since-midnight that second one is twenty-four hours EARLIER. The sheet showed a −24:00:00 hole at the fireworks, everything after midnight sorted before everything before it, and clock-follow picked a row from the small hours while it was still last night. Run sheets are chronological, so the rollover is now simply counted: an anchor far enough behind the one above it starts another day. Times still display on a wall clock.

## [0.27.3] — 2026-08-09

### Fixed
- **A phone turned sideways is no longer treated as a desktop.** Every mobile rule keyed off screen WIDTH alone, so rotating a phone to landscape switched the whole mobile treatment off at the exact moment the screen got shortest: the run sheet came back with one row visible under a full stack of chrome. Short now counts as small, and on a landscape phone the chrome gives up its height to the sheet.
- **Crew initials stopped eating the sheet's own words.** Positions are short — GA, SC, MC, VT — and were matched anywhere inside a string, so "GAME ONE" was drawn as "GA" + "ME ONE" and "SCORES LEVEL" as "SC" + "ORES LEVEL". Rows also lit up as somebody's work because their initials happened to be spelt inside an unrelated word. A role now has to appear as a whole word.
- **A position no longer breaks across two lines.** In a narrow WHO column "CREW" was being split into "CRE" and "W".
- **The timing check stopped inventing a hole between two moments.** A milestone takes no time — "Renee arrives 13:30", "content check 13:40" are two markers, not a chain with ten missing minutes in it — but the check measured the gap between them as unexplained. A pre-show call sheet is mostly made of these, which is how one sheet reported thirty-three problems and had none of them. A gap is now only reported when the rows in it actually claimed to fill the time, or when a start runs backwards, which is wrong however little was claimed.
- **The import stopped asking about cells that were never times.** Sheets reuse their TIME and DUR columns: an event plan puts room allocations there ("Changeroom 3", "Radio Box No. 2"), a cue sheet prints a second clock in brackets beside the real one ("(4:25)" — elapsed within a segment), and a page footer lands under whatever column it sits beneath. All of them have a digit in them, and all of them were flagged as times someone had mistyped — twenty and thirty at a time, burying the one that really was. A value now has to be SHAPED like a time to be questioned. Across the example sheets that took the count from about 120 to two, and both survivors are genuinely ambiguous ("6 mins 15 mins").
- **Three ending blocks for one game are no longer three games.** Sheets close each ending with a plug for the next FIXTURE — "Next Match Round 14", weeks away — and that was read as a second game kicking off, so one match's win, lose and golden-point blocks were split across three games and the chooser asked about games that did not exist. Only a kick-off starts a new game now; a milestone still closes a block without starting one.

## [0.27.0] — 2026-08-09

### Added
- **A run sheet can be closed to its audience once the event is done.** A sheet stayed open to everyone who had ever been given a way in — crew codes, guest passes, view-only accounts — long after the show was over, and the only way to shut it was to revoke each code one at a time. One button in Show settings now closes it to all of them at once, with a page that says the event is over rather than pretending the link was never any good. Whoever calls or edits the show keeps their access, so it is always reversible by the people who did it.
- **The showcaller can take the wheel without switching the clock off.** Clock-follow was all or nothing: to step a cue by hand you had to turn the whole thing off and remember to turn it back on. Pause was no answer either — Pause stops the SHOW, freezing the item clock on every screen downstream. There is now a hold that stops only the automatic advance: the show runs on, every timer keeps counting, and the cue moves when the showcaller presses Next. Handing it back picks the show up wherever the cue now is. A hold is a moment, not a setting — switching clock-follow on again always starts unheld, and ending the show clears it.
- **A 24-hour, four-game test run sheet, generated as a PDF.** Nothing in the example sheets ran across a whole day, and nothing had more than one game's worth of alternate endings — so the cases that break (a sheet that crosses midnight, a result called on one game while three others are still to come, four endings stacked at once) had never been exercised end to end. The generator builds the sheet with a running clock so its own arithmetic is consistent, and everything in it — teams, venues, people — is invented.
- **An import check that reads a sheet the way the app does.** Point it at a file or a folder and it reports what the import screen would say: cells it could not read, times that do not add up, the ending blocks it found, the roles it detected. It exits non-zero when anything is wrong, so a release can be gated on it. "It imported" and "it imported correctly" are different claims, and the second one used to take twenty minutes of reading a screen against a PDF.

### Fixed
- **A table whose left border is not drawn no longer loses its first column.** Some exporters rule only the right-hand edge of each cell and let the page frame stand in for the table's left border. The run of column boundaries then opened one column late, so the item number and the start time arrived glued together in one cell — and the whole sheet imported with no times at all. When a column's worth of text sits to the left of the first boundary on line after line, that missing border is now taken as real.
- **A compound column header no longer leaves every row blank.** "ITEM / ACTION" and its cousins matched no known title header exactly, so the sheet imported with no title column: every cue row arrived empty, with only milestones saved by a fallback. A header that CONTAINS one of the known words now counts, choosing the column carrying the most text — the title column is the wordy one.
- **The timing check no longer invents a hole at the end of every game.** It added every alternate ending together, so a set of endings that will play one of four looked like a gap the size of the three that will not.

### Changed
- **The show's state moved under the cue timer, centred.** LIVE, Pause and Stop sat at the end of a toolbar of working controls, off to one side of the screen; the state of the show now sits directly beneath the thing everyone is already looking at. Stepping the cue — Prev and Next — stays in the toolbar, because that is a different job.
- **The top bar is one row of readouts.** The sheet's name, the item clock, the show clock, the projected end, the connection dots and the event time now line up with the top of the cue timer instead of floating at three different heights. What the sheet itself does — when it starts, how long it runs, when it ends — moved under its name, where it belongs; the word "Planned" is gone, since it only invited the question of what the unplanned ones would be.
- **The timing check no longer runs during a live show.** It reports where the sheet's own TIME and DURATION columns disagree — a question for whoever is building the sheet, answered before anyone goes on air. Once the show is running those disagreements are the point: a game runs long, an item is cut, the cue is dragged back to now. Crying wolf at the one person who cannot afford to look away helps nobody. It runs on import and in the walkthrough; an open panel closes itself when the show is called.

- **Alternate endings now sit stacked, and the sheet stops counting all of them.** A game's endings are alternatives — only one is ever called — but they were laid end to end like a running order, so a three-way ending made the sheet claim three times the time it would really take and every projected end after it was wrong. Each ending now starts at the same moment, the show resumes after the longest, and only one counts toward the running time. On screen they sit in their own lanes inside one frame, one directly above the next; once a result is called the others dim rather than disappear.

### Fixed
- **Picking a result no longer decides every other game on the day.** A sheet running several matches carries several sets of alternate endings, and the choice was read sheet-wide: calling the afternoon result skipped the evening game's branches too, hours before they were due, and a single Reset put all of them back. Endings are now grouped by the game they belong to, the chooser names the game it is asking about, and each result is picked and cleared on its own.
- **An ending no longer tags the rest of the day.** A branch ran from its header to the end of the sheet, so on a multi-game day everything after the first full time was marked as belonging to that one result. A branch now closes where the day moves on — the next result to choose from, the next kick-off, or the next fixed moment on the sheet.

## [0.24.3] — 2026-08-09

### Changed
- **A refused document connection now names the run sheet it was for.** The log said only that something had been turned away, so six refusals could have been one stale tab or six different ones — unanswerable from the log. Each refusal also writes its own warning line, because a client asking for a sheet it may no longer have is not a fault in the service.


## [0.24.2] — 2026-08-09

### Fixed
- **A link to a deleted run sheet no longer reports a server fault.** Opening one asked the document server for it anyway, was refused, and the refusal was journalled as a server error — so a stale tab or an old bookmark filed a fault on every load, for something the app already knew. The page now settles it before opening any connection: same message on screen, nothing sent, nothing logged.


## [0.24.1] — 2026-08-09

### Added
- **A show driven by hand now says when it has been left behind.** A manually-called show advances only when someone presses Next; left alone — a console closed, an operator called away — it sits on the row it was last given while the clock runs on, and every readout reports a show hours over with no hint as to why. When the live cue falls three or more rows behind where the sheet says the show should be, a note says so and offers the two ways out: hand it to the clock, or catch up to now.

### Changed
- **Sync Cue is now a proper target** — a full-height pill rather than a small chip, and larger again on phones. It is pressed mid-show, often one-handed, and it is the way back to the live cue after any scroll.


## [0.24.0] — 2026-08-08

### Fixed
- **A refused transport command said nothing at all.** The server rejects a command when the credential cannot call the show, when the show is not live, and in a few other cases — and the screen simply carried on as if the button had never been pressed. Live, "nothing happened" is indistinguishable from a broken button. Refusals now appear on screen where the person who pressed it is looking, and are written to the error log with the action that was refused. A command sent while disconnected says so too, instead of queueing silently.
- **Stop needed a second press within three seconds**, which is short enough that a glance away read as a dead button. It now waits ten seconds, says "Press again to stop", and pulses while it waits.

### Added
- Transport refusals join the error log alongside the browser errors and failed requests already captured there, so a fault during a show can be read back afterwards.

### Changed
- **Tooltips are the site's own.** The browser's take about a second to appear, render in the operating system's style, and cannot be placed. These appear the instant you point at something, match the rest of the interface, and flip below the control when there is no room above.


## [0.23.1] — 2026-08-08

### Changed
- **The live bar is down to what a show is called with.** While the show is running, adding rows, groups and milestones — and redo — sit behind an "Edit sheet" button rather than in the row you are calling from. Nothing is taken away; building a sheet is simply not what that bar is for once the show has started. Undo stays in the open, because the timing nudges are row changes and a mis-tapped −30 needs one press to put right.


## [0.23.0] — 2026-08-08

### Fixed
- **The page drifted on a phone, taking the clock with it.** The show screen sized itself to the viewport, which on iOS still leaves the document fractionally scrollable — the browser's own chrome collapsing changes what that height means. The page slid up, the timer and transport went off the top, and dead space appeared under the sheet. The screen is now pinned to the viewport on phones, so the only thing that scrolls is the sheet.
- **Syncing to the cue no longer hides the clock.** Centring the live row asked the browser to bring it into view, and that scrolls *every* container it sits in — including the page. It now moves the sheet alone.
- **The bottom bar no longer covers the last rows.** The crew bar is fixed to the bottom and changes height with what it says; the sheet now always ends above it, whatever it is showing.

### Changed
- **A phone shows what a phone is for.** The action text was being squeezed into a fifth of the screen while five columns and eleven buttons took the rest — on a 25-page sheet the thing you actually read was the thing you couldn't. Phones now give the action column everything the times leave, keep one cue column, and drop the sheet-building controls (undo, redo, add row/group/milestone) which belong on a desk. Transport, clock-follow, roles and "All columns" all stay.


## [0.22.1] — 2026-08-08

### Fixed
- **Following the clock reported the show as running late when it was running exactly on the clock.** When the clock follower moved onto a row, the row was recorded as beginning at that moment — but the sheet may say it began half an hour ago, and following the clock means being *on* it. A show picked up mid-way through a 53-minute item read 51 minutes still to run and 50 minutes over, with a projected end nearly an hour past the planned one. The follower now records a row as starting when the sheet says it started, so the item counts down correctly and the drift reads zero. A person pressing Next or jumping still starts the row there and then.


## [0.22.0] — 2026-08-08

### Added
- **The positions that run the show are roles too.** A sheet records who a row is for in more than one place: a WHO column naming people, and a cue column naming the desks that operate it — VTR, GFX, LED, CAM, TRK. Only the first was ever offered under "My role", so the graphics operator had no way to pick themselves out and the camera operator had to read every row. Both columns are read now, and a row lights up when it names any role its holder has. On one 25-page sheet that takes the list from four names to nine names and positions, and picking GFX marks 64 rows out of 463.
- Rundowns record every column that carries an assignment rather than a single one, so highlighting and the role picker agree with each other. Existing rundowns keep working — one column is simply a list of one.

### Fixed
- The prompter marker the import writes is no longer offered as a crew position. It is something this app adds, not a job on the sheet.


## [0.21.0] — 2026-08-08

### Fixed
- **The timing check stopped calling correct sheets wrong.** A run sheet is not one unbroken chain: alongside the running order it carries rows that happen *at* a time rather than taking time in it — two things booked for the same moment, a deadline ("team sheets due"), a standing cue ("2 min bell"), a note that something elsewhere has finished. Read as links in the chain, each one appeared to open a gap and then close it again. One 25-page sheet reported 11 disagreements and had none: every chain reconciled exactly once those rows were allowed to sit alongside it. A row is only queried now after checking the obvious alternative — that skipping it lets the running order pick up precisely where it left off. Genuine disagreements are still reported.
- **Two spellings of one person are no longer two people.** A cue column saying "cue DP" on some rows and "DP cue" on others produced two roles, neither of them a person; the word "cue" is the instruction, not part of a name. And a cell naming two people by their initials with only a space between them ("LC JM") read as one unknown role, so neither person's rows lit up for them. Names are left alone — a two-word name is still one person.

### Changed
- Timing-gap detection moved out of the reconcile screen into the shared core, where it can be tested. It now has tests, including that a real disagreement is still caught.


## [0.20.1] — 2026-08-08

### Fixed
- **The import stopped demanding fixes for cells that were never wrong.** A run sheet uses its TIME and DUR columns for other things on some rows — a team list puts positions there ("Fullback", "Interchange", "Head Coach"), a pre-show row says "TBC" — and every one was reported as a cell that "couldn't be parsed", with a box asking for a correction that does not exist. On one 25-page sheet that was 66 false alarms and nothing else. A value is only queried now when it was plainly reaching for a time or a duration; those all contain a digit. The text is kept beside its column either way, so nothing is lost by not asking.

## [0.20.0] — 2026-08-08

### Added
- **The prompter now fills itself from the run sheet.** Sheets set the words a presenter reads in italic, and that is what the import reads: those passages are marked **`prompter`** in the sheet's own cue column (SCR, TYPE, SOURCE — whichever the sheet uses, recognised by its contents rather than its name). The prompter shows every marked row with the time it is due and its item number, so the person reading knows how long they have as well as what to say. Marking or unmarking a row by hand does the same thing — the decision is visible and editable in the sheet, not buried.
- Italic **labels** are deliberately left alone. A track name or an all-caps lighting direction is not something to put in front of a presenter mid-show, so a marked passage has to read as speech. Short lines inside a read still come along — a "&lt;Captain to speak&gt;" between two spoken lines belongs with them — as does the bold line that pays a welcome off ("…please welcome to the field, THE CAPTAIN!"), and a line whose italics the author simply missed mid-sentence.
- Sheets that carry a Script column of their own still work exactly as before.

### Fixed
- **The end of a line could land in the wrong columns.** Where a sentence changes formatting part-way and runs wider than its cell — a welcome that finishes with a name in bold — the tail was filed under WHO and NOTES, so "…a true icon of the sport, HER NAME!" lost its last two words. Text is now kept together unless a real column border separates it.
- **A passage of script no longer imports as a section header.** Rows holding nothing but text were classified as headings, which rendered a paragraph of script as a grey banner across the sheet and discarded the row's other cells with it.

## [0.19.0] — 2026-08-08

### Fixed
- **Imported run sheets lost their item numbers.** The import screen re-read the sheet as you corrected cells, and that second reading skipped the numbering and the alternate-ending detection the first one had done — so every sheet imported with no numbers at all, and no win/lose/draw branches. There is now one way to turn a sheet into rows, and everything uses it.
- **Angle brackets were deleted from the text.** A run sheet uses them for prompts to read aloud — a captain to speak, a player's name to fill in — and anything shaped like a tag was stripped on the way to the screen, silently removing those lines. Only the app's own formatting is treated as formatting now.
- **A column could arrive split in two.** In a ruled table, one cell often holds several pieces of text at different positions — a name beside an italic aside, a bold heading over plain rows — and columns were being worked out from those positions, so a sheet's NOTES arrived half under NOTES and half under "Column 17". The table's own ruled lines now decide where the columns are, and text is placed by its middle rather than its left edge, so bold and centred values stay in the column they were typed in.
- **A column whose entries start late was thrown away.** Only the first 60 rows were read when deciding whether an untitled column held anything, so a countdown that begins on page five looked empty and was dropped. The whole sheet is read now — which also correctly discards a right-hand column that just repeats the row numbers.
- **Text in a time or duration column no longer vanishes.** A team list that puts "Fullback" or "Interchange" in the duration column had nowhere to put it and dropped it. It is now kept beside the column it came from, under the sheet's own heading.

### Added
- **An import audit** (`apps/web/scripts/import-audit.mts`): re-reads a rundown's source sheet through the real pipeline, reads the live rundown, and reports every row where the two disagree — missing rows, drifted numbering, changed times or durations, cell text under the wrong column. Exits non-zero on any difference, so it can gate a release.

### Changed
- The conversion from a read sheet into a rundown moved out of the import screen into the shared core, so it can be tested and audited without a browser. Its rules are covered by tests for the first time.

## [0.18.1] — 2026-08-08

### Fixed
- **Signing in as an administrator with an email and password could not open any run sheet.** Both live channels recognised only the literal admin token string, so an account carrying the administrator grant was turned away from the sheet and the show — while the rest of the app cheerfully treated the same sign-in as an administrator. Anyone using the pasted token never saw it; anyone signing in properly could not work at all. Administrator accounts now have administrator reach everywhere.
- The show channel and the "who am I" answer now **name the administrator account** instead of a bare "Admin".

### Changed
- The access-control matrix covers administrator accounts on both live channels, not only over HTTP (72 checks) — the gap that let this through.

## [0.18.0] — 2026-08-08

### Added
- **A screen that is refused now says why, and what to do about it.** Instead of loading forever, it names the fault in plain words — not signed in on this device, sign-in expired, this account has no access to this event, the sheet was restored, the sheet no longer exists — together with whose sign-in was used and the one action that fixes it. Sign-in links carry the sheet address, so signing in returns straight to it rather than to the dashboard.
- The server now sends a **reason with every refused document connection**. Previously the reason was discarded on the way out and every failure looked identical from the browser, which made a stranded phone impossible to diagnose from a screenshot.
- The diagnostics strip reports the **account a credential belongs to**, and appears immediately on a refusal rather than after the usual wait.
- `PGLITE_DIR` points a sync instance at its own embedded database, so a locked test instance can run alongside a dev server.

### Fixed
- **A refused sheet no longer retries forever.** The connection was reconnecting indefinitely against a refusal that could never succeed, putting a steady stream of requests on the server from a screen that was going nowhere.
- The diagnostics strip no longer **covers the message underneath it** — the page now keeps clear of the strip's height, which on a phone had hidden the explanation and its sign-in button entirely.

### Changed
- The access-control matrix now checks the **refusal reason** on each rejected document connection (68 checks). Its fixtures name the second company explicitly: an event created without one falls back to the first company on record, which on an empty database silently made the scoping checks test nothing.

## [0.17.0] — 2026-08-08

### Added
- **A diagnostics readout for screens that won't load.** When a run sheet has not arrived after a few seconds, a strip appears across the bottom stating, in plain words, exactly how far the connection got: the app version and build, which sheet and which sign-in kind, whether the content channel is connecting or was refused, whether the show channel is connected, whether the device is online, the server address being used, and the last error. A photo of that strip is enough to diagnose the fault without any developer tools. It carries a Copy button and a Retry button, and never prints a credential — only the *kind* of credential in use. Add `?diag=1` to any rundown address to show it deliberately.
- The document connection now reports **authentication refusals and socket closures** instead of failing silently — a refused connection that could not be recovered previously left the screen waiting forever with nothing to show for it.

### Fixed
- **Form fields lost their styling** (background, border, padding) in 0.14.2 — a selector was accidentally split while fixing the phone-width overflow. Restored.

## [0.16.0] — 2026-08-08

### Added
- **Timing nudges on every row** — `−30 −15 −5 · CUE · +5 +15 +30`, in seconds, for pulling a show back on time without typing into cells. Hovering a row reveals them at the right edge, clear of the cue text; they appear instantly, since this is a live control. Available to anyone who can run or edit the show — never on read-only views.
  - **CUE** means "this item is happening now": the row is pinned to the clock and everything below it re-times by the same amount. It re-times the sheet only — it does not move the show's live position.
  - **+ / −** change that item's duration, and **the live cue is the anchor**: time is absorbed on the far side of the edit, so whatever is on air never moves. Edit an item *after* the live cue and later items shift; edit one *before* it and the item's end is held while it and the items above it shift instead — the "kick-off can't move, claw the time back earlier" case.
  - Each press is a single undo step and syncs to every screen, exactly like a typed edit. A muted or skipped row changes its own duration without moving anything else, and no duration is ever pushed below zero.
  - **On tablets and phones**, which have no hover, the same controls dock along the bottom of the screen and act on the selected row — or the live cue when nothing is selected — sitting clear of the role bar.

## [0.15.1] — 2026-08-08

### Fixed
- **A column's data now imports under the sheet's own heading.** Where a heading is centred over left-aligned text, the two land in different bands, so the sheet's named column arrived empty beside an anonymous "Column 7" holding the real content. A named column that came up empty now adopts the neighbouring band that holds its data — judged by relative fullness, since notes and similar columns are legitimately sparse.
- The title column keeps the sheet's own heading (ACTION, ACTIVITY…) rather than falling back to a generic label when several bands feed it.

## [0.15.0] — 2026-08-08

### Fixed — run-sheet import fidelity
Four import faults were found by re-reading a 25-page production sheet against its source and fixing what didn't match. On that sheet the imported rundown gained 20 rows it had previously swallowed, every row gained its title, and the timing check dropped from 13 items to 11 — with the remaining ones being genuine properties of the sheet rather than import damage.

- **Rows that carry their own clock time are no longer folded into their neighbour.** Whole blocks go unnumbered on real sheets — everything before the first cue: call times, content checks, rehearsals, doors — and the importer treated each of those lines as wrapped text belonging to the row above. An entire afternoon of preparation collapsed into a single row hours long, which the timing check then reported as one enormous unexplained gap. Lines with their own time (including ones written "TBC") now stand as their own rows.
- **Late-addition item numbers are respected.** Sheets insert additions as "129a" and "129b" rather than renumber the document; those rows were treated as continuation text and merged upward, dragging their times with them and scrambling the running order — which surfaced as several impossible gaps where the clock appeared to run backwards.
- **Page furniture is dropped instead of being absorbed into cues.** The title block a document repeats on every page was merged into whichever cue happened to sit at a page break, putting the sheet's masthead inside a cue title. Text that repeats on three or more pages and carries no time or item number is now recognised as furniture.
- **A wide, centred title column is matched to its content.** When a column's header is centred but its text is left-aligned, the two land in different bands; the search for the real content only looked two columns away, so sheets like this imported with every row untitled. The search now reaches across the full width of such a column.

## [0.14.2] — 2026-08-08

### Fixed
- **A run sheet that is still loading no longer claims to be empty.** Opening a rundown showed "Untitled Rundown — Empty rundown, add your first row above" while the document was still arriving, which on a phone connection (or whenever the document channel can't connect at all) looked exactly like a broken or blank sheet. It now says **"Loading the run sheet…"** while the content is on its way, and **"Connecting to the server…"** with what to check when the connection is the problem. The genuine empty-rundown message only appears once the document has actually loaded.
- **The sign-in page no longer overflows a phone screen.** Text input fields carry a built-in minimum width that beat the layout, pushing the page sideways and cutting off the heading and help text; every form field can now shrink to its container.

## [0.14.1] — 2026-08-08

### Fixed
- Double-tapping a cell to edit it works again on tablets — the zoom lock was also cancelling the tap that opens the editor. Pinch zoom is still refused; double-tap zoom is handled without touching the tap itself.

## [0.14.0] — 2026-08-08

### Fixed
- **Phones and tablets on your network now open the show.** The app reached the sync server at "localhost", which on a visiting iPad or iPhone means *that device* — so nothing connected and the status dot stayed red (on a phone the sheet never appeared at all). Each device now resolves the server against the address it loaded the page from, so opening the dashboard by network address just works, with no configuration. A configured URL still wins, and an https page keeps a secure connection.
- **Company access can create events.** A person whose account carries a company grant could manage that company's events but was refused when adding a new one — creation demanded an admin or a company *token*. Company-level access now creates events inside its own company (and only there); event-only and view grants still cannot.

### Changed
- **One button per rundown, decided by your access**: managers get **Open show** (the console), view-only access gets **View**. Edit content and the read-only view moved into the ⋯ menu, which is hidden entirely from people who can't manage the rundown.
- **Pinch and double-tap zoom are locked** on phones and tablets, so a stray gesture can't leave a crew member zoomed into a corner of the sheet mid-show. (The browser's own accessibility zoom is untouched.)

## [0.13.1] — 2026-08-08

### Changed
- **The cue pool is parked** — hidden from the show page for now (the code stays, one switch re-enables it).
- The result-rows menu speaks plainly: "Win / lose / draw rows…" with options like "Play these when we WIN" and "Play these in EXTRA TIME (golden point)".
- Row, Group, and Milestone buttons explain themselves on hover — a Row is a timed item the show steps through, a Group is a section heading the transport steps past, a Milestone pins a clock moment with no duration.

## [0.13.0] — 2026-08-08

### Added
- **Spreadsheet-style column headers**: drag a header to reorder columns — the move is written to the shared document, so every open screen, the guest view, and the PDF/CSV exports follow instantly and it survives reloads. **Click a header label to rename it in place** (replacing the old double-click prompt); Enter commits, Escape cancels. A drop indicator shows where the column will land, and the resize handles still work exactly as before.

## [0.12.3] — 2026-08-08

### Changed
- **The row-selection popup floats below the selected rows** instead of covering them.
- The popup's "Outcome" item is now **"Mark as ending…"** with an explanation inside — it tags rows as alternate endings (imports usually do this automatically); the live result is picked with the Full time buttons at the top, as before.

## [0.12.2] — 2026-08-08

### Fixed
- **PDF and CSV exports follow the sheet's column order** with its own header names, matching the on-screen grid.
- The LIVE chip wraps onto the next line on phones instead of clipping off the edge.
- Managing a rundown that no longer exists answers 404 for signed-in callers instead of 401.

### Added
- Regression tests for the newest live behaviours: walkthrough transitions in the show machine, ending-block auto-detection, and the sheet-order/column-name/outcome document round-trip (63 tests across the suites).
- The locked-server access matrix grew to **58 checks** — profile self-service gates, named join codes and revocation, and the walkthrough command gate — and passes clean.

## [0.12.1] — 2026-08-08

### Fixed
- **New events prefill today's date in YOUR timezone** — the form used the UTC date, which is yesterday every morning east of Greenwich.
- **Date fields pop their calendar immediately** on click or focus, and native calendars now render in the dark theme.

## [0.12.0] — 2026-08-07

### Changed
- **The grid now mirrors the source sheet's column order exactly** — including the structural columns. A sheet laid out `# · TIME · DURATION · ACTIVITY · LOCATION …` renders in that order on every surface (console, editor, view, guest), with the live progress bar, time editor, duration popover, and column resizing all following their columns. New imports pick this up automatically ("Update import…" upgrades existing rundowns); rundowns that predate this keep their current layout.

## [0.11.0] — 2026-08-07

### Added
- **My account page** (`/account`): see who you're signed in as and what you can access; email accounts edit their name, email, and password there. The sidebar's Credentials section now states your identity and access level on every dashboard, with a My account link.
- Creation rights follow the hierarchy end to end: admins create companies, events, and views; company sign-ins create events and views; event access creates view links only — the dashboard now hides what each tier can't do (the server always enforced it).

### Changed
- **One palette everywhere**: the dashboard and admin pages now share the show surfaces' dark theme instead of switching to light, and the favicon's mark (the little rundown with its live row and go dot) brands the sidebar and dashboard header.
- **The timing check fixes whole chains in one action**: "Change X's start … & shift below" moves every fixed time under it by the same correction — inserting a row no longer means resolving each downstream disagreement one by one.
- **The selection bar floats beside the rows it acts on** — anchored just above the first selected row and scrolling with the sheet, instead of sitting detached in the toolbar.
- README and the build spec refreshed to the current feature set (the AI-assistant deploy notes now describe the migration-at-boot behaviour verified by the Docker test).

## [0.10.0] — 2026-08-07

### Added
- **Events have a sport** (NRL first — more sports and styles later), selectable when creating an event or on its card. Sport drives the live ending flow: at full time the console offers **Win / Lose / ⚡ Golden point** (a level score goes to extra time, never straight to a draw); once golden point is playing the final pick returns as **Win / Lose / Draw**. A **Draw** tag joins the outcome set for the final drawn result.
- **Imports detect the ending blocks by themselves**: banners like "Fulltime – WIN", "Full Time (DRAW)", and "GOLDEN POINT Kick off" tag their blocks on the way in — no manual tagging for standard sheets.
- **The console reminds the caller as full time approaches**: when the live cue is within two cues of the ending blocks and no result is picked, the Full time chooser pulses. The nudge is position-based, never clock-based — stoppage time, injuries, and penalties can stretch the game freely (NRL, cricket, soccer, basketball, AFL all behave differently; position in the sheet is the one thing they share).
- **Join codes carry a name** ("Sarah — Cam 2"): set it when creating a code, see it in the panel, and every screen identifies the joiner by it. Codes can be **revoked** — they stop working everywhere immediately. (Email delivery of codes comes later.)
- **Start-time edits ripple** like duration edits: moving a time shifts every fixed time below by the same amount, one undo reverses it all.

### Fixed
- **Opening a rundown that is already live re-syncs immediately** — the current cue is centred on screen as soon as the sheet loads.
- **Editing a start time no longer nudges the sheet's layout at all** — the editor overlays the cell instead of stretching it.
- The "+ version" and "+ key times" chips are gone from the show header — version lives in the rundown name and key times in the sheet itself.

## [0.9.0] — 2026-08-07

### Added
- **Outcome branches — win / lose / golden point.** Sheets for sport carry alternate endings that share one start time; the app now understands them. Tag blocks of rows as Win, Lose, or Golden point/draw (select rows → Outcome), and a "Full time" chooser appears on the console: pick the real result when it happens and the other endings skip themselves on every screen, with the transport jumping straight to the chosen block. Golden point loops: pick it when scores are level, play the extra-time block, and the Win/Lose pick comes back at the end. Choices are undoable, work pre-show for planning (Reset restores all endings), and rows wear WIN/LOSE/GP chips in the number column.
- **Imported sheets keep their own column headers** — the structural columns now carry the sheet's names (ACTIVITY, TIME…) instead of generic Title/Start/Duration, department columns already kept theirs, and **any column can be renamed by double-clicking its header**.
- **Event artwork slots**: the Images menu is gone — each event card shows two slots; click the + or drop an image straight onto one, hover for ✕ to remove.

### Changed
- **Event location** (renamed from "Location") now picks the timezone from a proper dropdown of all 418 world zones grouped by region, still previewing the GMT offset on the event's own date.
- Event cards put the location and dates beneath the event name, and each rundown sits on a single line — open buttons and view chips visible, everything else in a ⋯ menu, with the import/create controls on one compact row. Show/Edit/View and follow/timer/prompter now explain themselves on hover.
- **The import preview shows every row** (scrollable) instead of stopping at 40, and the unparsed-cell fix-list shows every issue instead of 12.
- **The timing check highlights the exact rows involved** in the sheet while each issue is on screen, and its fixes now say precisely what they'll do ("Change “Speech” duration to 05:00", "Change “Video package” start to 9:08 AM") instead of "absorb" and "un-anchor".

### Fixed
- **follow / timer / prompter no longer sit on "reconnecting…" on locked servers** — they now authenticate with your sign-in like the console does (crew join codes unchanged).
- The speaker timer always fits the screen — wide, tall, phone, or confidence monitor.
- Development servers evict any leftover service worker so a stale cached build can never mask fresh code.

## [0.8.1] — 2026-08-07

### Changed
- The sidebar's "Main page" link is now called "Login" — that's where it goes.

## [0.8.0] — 2026-08-07

### Added
- **Pre-show walkthrough**: before the show starts, Prev/Next step a shared highlight through the sheet — every connected screen (consoles, view-only, companions) sees the same row light up and auto-scrolls to it, so the caller can talk the crew through the running order. A position chip shows where you are ("Walkthrough 4/38"); "End walkthrough" clears it everywhere; starting the show clears it automatically. Walkthrough moves never touch the as-run record.
- **Duration edits ripple through the show**: changing a duration shifts every fixed time below by the same amount — the sheet now reflects an item running long or short, exactly like re-planning on paper. One undo takes back the duration change and the whole ripple together. (The duration editor says so, so nobody is surprised.)
- **Timezone picker with the offset on the show's date**: setting an event's location now offers the full zone list (type a city) and previews the GMT offset in force there **on the event's start date** — daylight-saving transitions included. All clocks and the server's clock-follow already run on the IANA zone database, so a caller, a remote monitor, and a live cross in three countries stay in lockstep; this makes the setup human.

### Changed
- **The live row's progress sweeps the whole cell** as a translucent wash with a bright leading edge, instead of a thin strip at the bottom.
- **Sync Cue floats top-centre of the grid** when you scroll away from the live row, instead of hiding bottom-right.
- **The show page fits the screen exactly** — the run sheet is the only thing that scrolls; the outer page scrollbar is gone.
- **The timing check explains itself**: each flagged spot now spells out the arithmetic ("adding the durations, X should start at 9:08 — the printed time says 9:10") and each fix describes exactly what it will change and why you'd pick it.
- The redo button is labelled ("↻ Redo"); undo/redo were verified to cover timing edits, reordering, and deletes on the live console.

## [0.7.2] — 2026-08-07

### Changed
- **The live cue row is now unmissable**: it grows physically taller with larger bold type, carries a filled **CUE** badge in place of its row number, and its rails are brighter and thicker with a stronger fill. The row number returns on printed output, where the live styling is stripped as before.

## [0.7.1] — 2026-08-07

### Fixed
- **Column resizing keeps the table's outer edges pinned.** A drag now moves only the boundary between a column and its right-hand neighbour — width transfers between the two, the total never changes, and the horizontal scrollbar is gone. A squeezed column wraps its text onto extra lines instead of pushing the table wider. The last column has no handle (its right edge is the table edge), and "All columns" on a phone keeps its side-scroll.
- **Editing a Start time no longer widens the column.** The inline editor now fits inside the cell instead of forcing it out to the input's default width.

## [0.7.0] — 2026-08-07

### Changed
- **Column resizing is solid, not elastic.** Dragging a header edge now moves only that column — the first drag freezes every column at its current width, so neighbours stop shifting around under the pointer. Double-clicking any handle returns the whole table to its natural widths. The read-only guest view gets the same draggable columns.
- **The cue row is unmistakable**: heavy light rails above and below the live row (on top of the existing tint and edge marker) make the current position readable from across a control room.
- **Fixed start times are set by double-clicking the time — the ⚑ flag is gone.** The editor opens prefilled with the row's current time (selected, ready to overtype); clearing the box returns the row to automatic flow-on timing. Closing the editor without changing anything no longer pins the row. Double-clicking Duration opens its editor the same way, with Hide/Mute alongside.

### Fixed
- **No more red flash at cue handovers.** The progress bars held red for a moment just before a cue's end and could carry it into the next row; the red overrun state now waits a full second past zero (the big timer bridges through amber), so a cue handing over cleanly never flashes red — a genuine overrun still turns red immediately after that second.

## [0.6.2] — 2026-08-07

### Changed
- **The big item timer sits dead-centre at the top of the screen** and everything else in the top bar arranges itself around it: title, planned start/duration/end on the left; the Item/Show/Projected-End readouts, connection dots, and event clock on the right. The centring accounts for the side navigation, so the timer is on the true centreline of the screen, not just the content area. On phones the timer takes the first row (still centred) with the rest stacking beneath.

## [0.6.1] — 2026-08-07

### Fixed
- **The item progress bar snaps to the start on every row change** instead of visibly receding for a second. The browser was starting the bar's smooth-fill animation from the previous row's position — even across an element swap — so each handover began with the bar sliding backwards. Both the big-timer bar and the in-row progress bar now disable the animation for any backwards movement and only animate while filling forwards. Verified live: on a row change the fill now paints at its true position (~1.5%) on the first frame, then resumes smooth filling.
- **Commands clicked during a reconnect no longer throw** (`InvalidStateError: Still in CONNECTING state`). Transport and toggle commands issued while the show socket is still connecting are queued and sent the moment the server welcomes the connection; entries older than 15 seconds are dropped rather than fired late into a live show.

## [0.6.0] — 2026-08-07

### Changed
- **Clock-follow now runs on the server** — the live fail-safe. With Follow clock on, the show advances itself along the TIME column with **every console closed**: the server computes the scheduled row each second in the event's timezone and moves the show there, and the mode survives server restarts (it is part of the durable session). The showcaller stays in charge on the fly: edits to times, durations, skips, or order take effect within a second (the live document is read directly, ahead of its debounced save); **Pause holds the show** in place; manual jumps are corrected at the next tick while following; toggling off returns full manual control. The toggle state is shared — every open console sees "Following clock" light up.

## [0.5.0] — 2026-08-07

### Added
- **Follow clock**: the show can now run itself off the TIME column. With the toggle on, every cue goes active at exactly its scheduled moment — each handover re-syncs to the event-local clock, so drift can never accumulate across items — and when a cue's time is up the next row takes over automatically. Manual moves while following self-correct within a second; switching the toggle off restores full manual control instantly. Verified against a 2,040-cue sheet of 30-second items: the show locked onto the correct cue for the current time and stepped through boundaries to the second, unattended.

## [0.4.0] — 2026-08-07

### Added — 2026-08-07 (show chrome overhaul · one-click re-import · multi-role · undo · clock sync)
- **Everything the caller needs stays on screen while scrolling**: the title, planned/item/show/projected-end readouts, the transport, and the column headers are all pinned — the run sheet scrolls beneath them. (The column headers were meant to pin all along; a styling rule had silently broken it.)
- **The big item timer is embedded in the top bar** instead of floating over it — it no longer covers the planned time or anything else.
- **Update import re-reads the sheet by itself**: imports now store the original file, so "Update import…" loads it, re-processes it with the current pipeline, and shows the refreshed preview in one click — no re-dropping. A newly dropped file replaces the stored one.
- **Row numbers mirror the imported sheet** — each row shows the sheet's own number, and rows the sheet didn't number stay blank. Manual rundowns keep sequential numbering.
- **Undo/redo for row edits** (toolbar buttons and ⌘Z/⇧⌘Z): delete rows live or during prep, then take it back.
- **Multiple roles per user**: the role picker is now multi-select — every matching row highlights in the colour of the role it involves, and the bottom bar tracks the next item across all your roles. The picker opens as a true overlay with zero layout shift.
- **Clock sync with the TIME column**: an amber "now line" marks where the event-local clock sits in the rundown, and while the show runs a **Sync to clock** button jumps the live position straight there. The top-right clock keeps showing event-location time.
- **Unparseable-cell fixes show their context**: each issue says which timed row it follows and expands to a five-row excerpt of the sheet.
- Browsers that crash on stale chunks after a redeploy now recover with one automatic reload, and the offline shell refreshes itself — the two production errors in the log came from exactly this.

### Added — 2026-08-06 (faithful times for sub-cues · Update import)
- **Rows the source sheet leaves untimed no longer get invented times.** Cue-sheet-style documents time only their parent rows; the sub-cues beneath (reads, graphics, tracks) have blank TIME cells — but the grid used to fill them with cascade guesses whose durations drifted past the next real time. Imports of sparse-timed sheets now mark those rows **untimed**: they show "—" exactly like the source (double-click still sets a real time), and their durations remain visible but excluded from the running order. A real 450-row cue sheet now imports with its 85 sheet times anchored and every sub-cue blank, matching the printed sheet.
- **Update import**: every rundown on the dashboard has an **Update import…** action — drop the run sheet again and the re-imported content **replaces the same rundown** (links, join codes, and view links keep working; the old content is snapshotted as "Before update" and every open screen refreshes to the new content). This is the upgrade path for rundowns imported before the latest pipeline improvements.
- Durations written as sums ("40mins + 3mins") now parse.

### Fixed — 2026-08-06 (Docker packaging hygiene)
- `docker-compose.yml` now passes `ADMIN_TOKEN` / `ALLOW_DEV_JOIN` through from the environment, so locking a Docker deployment is a one-liner instead of editing the file. `.dockerignore` excludes local databases, database backups, and every local-only working folder from the build context.

### Added — 2026-08-06 (installable app: PNG icons + service worker)
- **OpenCall now installs properly as an app.** PNG icons at every size platforms expect — an apple-touch icon for iOS home screens (iOS ignores SVG manifests), 192/512 manifest icons, and a padded maskable variant for Android launchers — plus a conservative service worker: navigations fall back to a cached shell when offline and hashed build assets are cached, while live show data (WebSockets, API) is never intercepted, so crew can never see stale show state. Also fixed the manifest still calling the app by its old short name.

### Changed — 2026-08-06 (generated database migrations)
- **Schema changes are now generated drizzle-kit migrations** (`packages/db/drizzle/`), applied automatically at boot and tracked in a `schema_migrations` journal — a fresh database builds itself from the baseline, an up-to-date one is a no-op, and databases created before this scheme are baselined in place (after a one-time idempotent catch-up) without touching data. Operators still never run a migration command. Developers: edit `src/schema.ts`, run `pnpm --filter @opencall/db generate`, commit the SQL.

### Added — 2026-08-06 (in-place snapshot restore)
- **Restore here**: a version in the History panel can now replace the current rundown's content directly (armed two-click, next to the existing "Restore as copy"). The server saves an automatic **"Before restore"** snapshot first, so a restore is itself reversible. Under the hood every document connection is scoped to a per-rundown **doc epoch**; restoring bumps the epoch and disconnects every open screen, which reconnect fresh and show the restored content within seconds — pre-restore edits can never merge back in, and a stale client's pending save can never overwrite the restored document.

### Added — 2026-08-06 (import fix-it list · planned timing from the sheet · row-number resize)
- **Unparseable import cells get a fix-it list.** Instead of only flagging "N cells couldn't be parsed", the preview now lists each failed START/DURATION cell with the row, the offending text, and an **auto-suggested repair** (wrong separators like "19h30", durations buried in prose like "approx 5 mins TBC", bare numbers treated as minutes). Fix each one in place — Apply (validated live), Clear (import empty), or Keep as is.
- **Imported rundowns take their planned start from the sheet's own first time** instead of defaulting to 9:00 AM. The planned start in the rundown header is now **click-to-edit**, and when the final item has no duration the header shows an **approximate end (≈) assuming 30 minutes** — unless that item is itself the ending (Full time, End…), which stays exact.
- **The row-number column is resizable** like every other column.

### Fixed — 2026-08-06 (cell formatting now visible outside the editor)
- **Bold, italic, underline, strikethrough, and highlight applied in a cell now actually show in the grid** — formatting was stored but stripped by the plain-text projection the moment the editor closed. Formatted cells render their marks (through a strict allowlist — nothing document-authored can inject markup); plain cells keep their role colour-coding. Multi-paragraph cells also keep their line breaks in the grid and CSV export now.

### Added — 2026-08-06 (PDF export)
- **Export PDF** in the rundown's Output menu downloads a real PDF file — A4 landscape with a repeating table header, the rundown name/version/planned times and key times atop every page, page-numbered footers, anchored times marked with `*`, group rows as full-width dark bands, row highlight colours preserved, skipped rows greyed, and column widths matching the on-screen layout (including personal resizes). Generated entirely in the browser; the print dialog remains available as "Print".

### Added — 2026-08-06 (PDF row boundaries from the table's ruled lines · admin sub-pages)
- **PDF imports now read the table's actual ruled lines** from the document's drawing layer and use them as authoritative row boundaries. This fixes the last merge imperfections: bottom lines of tall rows no longer bleed into the next short row, ruled sub-rows inside one item (per-line WHO/WHAT rules) join their item, and **unnumbered section banners survive as their own section rows** instead of being absorbed — a real sheet recovered four match-phase banners that earlier imports swallowed. Pages without detectable rules fall back to the previous nearest-item heuristic.
- **Users & access and the Error log now live on their own pages** (`/admin/users`, `/admin/errors`), linked from the sidebar, instead of stacking on top of the events dashboard.

### Added — 2026-08-06 (accounts: password sign-in & sessions · one-click view links)
- **Real sign-in**: users now log in with **email + password** on the landing page or the admin gate. Passwords are scrypt-hashed; logins issue revocable 30-day sessions that work everywhere the old tokens did (API, show channel, document channel) with the same grant enforcement. Sign out revokes the session server-side; changing a password (or an admin resetting one) signs out every other device. Admins set an optional password at user creation, see who has one, and can reset it; personal access tokens remain as a backup credential. Login attempts are rate-limited.
- **One-click view-only links**: a **Copy view link** button on every rundown (dashboard and Join codes panel) copies a URL that opens the rundown read-only — hand it to camera operators and crew; no account needed, revocable via join codes.
- The access-control matrix grew to **50 checks**, now covering the full session lifecycle (login, scoping, revocation on reset/change/logout) and the view-link path (public code resolve, read-only doc enforcement).

### Changed — 2026-08-06 (self-hosting guide for humans and AI assistants)
- **The README now carries a complete self-hosting guide**: architecture and port table, full environment-variable reference (build-time vs runtime), three deployment paths (Docker Compose on a VPS, any PaaS, bare Node), first-run setup, and copy-paste verification checks — plus a **"Deploying with an AI assistant" section** with a ready-to-paste prompt so tools like Claude or ChatGPT can spin up an instance end-to-end from the README alone.
- `docs/DEPLOYMENT.md` security status brought up to date: the deployment is locked (admin token gates the API and both websocket channels; the credential hierarchy and the 33-check access matrix are documented). The previous "not yet authenticated" warning was stale.

### Added — 2026-08-06 (locked-server access audit · mobile dashboard)
- **Access-control test matrix**: a committed script exercises 33 checks against a locked server — per-credential event scoping in the API, caller/follower roles on the show channel, and read-only doc enforcement for view grants (a viewer's write is rejected server-side while a manager's propagates). All 33 pass.
- **The dashboard now works properly on phones**: each company, event, and rundown collapses its action buttons into a single ⋯ menu (rename, dates, location, images, archive, duplicate, tokens, delete — with the same two-tap confirmation for destructive actions). Show/Edit/View and the companion-screen links stay one tap away; desktop is unchanged.

### Added — 2026-08-05 (wrapped-row merge · role column · error log · mobile simplification)
- **Resizable columns**: drag the right edge of any column header in the rundown grid to set its width — per person, per rundown, remembered by the browser; double-click the handle to restore the natural (or imported) width.
- **PDF imports now produce one row per sheet item.** PDF text extraction yields one grid line per visual line, so items with wrapped cells arrived as several mostly-empty rows. The importer now recognises the sheet's item-number column and merges every continuation line into its item — using each line's vertical position to attach it to the nearer numbered row (cells are vertically centred, so a wrapped cell's top lines sit *above* the item number). A 15-page real sheet went from 388 fragmented rows to 78 rows mirroring the source exactly, every one anchored to its printed time.
- **The sheet's own role column drives role features.** A column headed WHO, ROLE, RESPONSIBLE, CREW (labels vary per production house) is recognised on import: roles are mined from it alone (composite cells like "VTR | LED" split into their parts), no duplicate "Roles" column is synthesized, and the rundown remembers which column holds assignments — so "My role" highlighting and the on-air bar match against actual assignments, never prose mentions in notes columns.
- **Server-kept error log.** Everything that breaks is journaled server-side: API failures, process-level crashes, and **every visitor's browser errors** (uncaught exceptions, promise rejections, failed API calls are reported automatically). Admins review entries — time, origin, message, stack — and clear the journal from a new **Error log** panel.
- **Users & access and Error log now live in the left settings sidebar**, visible to admins only.
- **Access tokens work on the landing page.** Pasting a personal, company, or admin token into the join box signs you in and opens the dashboard — previously the field treated tokens as join codes (and uppercased them, corrupting them).
- **Phones show a simplified run sheet**: title, start, duration, and the role column only, with an **All columns** button to bring the full sheet back (side-scrolling inside the grid). Secondary header chrome is hidden on small screens.

### Fixed — 2026-08-05
- **Department columns render again in the run-sheet grid.** A regression left every imported column (WHO, WHAT, notes…) header-only — the cell contents were stored but never drawn.

### Added — 2026-08-05 (user database, timing reconciliation, live skip, roles column, mobile)
- **User database with per-user access**: admins create users from the dashboard, each with a personal access token and precise grants — full admin, an entire event company, a single event, or **view-only** access to an event. Grants govern the dashboard (users see only their events), the API, the show channel (managers call, viewers follow), and the document channel (view grants are read-only). Tokens are copyable and rotatable; users sign in by pasting their token on the access page.
- **Timing reconciliation wizard**: when a sheet imports with TIME and DURATION columns that don't add up, a "⚠ N timing gaps — Reconcile" chip appears. It walks the showcaller through each disagreement one at a time — absorb the gap into the preceding duration, un-anchor the disagreeing time, or mark the gap intentional (a genuine hold).
- **Skip items live**: select rows and hit **Skip** while the show runs behind — the row stays visible (struck through) but leaves the timing cascade and the transport steps over it, so the show catches back up to the original anchored times. Un-skip the same way.
- **Roles column auto-populated on import**: every detected role that appears in a row lands in a "Roles" column (items can carry several), colour-coded like everywhere else.
- **Import band-drift rescue extended to times and durations** with joint proximity-scored assignment (times and durations can masquerade as each other — "0:15:00" parses as a time — so the two targets are resolved together, never crossed). A 15-page real production sheet now imports with 75 correctly anchored rows.
- **Mobile pass**: the run sheet scrolls horizontally inside its own container, toolbars wrap, the big timer and role bar scale down, and the side panel never auto-opens over content on small screens. Picking a role no longer shifts the toolbar layout.

### Added — 2026-08-05 (role detection on import · counter bar · Sync Cue)
- **Importing a run sheet now detects the assigned roles automatically** (PA, VTR, GFX, DJ, LED, locations, brand loops — any short value that repeats across cells, excluding times and durations) and **assigns each a distinct colour**. The roles are stored on the rundown: every mention is colour-coded in the grid, the "My role" picker offers them one-click with their colours, and the personal row highlight and bottom bar adopt your role's colour. Detected roles are shown as coloured chips in the import preview.
- **A counter bar now fills left-to-right under the big centre-top timer**, showing approximately how much of the active item has elapsed (amber in the final stretch, red on overrun).
- **Scrolling is never hijacked during a live show**: scrolling the sheet by hand disengages auto-follow instead of fighting you, and a floating **"Sync Cue"** button appears — one press jumps back to the live cue and follows along again.

### Added — 2026-08-05 (my role: personal highlight & next-item bar)
- **Every user can mark their assigned role** — BGM, Camera 1, PA, a presenter's name, anything the sheet says — regardless of their access level (admin, edit, or view-only). A "My role" picker in the toolbar suggests roles mined from the sheet itself; the choice is remembered per browser.
- **Your items highlight in teal** across the rundown the moment a role is picked.
- **A bottom bar appears while the show runs**: it names your next item and counts down to its start (planned time shifted by the live drift, amber inside the final minute). When your item goes live the bar grows into a **full-width ON-AIR banner** — "YOU'RE ON" with the item's remaining time — and when your item finishes it moves on to the next one, ending with "no more items for you" after your last cue.

### Added — 2026-08-05 (event images, company logos, big live timer)
- **Images on events**: add one image — or two for sporting fixtures (home and away team) — from the event card's Images menu; they display beside the event name. **Event companies get a logo** shown on their band. Images are picked from disk, downscaled client-side, and stored inline (no external storage needed yet).
- **A big, unmissable timer sits centre-top of every rundown screen while the show runs**: the active item countdown in large tabular figures — green on time, amber in the final stretch, red counting up on overrun, dimmed amber while paused — with the active item's name above it.

### Fixed — 2026-08-05 (import header detection & centered-header titles)
- **Header-row detection scans much deeper** (30 rows) — sheets with multi-line title blocks above the real header no longer import with the page title as column names — and the preview gains a **Header row** override so any sheet can be rescued manually.
- **Centered headers no longer orphan the title column**: when a PDF's header text sits in a different layout band than the left-aligned data below it, the data-rich neighbouring band is mapped into Title as well — a real 6-page sheet went from 37 to 411 titled rows.
- Fixed an SSR crash on the dashboard under Node's experimental localStorage, and a hydration warning from locale date formatting in the print footer. The create-rundown template picker now reads "Start blank" and hides entirely until templates exist.

### Changed — 2026-08-05 (import: full column fidelity; company rename)
- **Imported rundowns now mirror the source sheet's columns exactly**: identical names (verbatim header text, original casing), no duplicates (repeated headers get a numbered suffix), the same left-to-right order, and **proportional column widths** taken from the spreadsheet's column sizes or the PDF's layout. Built-in department columns are no longer added on import — **a column with no data simply doesn't exist** in the imported rundown.
- **Event companies can be renamed** from their band header on the dashboard.

### Fixed — 2026-08-05 (import: columns now mirror the source sheet)
- **Importing a run sheet now auto-creates columns matching the sheet's own format.** Previously, headers like TRACK, BIG SCREEN, SIDE PANEL, LED, and NOTES were folded into the nearest built-in column, and columns with a **blank header** (the cue-type column on many presentation grids) were dropped entirely — losing most of a dense sheet's content. Now every non-structural column imports as itself; untitled columns are recognized by their data (a column of VTR/PA/GFX tokens becomes **Type** — which also activates the cue-type quick chips — anything else becomes "Column N"), and mirrored row-number columns are skipped as noise.
- Milestone rows keep their department cells on import, and their banner title falls back to the first cell value when PDF extraction lands the title in a neighboring column band — pre-show schedule rows (arrivals, meetings, rehearsals) now import with their real names instead of "—".
- Verified against a 12-page real production PDF: 517 rows with every source column (Type, LOCATION, TRACK, BIG SCREEN, SIDE PANEL, LED, NOTES) present and populated, versus most of that content missing before.

### Added — 2026-08-05 (dashboard: companies own their events; drag-and-drop import)
- **Events now appear underneath their event company** on the dashboard: each company is a band with its event count, showcaller-token actions, and its own "+ New event" (events created there belong to that company). A company credential sees exactly one band — its own.
- **Companies can be deleted** (armed two-click confirm) — deletion cascades through the company's events, rundowns, sessions, tokens, snapshots, templates, and memberships.
- **The import box accepts drag-and-drop**: drop an XLSX/XLS/CSV/PDF straight onto it (highlights while dragging) — clicking to browse still works.

### Added — 2026-08-05 (event date editing & ordering rule)
- **Event dates are now editable** from the dashboard (a "Dates…" inline editor on each event card) — previously they were fixed at creation.
- **The end date can never precede the start date**, enforced in three layers: the date pickers themselves (the end input's minimum follows the start, and moving the start forward bumps the end along), the form guard, and the API — which validates the *merged* result on both create and edit, so moving just one side past the other is rejected with a clear error.

### Added — 2026-08-05 (left settings panel & navigation)
- **A persistent left panel on the dashboard and every rundown screen** holds navigation (main page, dashboard) and all the settings features for the current screen — Views (Follow/Timer/Prompter), Output (Print/PDF, CSV export), and Show settings (template, guest pass, history, join codes) on rundown screens; archived toggle and credentials on the dashboard. Collapsible, state remembered per browser, hidden in print. The old ⋯ overflow menu is gone — settings now have a home. Everything in the panel respects the access hierarchy: a company credential sees only its own data; only admin sees all.

### Added — 2026-08-05 (event-timezone time model)
- **The event's location now governs every clock.** Each event carries an IANA timezone; the show channel hands it to every connected surface, and header clocks, live drift, and projected-end all compute in the **event's wall clock** (a viewer in another country sees the venue's time, labeled with the zone — "Event time · EDT"). Daylight saving is applied per-instant from the IANA database, so shows that cross a DST change stay correct — covered by unit tests on both a US and an Australian spring-forward boundary.
- **The primary time can only change when the location changes**: the API rejects a timezone change without an accompanying location change, and the dashboard pairs the two in one "Location…" action. New events pick up the creator's timezone automatically.

### Added — 2026-08-05 (access hierarchy: event companies & archive)
- **Three-tier access**: **Admin** (top level, sees and changes everything) → **Event company** (showcaller credentials: change event details and everything below, strictly scoped to the company's own events) → **Editor** (assigned per rundown via join code: changes rundown content, never events). Admin creates companies from the dashboard and hands out per-company showcaller tokens (rotatable); company tokens also drive the show and document channels as caller-level within their own company only. Verified against a locked server: a company sees only its own events, cannot touch another company's event (401), and cannot list companies (401); admin sees all.
- **Archive** for events and rundowns (in addition to delete): archive/unarchive from the dashboard, archived items hidden by default with a "Show archived" toggle, shown dimmed with an archived chip.
- The dashboard header now reflects who you are — "admin" or your company name — and `GET /me` drives visibility.

### Added — 2026-08-05 (milestone 2 · phase 5: live polish & print)
- **The active row is unmistakable on every surface while the timer runs**: accent bar + tinted row, an inline **progress bar that drains in real time** under the active title and turns the over-color on overrun, a subtle tint + soft bar on the **next** cue, and a dimmed amber state while **paused**. Auto-scroll keeps the active row centered as the show advances, with a **Follow** toggle so a user reading elsewhere is never yanked — verified live in-browser (bar draining at the correct rate, next-up tint, paused dim).
- **Formatted print/PDF export straight from the browser** on Showcaller/Edit/View (⋯ → Print): landscape A4 with a title block (name · version label · planned/duration/end · key-times table), column headers repeated on every page, group/milestone banners and row colors preserved, screen chrome stripped, and a generated-stamp footer. The Columns menu acts as the per-user print preset — hidden columns stay hidden in print.

### Added — 2026-08-05 (milestone 2 · phase 4: rundown fidelity)
- **Milestone rows**: a first-class row type for timed markers with no duration (doors, kick-off, "team list due") rendered as a full-width amber banner; excluded from duration math; produced by the importer and the new **+ Milestone** button.
- **Row highlight colors**: multi-select rows and pick from a curated palette (or clear) in the selection bar; colors follow the row onto every surface including the guest view.
- **Key times**: labeled times for the day (doors, soundcheck, on-air…) editable from a header chip, stored in the document, shown on Showcaller/Edit/View headers and the guest page — the real-world "KEY TIMES" table.
- **ZERO countdown column**: optional per-user column showing T-minus to the next anchored time — the printed countdown convention from live sport cue sheets.
- **Version label**: a free-text chip on the rundown header ("V2", "FINAL") stored in the document and shown to guests; ready for print title blocks.
- **Cue-type quick chips**: columns titled "Type" get a one-click vocabulary (AUDIO, GFX, VTR, LED, PA, MC, PYRO…) above the cell editor — still free text underneath.
- **Untimed cue pool**: a section below the rundown for cues that live outside the timeline (stings, chants, filler). During a live show the caller **fires** a pool cue and it logs into the as-run report with a timestamp — verified end-to-end (`fire` → `pool:Goal Sting` row in the report CSV) — without moving the active row. Guest views hide it; the protocol gained an additive `fire` action.
- Guest projection now respects **Hide** on durations (hidden durations never leave the server).

### Added — 2026-08-05 (milestone 2 · phase 3: run-sheet import)
- **Upload an existing run sheet — XLSX, XLS, CSV, or PDF — from the admin dashboard** ("Import run sheet…" per event). Extraction is fully client-side: spreadsheets read as displayed text; PDFs go through text-run clustering (lines by Y, column bands by X, repeated page headers dropped) with a clear error for scanned files that have no text layer.
- **Mapping preview before anything is created**: auto-detected header row and column mapping (title/start/duration/departments, with synonym matching — VTR→Video, LX→Lights, WHO/WHAT→Production Notes…), retargetable per column, unknown headers become new custom columns; rows classified as cue / **milestone** (time, no duration) / **section** (title-only banner) / spacer; unparseable cells highlighted in red and imported empty rather than silently dropped.
- **Tolerant parsing in core** (30 unit tests, fixtures modeled on three real production house styles): durations like "3 mins", "1min 27 secs", "0:90:00" (90-minute spreadsheet leak), "08:00"; times like "5:00:00PM", "16:00:00", "4:30pm", "0900". Verified end-to-end in-browser: a synthetic spreadsheet imports with anchors, milestone rows, cascade and department cells intact; a real 8-page production PDF extracts 450+ rows with start/duration/title auto-mapped and 21 unparseable cells flagged.

### Added — 2026-08-05 (milestone 2 · phase 2: role screens & gated access)
- **Four ways into the app, each a real screen**: `/admin` (cross-show control room: every event and rundown, create/rename/delete/duplicate, live-now badges, one-click jump into any screen), `/show/[id]` (full showcaller console), `/edit/[id]` (content editing, **no transport and no share/admin panels**), `/view/[id]` (read-only grid with live position, personal column visibility, print). The old `/rundown/[id]` URL redirects to `/show`.
- **Landing page**: crew enter a join code and are routed to the screen their role allows — caller → Showcaller, editor → Edit, follower → View — with the code carried in the URL and reused by every panel and channel.
- **Server-enforced access (interim tokens, accounts still to come)**: a new `admin` role is granted only by the server's `ADMIN_TOKEN`. When that variable is set the deployment is locked: the management API requires the admin token (cross-show) or a caller/editor join code (rundown-scoped); the collaborative document channel authenticates every connection and gives follower codes a **read-only** document; dev session tokens are rejected. Unset, the server stays dev-open. Verified against a locked instance: 7/7 HTTP checks and 4/4 show-channel checks (dev token rejected, admin welcomed, follower's transport command refused, bad code closed).
- Admin endpoints: rename/delete events and rundowns (delete cascades sessions, tokens, snapshots), duplicate rundown, `GET /live` (which shows are running), `GET /codes/:code` (landing-page routing). Join-code panel now issues editor codes too and copies role-appropriate URLs.

### Changed — 2026-08-05 (rename: OpenCall)
- The project is now **OpenCall**: repo `robertcmorton/opencall`, packages `@opencall/*`, app title and PWA metadata, Docker/compose service names, hosting service names and domains (`opencall-web-production` / `opencall-sync-production` on Railway), and all docs. No functional changes; existing data is unaffected.

### Changed — 2026-08-05 (milestone 2 · phase 1: design system & UI modernization)
- **New design system** (`globals.css`): color/spacing/radius/elevation/motion tokens with semantic roles; dark theme as the primary show-surface theme and a light theme for the dashboard; Inter for UI text and JetBrains Mono with tabular figures for every timing readout (no width jitter while ticking); one shared component set (buttons, panels, menus, chips, inputs, badges, empty states, skeletons); 130–190 ms eased motion with `prefers-reduced-motion` respected; pulsing LIVE badge.
- **Editor modernized and long-parked parity features landed**: floating formatting toolbar on the active cell (bold/italic/underline/strike/highlight/link/clear); duration popover with **Hide** and **Mute** (mute verified: excluded from cascade math with struck-through display); **multi-select** rows (shift/⌘-click) with a selection bar — duplicate (deep-copies cell content), group toggle, delete; per-user **Columns** show/hide menu persisted locally; ticking time-of-day clock in the header; **⋯ menu** collecting views, export, template, and share panels; connection status dots; sticky column headers; group rows restyled as section bars.
- **Transport bar**: proper icon buttons, primary Next, and Stop now uses an in-app two-click armed confirm instead of a browser dialog.
- **Dashboard restyled** (light theme): event cards, chip links to companion views, labeled create forms, loading skeletons, empty states. Companion and guest surfaces moved onto the token system.
- All flows re-verified in-browser after the restyle: live start/advance/stop, join-code panel, column hiding persisted across navigation, formatting round-trip, duplicate/delete.

### Added — 2026-08-04 (spec: milestone 2 build prompt)
- **`BUILD_PROMPT_2.md`** — the next build milestone, specified end to end in five phases: (1) design-system foundation and full UI modernization (tokens, dark show-surface theme, tabular-figure timing type, component set, motion) folding in the parked visual-parity items; (2) role-based screens with server-enforced access — **Admin** (cross-show control room), **Showcaller** (full console), **Edit** (content-only), **View** (read-only) — plus interim token gating of the doc channel and management API; (3) the run-sheet import pipeline (XLSX/XLS/CSV/PDF upload → extract → detect → column-mapping preview) with tolerant parsers and synthetic fixtures; (4) rundown fidelity features from real-world sheets — milestone/banner rows, row colors, cue-type chips, key times, countdown-to-anchor column, version label, untimed cue pool; (5) live polish — unmistakable active-row highlighting with progress bar on every surface while the timer runs, and formatted print/PDF export with repeated headers and title block.

### Changed — 2026-08-04 (spec: real-world run sheet import)
- The import requirement in `BUILD_PROMPT.md` now covers **uploading existing run sheets as XLSX, XLS, CSV, or PDF** through a single extract → map-columns → preview pipeline, with tolerant parsing of real-world data (free-text durations, mixed time formats, milestone rows, section banners, stacked multi-cue cells, per-page repeated headers). Informed by analysis of real produced run sheets kept as local-only reference material; the print/PDF export spec gained key-times table, repeated per-page headers, and footers to match.

### Changed — 2026-08-04 (single-platform hosting)
- **Everything now runs on Railway in one project**: the web app moved from Vercel to a Railway service at `opencall-production.up.railway.app` (domain targets port 3000), alongside the existing sync server and PostgreSQL. The Vercel project was deleted. One platform, one dashboard, services reference each other's variables directly. `docs/DEPLOYMENT.md` rewritten for the consolidated topology.
- Verified post-move: the Railway-hosted web app serves the same database (existing event and rundown render), the editor connects on both realtime channels over `wss://`, and the in-progress show session carried across untouched.

### Added — 2026-08-04 (production deployment)
- **The app is live**: web at `opencall-web.vercel.app` (Vercel, auto-deploys from `main`, root directory `apps/web`) and the sync server + PostgreSQL on Railway at `opencallsync-production.up.railway.app`. Verified end to end in production: event and rundown created through the live UI, editor connected on both realtime channels over `wss://`.
- **Single public port**: the sync server now serves the HTTP API, the show channel (ws `/`), and document sync (ws `/doc`) from one listener with path-routed upgrades; `PORT` is honored for PaaS hosts. Port 8788 is retired everywhere (dev, Docker, env examples).
- Fresh databases self-initialize on server boot (idempotent DDL), so a new deployment needs no manual migration step.
- ⚠️ Known gap, tracked as the top hardening item: the management API and document channel are not yet authenticated — the deployment is suitable for demo use until API gating lands.

### Added — 2026-08-04 (hardening: durable sessions, join codes, as-run report)
- **Show sessions are now durable**: every transport command writes through to the database (session state plus a transition log), and a restarted sync server hydrates any live session back — a show in progress survives a server crash, verified by killing and restarting the server mid-show.
- **Real join codes**: generate role-scoped six-character codes (no confusable characters) per rundown from the editor's Join Codes panel; companion URLs carry `?code=`; the show channel validates codes and guest tokens against the database and rejects invalid credentials. A development fallback code remains available and can be disabled by environment variable.
- **As-run show report**: the full transition history (which rows ran, when, per session) downloads as CSV from the History panel — rehearsal timing analysis and proof-of-run in one export.

### Changed — 2026-08-04
- Session establishment on the show channel is now asynchronous (database-backed credential checks) with unchanged wire behavior.

### Added — 2026-08-04 (Phase 7: guest pass, version history, packaging)
- **Guest pass**: create read-only share links with per-column visibility from the editor. The server sends guests a filtered projection — hidden columns are absent from the payload, and the collaborative document never reaches guest browsers. The guest page shows a last-updated stamp, refreshes to the latest version, and prints.
- **Version history**: save labeled versions from the editor, automatic snapshot the moment a show starts, and restore any version as a new copy. (In-place restore of a live collaborative document is deliberately deferred until a document-epoch mechanism lands; the API comment documents why.)
- **Self-host packaging**: Dockerfiles for the web and sync services, a compose file with Postgres, healthchecks, and a one-shot seed job, plus a README quickstart. Build-time public URL arguments documented for real deployments.
- Verified in-browser: created a guest link with Script and Production Notes hidden and confirmed at the payload level that they never leave the server; saved and restored a version as a copy; confirmed the automatic show-start snapshot.
- With this, all seven phases of the build plan are implemented; remaining work is the documented hardening list (accounts and API auth, join codes, session persistence, protocol unification).

### Added — 2026-08-04 (Phase 6: events, templates, CSV)
- **Events dashboard**: the landing page now lists events with their rundowns, creates events (name, location, dates), and creates rundowns per event — blank, from a saved template, or by pasting CSV.
- **Templates**: save any rundown as a reusable template from the editor; new rundowns created from a template carry its full content.
- **CSV import/export**: paste-CSV import maps Title/Duration/Start/Type plus department columns by header name (Start values become timing anchors; `Type=group` creates section headers); one-click CSV export from the editor with computed start times. CSV parser/serializer lives in core with unit tests.
- **JSON management API** on the sync server for events, rundowns, and templates (development-open; authentication arrives with the accounts hardening pass).
- Verified in-browser end to end: created an event, pasted a four-row CSV that rendered with a 7:00 PM anchor and correct cascade, exported it back to CSV, saved it as a template, and created a second rundown from that template.

### Added — 2026-08-04 (Phase 5: speaker timer + prompter)
- **Speaker Timer** at `/timer/[id]`: fullscreen countdown for the active cue — green on time, amber inside the final stretch, red counting up on overrun, greyed while reconnecting; double-click for fullscreen; wake lock. Built for confidence monitors and speakers' phones.
- **Prompter** at `/prompter/[id]`: script-column view with a fixed read-position caret, follow-the-caller (smooth-jumps to the active cue as the show advances), auto-scroll with adjustable speed (Space to toggle, arrows for speed), font-size controls, mirror mode, and a word-count/read-time bar.
- PWA install metadata (web manifest + app icon) so companion surfaces can be added to home screens; shared document-connection and wake-lock hooks across all surfaces; per-rundown view links on the landing page and in the editor header.
- Verified in-browser: timer counted down the live cue in the bordered display; the prompter opened on the active cue and smooth-scrolled to the next one when the console advanced the show.

### Added — 2026-08-04 (Phases 3–4: live mode + broadcast)
- **Live timing math in core** (`computeLiveTiming`): pause-aware elapsed/remaining in the active row, per-row overrun, cumulative show drift (actual vs. planned start plus current overrun), and projected end time — all computed locally from timestamps and the measured clock offset, per the protocol's no-streamed-ticks rule; unit-tested with a pluggable timezone mapping.
- **Show-channel client** for the web app: session establishment, median-of-five clock-offset sampling, sequence-guarded state updates, jittered reconnect backoff, and idempotent command ids.
- **Console live mode**: caller transport bar (Start / Pause / Resume / Prev / Next / Stop-with-confirm) with Space and Shift+Space shortcuts suppressed while typing; LIVE/PAUSED badge; active-row highlight; header readouts for item countdown (green, red count-up on overrun), cumulative show drift, and projected end.
- **Companion follower surface** at `/follow/[id]`: glanceable current cue with giant countdown, script card, next-cue strip, drift/projected-end line, and a screen wake lock — follows the caller's position live.
- Verified end to end in a real browser: console started the show, a phone-width follower ticked the countdown locally, advancing on the console moved the follower instantly, and stop returned both to idle.

### Fixed — 2026-08-04
- Render loop in the live-timing hook (effect depended on per-render objects); inputs now flow through refs with a mount-once interval.

### Added — 2026-08-04 (Phase 2 editor core)
- **Collaborative rundown editor** ([apps/web](apps/web)): spreadsheet-style grid over the Yjs document — TipTap rich-text cells (mounted per active cell, bound to each cell's shared fragment), inline Start/Duration editing with shorthand parsing, visible anchor flags with one-click reset-to-auto, drag-and-drop row reordering (dnd-kit), group-header rows with toggle, add/delete rows, add columns, row selection, and a live planned start/duration/end header driven by the timing engine. Landing page lists rundowns from the sync server's read API.
- **Document sync with persistence** ([apps/sync](apps/sync)): Hocuspocus server backed by the database — documents load from the rundown's stored state and debounce-write back on change; minimal HTTP read API for rundown listings. (Doc channel runs on its own port for now; folding onto the single-socket protocol is tracked for Phase 4.)
- Wall-clock time parsing in core (`parseTimeOfDay`), rundown metadata (name, planned start) carried inside the document, and a unified dev database location shared by seed and sync.
- Verified end to end in a real browser: seeded grid renders; a duration edit recascaded every subsequent start time and the header totals; the same edit propagated live to a second browser tab; and after stopping the servers the edit was read back from the database intact.

### Added — 2026-08-04 (Phase 1 scaffold)
- Monorepo scaffold (pnpm + Turborepo, strict TypeScript): `packages/core`, `packages/protocol`, `packages/db`, `apps/web`, `apps/sync`, plus root Docker Compose (Postgres) and `.env.example`.
- **Timing engine** (`packages/core`): cascade with anchor flags (last-anchor-wins), back-timing, muted/hidden durations, duration-shorthand parsing, time formatting — pure functions, unit-tested.
- **Protocol package** (`packages/protocol`): Zod schemas for every PROTOCOL.md message, close codes, and a safe client-frame parser, with schema tests.
- **Database package** (`packages/db`): full Drizzle schema per the data model, bootstrap DDL, Postgres/embedded-PGlite dual driver, Yjs rundown-document builder/projector with reconciliation rules, and a seed script that round-trips the demo rundown through the database and prints its computed timing.
- **Sync server** (`apps/sync`): WebSocket server implementing session establishment, roles, clock-sync ping/pong, idempotent caller transport commands over an authoritative show-state machine (monotonic `seq`), presence, and heartbeats — verified by a two-client smoke test (caller + follower receive identical state sequences; follower commands rejected).
- **Web app** (`apps/web`): minimal Next.js shell rendering the demo rundown through the shared timing engine; grid editor arrives in Phase 2.
- 18 unit tests across four workspaces; `pnpm build`, `pnpm test`, and `pnpm seed` all green.

### Added — 2026-08-04 (video research, second pass)
- Transcribed and analyzed ten training videos (two webinar series, a basics webinar, and six short feature clips) covering the reference rundown product in depth. Spec updated with the resulting v1 features: visible manual-override anchor flags with reset-to-auto and last-anchor-wins cascade semantics; back-timing (calculate-upward rows); a segment-budget countdown column; duration shorthand entry; advance-and-retime transport shortcut; jump-to-row while live; as-run timestamp column with repeat counts, notes, and show-report export; per-row over/under offset trail with running total, projected end, and rehearsal reset; multiple simultaneous callers with per-follower caller picker and passive follow mode; fullscreen item timer; Featured and Display companion views (caller-controlled column); remote-controlled prompter links; per-cell content restore; export presets with branding and page breaks; event-scope guest landing pages; event file storage with export-live file links; templates that carry default crew.

### Added — 2026-08-04 (video research)
- Fourth research pass: full transcript of a 2016 walkthrough video of the first-generation web rundown product our reference platform grew from (recorded in local research notes). Spec updated with newly confirmed v1 features: per-user column layout, private notes, personal vs. global highlights, per-user theme, per-cell change history and activity feed, event duplication, formatted PDF export, Space/Shift+Space show-caller shortcuts, follower auto-scroll, and item runtime clocks that count down then turn red counting up on overrun. The video also validated the web-first Mac/PC + phone/tablet companion strategy.

### Added — 2026-08-04 (Phase 1 start)
- Phase 1 design proposals for review, per the build prompt's gate: [docs/DATA-MODEL.md](docs/DATA-MODEL.md) (Postgres schema for identity/teams/events/rundowns/sharing/show-state, plus the Yjs rundown document shape with reconciliation rules and persistence strategy) and [PROTOCOL.md](PROTOCOL.md) (versioned WebSocket protocol: session establishment for signed-in/join-code/guest clients, NTP-style clock sync, server-authoritative show state with monotonic sequence numbers, caller transport commands, guest JSON projection, presence, reconnect/staleness contract, error codes).

### Changed — 2026-08-04 (later)
- Rewrote [BUILD_PROMPT.md](BUILD_PROMPT.md) as the definitive kickoff prompt: added the showcaller event-creation flow, the show-day multi-device broadcast model (join codes/QR, roles, server-authoritative show state with client-side clock-offset countdowns, reconnect/stale handling), and a cross-platform strategy — one responsive web app for Mac/PC browsers plus phone/tablet companion surfaces (PWA, wake lock) in v1, with timing/protocol logic isolated in platform-agnostic packages and a versioned documented WebSocket protocol so native iPhone/Android apps can be added later without a rewrite. Build order expanded to seven phases ending with protocol docs and self-hosting packaging.

### Added — 2026-08-04
- Completed a third research pass: hands-on exploration of a desktop timecode-driven show-automation reference app. Recorded in local research notes: frame-accurate cue timelines chased by external timecode, typed automation tracks (camera cuts, graphics, OSC/MIDI/HTTP/GPIO, text, playback), live-punch cue authoring, live override controls (skip/hold/take), per-cue flags/markers/auto-numbering, and companion-device pairing. Spec's future-scope section extended with a possible timecode-chase "pro mode" and live override verbs.
- Project kickoff: product spec and build prompt ([BUILD_PROMPT.md](BUILD_PROMPT.md)), README, and permanent project rules ([CLAUDE.md](CLAUDE.md)).
- Completed a detailed product-research pass for the core rundown/show-caller scope; findings captured in local research notes (kept out of the repo by design). Spec updated with: overflow-menu structure (Settings / Views / Export / Guest Pass / History), prompter behavior and controls, speaker-timer sharing, guest-pass column visibility, event content model (rundowns, folders, file uploads, CSV import), and timing-engine details (cascade recalculation, hard starts, hide/mute duration).
- Completed a second research pass covering event project management; recorded as future (post-v1) scope: task lists with reusable templates, nested subtasks, milestones, dependencies, tags and watchers; list/Gantt/calendar views; public read-only calendar links; per-event content hub (notes, files, links); per-event team chat; notification fan-out to assignees and watchers; guest users with task-scoped visibility; org-level KPI dashboard.
- This changelog.

### Changed — 2026-08-04
- Repo hygiene: all reference material moved to local-only files excluded via `.gitignore`; git history rewritten to a single clean root commit containing no reference material.
