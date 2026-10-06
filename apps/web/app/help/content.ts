/**
 * Everything the Help page says, as data.
 *
 * Written so somebody who has never seen the app can follow it: what a thing
 * is FOR before how to use it, short sentences, no programmer words. Two marks
 * are allowed inside any string (see rich.tsx): **Name** for a name as it
 * appears on screen, and `Key` for a key to press.
 *
 * Keep it true. Every name in bold should match the button or menu item it
 * describes, letter for letter. When the app changes, change this file in the
 * same commit.
 *
 * Fictional examples only: teams HARBOUR, RIVERS, COAST, RANGERS; sponsors
 * "Sponsor A" and "Northbank".
 */

export interface HelpItem {
  /** Unique across the page; becomes the heading's id so it can be linked to. */
  id: string;
  /** The name as it appears on screen. */
  name: string;
  /** What it is for — one sentence. */
  forWhat: string;
  /** Numbered steps, when there is more than one thing to do. */
  steps?: string[];
  /** A short line, when one line says it. */
  how?: string;
  /** Ways that differ by device. */
  mouse?: string;
  keys?: string;
  finger?: string;
  /** Only when it is limited. */
  who?: string;
  /** Only when it genuinely helps. */
  good?: string;
}

export interface HelpSection {
  id: string;
  title: string;
  intro?: string[];
  items: HelpItem[];
}

export interface Shortcut {
  keys: string;
  does: string;
  where: string;
}

export interface Gesture {
  gesture: string;
  does: string;
  where: string;
}

const EDITORS = "Anyone who can change the sheet: a System Administrator, a Showcaller, or a Producer.";
const CALLER = "Only the Showcaller (and a System Administrator).";

export const SECTIONS: HelpSection[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "getting-started",
    title: "Getting started",
    intro: [
      "OpenCall is a run sheet for live events. A run sheet is the list of everything that happens in a show, in order, with a time for each thing — the walk-out, the anthem, kick-off, the half-time show.",
      "One person, the Showcaller, runs the show from the sheet. Everyone else — camera operators, the stage manager, the screen in the green room — sees the same sheet on their own phone, tablet or computer, and it moves along as the show moves along.",
      "Things are kept in three layers: a **company** holds **events**, and an event holds **shows**. Each show has one run sheet.",
      "Not sure what a button does? Point at it with the mouse and a short explanation appears.",
    ],
    items: [
      {
        id: "roles",
        name: "Who can do what",
        forWhat: "Everybody gets the right amount of power — enough to do their job, and no more.",
        steps: [
          "**System Administrator** looks after the whole server. They can see and change everything.",
          "**Showcaller** runs the show. They press **Start show**, move the show along and can change the sheet. This can be for one event, or every event at a company.",
          "**Producer** builds the sheets for an event. They can change everything on the sheet, but never start or step the show.",
          "**Crew** follow an event. They can read the sheet and raise notes, but not change it.",
          "**Guest** is anyone who opens a view-only link. They can read the sheet, and nothing else.",
        ],
        good: "You may also see **Viewer**: someone who can read every event at a company. It still works for people who already have it, but is no longer handed out.",
      },
      {
        id: "join-code",
        name: "Join a show — or sign in",
        forWhat: "Lets crew open a show by typing a short code, without needing an account.",
        steps: [
          "Go to the OpenCall front page.",
          "Type the code you were given into the box (it looks like six letters and numbers).",
          "Press **Join**. The run sheet opens, read-only.",
        ],
        good: "A code only ever opens a sheet to read. To change a sheet or run a show you need an account.",
      },
      {
        id: "sign-in",
        name: "Sign in",
        forWhat: "Opens your dashboard so you can build and run shows.",
        steps: [
          "On the front page, type your email and password.",
          "Press **Sign in**. You land on the dashboard.",
        ],
        good: "Five wrong passwords in a row and sign-in pauses for fifteen minutes, to keep strangers out. Wait, then try again.",
      },
      {
        id: "access-token",
        name: "Sign in with an access token",
        forWhat: "Lets a company or a person sign in with a long secret code instead of a password.",
        how: "Paste the token (it starts with `usr_` or `co_`) into the **Join code or access token** box on the front page and press the button.",
        good: "A token is shown only once, when it is made. Keep it somewhere safe, like a password.",
      },
      {
        id: "invitation",
        name: "Accept an invitation",
        forWhat: "Turns an emailed invitation into your own account.",
        steps: [
          "Open the link in the invitation email.",
          "Type your name, and choose a password of at least 12 characters.",
          "Press the button to finish. You are signed in.",
        ],
        good: "An invitation works once, and runs out after a while. If yours has expired, ask for a new one.",
      },
      {
        id: "whos-watching",
        name: "Who’s watching?",
        forWhat: "When you open a view-only link, the sheet asks your name so the Showcaller knows who is following.",
        how: "Type your name and what you do — for example “Sam, Camera 2” — and carry on. You are only asked once on each device.",
      },
      {
        id: "dashboard",
        name: "Dashboard",
        forWhat: "The home page after you sign in: every company and event, with each of its shows on a card.",
        how: "Each card says when the show starts, how long it runs and when it ends; how many rows it has and when it was last changed; and, once a show has been run, the day of the last one and how far over or under it ran (the same figure as **Ran** at the top of the sheet). Each has one big button — **Open show**, **Edit run sheet** or **View**, depending on what you are allowed to do — and a **⋯** menu with everything else.",
        good: "A show that is on air is marked **Live**. One nobody remembered to stop is marked **left running** in grey. Over is red and under is green, like on the sheet.",
      },
      {
        id: "menu",
        name: "The menu (☰)",
        forWhat: "Holds the things you need now and then, so they are not in the way the rest of the time.",
        mouse: "Click the three-line button at the top left. Click anywhere else to close it.",
        finger: "Tap the three-line button. Tap the sheet to close it.",
        good: "What is in the menu depends on the page you are on and what you are allowed to do.",
      },
      {
        id: "appearance",
        name: "Appearance",
        forWhat: "Chooses dark or light colours, to suit the room you are in.",
        how: "Open the menu (☰) and choose **Dark**, **Light** or **Match system** under Appearance.",
        good: "Dark is the starting choice, because shows often run in dark rooms. Your choice is remembered on this device only.",
      },
      {
        id: "my-account",
        name: "My account",
        forWhat: "Change your name, your email or your password.",
        steps: [
          "Open the menu (☰) and choose **My account**.",
          "Change what you need under **My details** or **Change password**, and save.",
        ],
        good: "Changing your password also disconnects any AI assistant you had connected.",
      },
      {
        id: "sign-out",
        name: "Sign out",
        forWhat: "Ends your session on this device, so the next person cannot use your account.",
        how: "Open the menu (☰) and choose **Sign out**.",
        good: "If you do not use OpenCall for 14 days, you are signed out on your own.",
      },
      {
        id: "whats-new",
        name: "What’s new",
        forWhat: "Shows what has changed in OpenCall since the last update.",
        steps: [
          "On the dashboard, scroll to the bottom and click the version number at the right.",
          "A list of changes opens. Click one to read more.",
        ],
        good: "A dot on the version number means a newer OpenCall is ready. Press **Update this tab** to load it.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "setting-up",
    title: "Setting up companies, events and shows",
    intro: ["All of this happens on the dashboard."],
    items: [
      {
        id: "new-company",
        name: "+ Company",
        forWhat: "Adds a new company — the production house that owns a set of events.",
        steps: ["On the dashboard, press **+ Company**.", "Type the company name and press **Create company**."],
        who: "Only a System Administrator.",
      },
      {
        id: "company-menu",
        name: "Company ⋯ menu",
        forWhat: "Rename a company, give it a logo, or make it a new access token.",
        how: "Press **⋯** beside the company name, then **Rename**, **Logo…** or **New token…**. **Delete company** sits apart, because it removes everything the company owns.",
        good: "**New token…** makes a fresh token and stops the old one working.",
      },
      {
        id: "new-event",
        name: "+ New event",
        forWhat: "Adds an event — a match day, a concert, a launch — to a company.",
        steps: [
          "Press **+ New event** under the company.",
          "Fill in the event name, the event location, and the start and end dates.",
          "If you like, choose the **Usual kind of show** (for example rugby league). You can also leave it to each show.",
          "Press **Create event**.",
        ],
        good: "The location sets the time zone, so every clock in the event shows the time where the event is.",
      },
      {
        id: "event-menu",
        name: "Event ⋯ menu",
        forWhat: "Change an event's details after it is made.",
        how: "Press **⋯** beside the event, then **People**, **Rename**, **Dates…**, **Event location…** or **Archive**. **Delete event** is at the bottom.",
        good: "**People** lists everyone who can open the event, and why.",
      },
      {
        id: "event-image",
        name: "Event and team pictures",
        forWhat: "Puts a picture beside the event (its brand) and beside each show (the home and away teams).",
        mouse: "Click the empty picture slot, or drag a picture onto it. Point at a picture and press ✕ to remove it.",
        finger: "Tap the empty picture slot and choose a picture.",
      },
      {
        id: "new-show",
        name: "Add a show (+ Create show)",
        forWhat: "Makes a new, empty run sheet inside an event.",
        steps: [
          "At the foot of the event, under **Add a show**, type a **Show name**.",
          "Choose **Start blank**, or pick a saved template to copy.",
          "Press **+ Create show**.",
        ],
      },
      {
        id: "import",
        name: "Import run sheet…",
        forWhat: "Turns a run sheet you already have — from Excel, Numbers, a CSV file or a PDF — into an OpenCall show.",
        steps: [
          "Press **⤒ Import run sheet…** under the event.",
          "Drop the file onto the box, or click to choose it.",
          "Check the preview. Each column has a box above it saying what it will become (the time, the length, the title, and so on). Change any that are wrong.",
          "Fix anything listed as unreadable — each one sits in its own box with a suggestion.",
          "Give the show a name, choose what kind of show it is, and press **Import**.",
        ],
        good: "Double-click a column heading in the preview to rename it, or drag it to move it. If the column names came from the wrong line, change **Header row**.",
      },
      {
        id: "reimport",
        name: "Re-import file…",
        forWhat: "Reads the original file again — useful when the importer has improved, or the file has changed.",
        how: "Press **⋯** on the show, then **Re-import file…**. You see the preview again before anything changes.",
        good: "Links and codes for the show keep working.",
      },
      {
        id: "show-menu",
        name: "Show ⋯ menu",
        forWhat: "Everything else you can do with a show from the dashboard.",
        how: "Press **⋯** on the show. Inside: **Timer**, **Prompter**, **End event**, **Edit run sheet**, **Read-only view**, **Copy view-only link**, **Re-import file…**, **Rename**, **Duplicate**, **Archive** and **Delete show**.",
        who: "You only see the items you are allowed to use.",
      },
      {
        id: "kind-of-show",
        name: "Kind of show",
        forWhat: "Tells OpenCall how this show can end — for example, a rugby league match can go to golden point, a product launch cannot.",
        how: "Click the kind-of-show chip under the show's name on the dashboard and choose from the list.",
        good: "Kinds that are not finished yet are greyed out. A company can add its own kinds on the **Kinds of show** page.",
      },
      {
        id: "archive",
        name: "Archive and Show archived",
        forWhat: "Tidies old events and shows away without deleting them.",
        how: "Choose **Archive** from an event's or show's ⋯ menu. To see archived things again, open the menu (☰) and tick **Show archived**.",
      },
      {
        id: "duplicate",
        name: "Duplicate",
        forWhat: "Makes a copy of a show — handy for next week's match.",
        how: "Press **⋯** on the show and choose **Duplicate**. The copy keeps its teams' pictures.",
      },
      {
        id: "template",
        name: "Save as template",
        forWhat: "Saves a sheet's shape so new shows can start from it.",
        how: "On the show page, open the menu (☰) and choose **Save as template**. Next time you add a show, pick it instead of **Start blank**.",
        who: CALLER,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "building",
    title: "Building a run sheet",
    intro: [
      "You build a sheet on the **edit page** (it says **EDITING** at the top) or on the **show page** before the show starts.",
      "Every change is saved straight away and appears on everyone else's screen within a moment.",
    ],
    items: [
      {
        id: "rename-sheet",
        name: "Rename the sheet",
        forWhat: "Gives the sheet a better name than whatever the file was called.",
        how: "Click the sheet's name at the top, type the new name, and press `Enter`.",
        who: EDITORS,
        good: "On a phone, tapping the name takes you back to the dashboard instead.",
      },
      {
        id: "add-row",
        name: "+ Row",
        forWhat: "Adds a new timed item to the sheet.",
        how: "Press **+ Row** in the toolbar. The row goes after the row you last picked, or at the end.",
        who: EDITORS,
        good: "To put a row in an exact place, use **Add a row above** or **Add a row below** in the row menu.",
      },
      {
        id: "edit-cell",
        name: "Change what a cell says",
        forWhat: "Types or changes the words in any box on the sheet.",
        mouse: "Double-click the cell, type, then click somewhere else. Or click once and just start typing — see “Editing like a spreadsheet”.",
        finger: "On a tablet, double-tap the cell, type, then tap somewhere else.",
        who: EDITORS,
        good: "While a cell is open, a small bar of buttons lets you make words **B**old, *I*talic, underlined, crossed out, highlighted, or a link.",
      },
      {
        id: "read-time",
        name: "Read time",
        forWhat: "Shows how long words take to read out loud, so a script fits its slot.",
        how: "Open a cell with eight words or more. Under it you see the word count and three times: slow, normal and fast. Press one to make it the item's length.",
        who: EDITORS,
        good: "One Undo puts the old length back.",
      },
      {
        id: "duration",
        name: "Set how long an item runs",
        forWhat: "Each item has a length. The lengths add up to give every row its start time.",
        steps: [
          "Double-click the item's length (the DUR column).",
          "Type the length: `2:30` is two and a half minutes, `30m` is thirty minutes, `1m30s` is a minute and a half. A plain number like `90` means 90 seconds.",
          "Press `Enter`.",
        ],
        who: EDITORS,
        good: "When a length changes, every fixed time below moves by the same amount. One Undo takes it all back.",
      },
      {
        id: "duration-options",
        name: "Hide, Mute and Alongside",
        forWhat: "Three extra choices for an item's length.",
        steps: [
          "**Hide** keeps the length in the maths but hides it from crew and guests.",
          "**Mute** leaves the length out of the running order altogether.",
          "**Alongside** is for something that happens at the same time as the show, like a recording in the tunnel. It takes no time in the running order, and the show steps over it.",
        ],
        how: "Double-click the length. The three buttons are under the box.",
        who: EDITORS,
      },
      {
        id: "fixed-start",
        name: "Set a fixed start time",
        forWhat: "Pins an item to a time of day — for example, kick-off at 7:30 pm — so the times below follow it.",
        steps: [
          "Double-click the item's time.",
          "Type the time, such as `7:30 pm` or `19:30`, and press `Enter`.",
        ],
        who: EDITORS,
        good: "To let the row flow on from the one above again, open the time and empty the box.",
      },
      {
        id: "planned-start-end",
        name: "Start, Dur and End",
        forWhat: "The sheet's plan at a glance: when it starts, how long it runs, and when it ends.",
        how: "They sit at the top left, under the sheet's name. Click **Start** or **End** to change them.",
        who: "Anyone can read them. Changing them: " + EDITORS,
        good: "Once the show starts, End stops moving. Compare it with **Proj. end** on the right to see how late the night is running.",
      },
      {
        id: "group-milestone",
        name: "Headings and fixed times",
        forWhat: "Marks rows that are not ordinary items.",
        steps: [
          "A **heading** (grey) names a part of the night, like PRE-GAME or HALF TIME. It has no time of its own. (Some people call this a group.)",
          "A **fixed time** (yellow) is something set for a time, with no length, like DOORS OPEN 6:00 or TEAM LIST DUE. (Some people call this a milestone.)",
          "Open the row menu on the row and choose **Turn into a heading** or **Turn into a fixed time**. Choose **Turn back into a normal row** to undo it.",
        ],
        who: EDITORS,
      },
      {
        id: "move-rows",
        name: "Move a row",
        forWhat: "Changes the order of the show.",
        mouse: "Drag the row by its row number to its new place.",
        who: EDITORS,
        good: "The times move to match the new order. Locked rows cannot be moved.",
      },
      {
        id: "select-rows",
        name: "Pick rows",
        forWhat: "Chooses one or more rows so you can do something to all of them at once.",
        mouse: "Click a row number to pick it. Hold `Shift` and click another to pick everything in between. Hold `Cmd` (or `Ctrl` on Windows) and click to add or remove one row.",
        finger: "Tap a row number. Then tap more row numbers — each tap adds or removes one.",
        who: EDITORS,
        good: "To let go of them, choose **Unpick this row** (or **Unpick these rows**) in the row menu, or press `Esc`.",
      },
      {
        id: "strike",
        name: "Strike",
        forWhat: "Drops an item without losing it. It stays on the sheet with a line through it, out of the timing, and the show steps over it.",
        how: "Open the row menu and choose **Strike out row**. Choose **Un-strike row** to put it back in the show.",
        who: EDITORS,
        good: "Striking works during the show, even on a locked row — dropping a cue must never be blocked. The time it took is given back to the rows below.",
      },
      {
        id: "lock",
        name: "Lock",
        forWhat: "Marks a row as approved, so nobody can change it by accident.",
        how: "Open the row menu and choose **Lock row**. A small padlock appears on the row number. Choose **Unlock row** to change it again.",
        who: EDITORS,
        good: "A locked row cannot be typed in, moved, retimed or deleted — not even by an AI assistant. It can still be struck.",
      },
      {
        id: "highlight",
        name: "Colour a row",
        forWhat: "Colours a row so it stands out, for example every row for Sponsor A.",
        how: "Open the row menu and click a colour under **Colour**. The empty square takes the colour off.",
        who: EDITORS,
        good: "Everyone sees the colour, on every screen.",
      },
      {
        id: "columns-menu",
        name: "Columns",
        forWhat: "Chooses which columns you see, and adds new ones.",
        steps: [
          "Press **Columns** in the toolbar.",
          "Tick or untick a column to show or hide it — this only changes your own screen.",
          "Tick **ZERO countdown** for an extra column counting down to the next fixed time.",
          "Press **Add column…** to add a new column for everyone.",
        ],
        good: "Not offered while the show is live.",
      },
      {
        id: "column-headings",
        name: "Column headings",
        forWhat: "Rename, move and resize the columns.",
        mouse: "Click a heading to rename it. Drag a heading sideways to move the column. Drag the edge between two headings to make a column wider; double-click that edge to put it back.",
        who: "Renaming and moving: " + EDITORS + " Widths are your own.",
      },
      {
        id: "plays-for-result",
        name: "Only play this if…",
        forWhat: "Marks which rows only happen for a certain result — the winning song if HARBOUR win, the other one if they lose.",
        steps: [
          "Pick the rows for one ending.",
          "Open the row menu and choose **Only play this if…**.",
          "Choose **…we win**, **…we lose**, **…it's a draw**, **…it goes to extra time (golden point)**, or **Always play it**.",
        ],
        who: EDITORS,
        good: "Imported sheets often have their endings marked already.",
      },
      {
        id: "endings-layout",
        name: "Endings: layered / Endings: one line",
        forWhat: "Chooses how the different endings look on the sheet.",
        how: "Press the **Endings** button in the toolbar to switch. **One line until called** shows a single line at full time until a result is called. **Show all, in layers** shows every ending. The same choice is in the menu (☰) under Endings.",
        good: "In the one-line layout, the small triangle at the far left opens an ending for a look. Looking does not call anything.",
      },
      {
        id: "copy-to-sheet",
        name: "Copy to another sheet…",
        forWhat: "Copies rows into another show at the same company.",
        steps: [
          "Pick the rows.",
          "Open the row menu and choose **Copy to another sheet…**.",
          "Choose the sheet. The rows go on its end, matched to its columns by name.",
        ],
        who: EDITORS,
        good: "Not while that other show is live, or while someone else is editing it. Anything it has no column for is listed, not lost.",
      },
      {
        id: "find-replace",
        name: "Find and replace",
        forWhat: "Finds words anywhere on the sheet, and changes them all at once if you want.",
        steps: [
          "Open the menu (☰) and choose **Find and replace**.",
          "Type what to find. Every match is listed — click one to go there.",
          "Type the new words in **Replace with** and press **Replace all**.",
        ],
        keys: "`Cmd+Shift+F` (or `Ctrl+Shift+F` on Windows).",
        who: "Anyone can find. Replacing: " + EDITORS,
        good: "One Undo takes the whole replace back. Locked rows are left alone.",
      },
      {
        id: "jump",
        name: "Jump to row — or do something",
        forWhat: "Takes you straight to any row, or does a job without hunting for its button.",
        steps: [
          "Press `Cmd+K` (or `Ctrl+K` on Windows), or choose **Jump to row** in the menu (☰).",
          "Type a row number or a few words — or what you want to do, like **start**, **prompter**, **add row**, **version** or **help**.",
          "Press `Enter`. A row glows for a moment; an action just happens (Start the show still asks first if something needs checking).",
        ],
        good: "During a show, jumping stops your screen following the live row. Press **Sync Cue** to go back.",
      },
      {
        id: "undo",
        name: "Undo and Redo",
        forWhat: "Takes back a change you did not mean, or puts it back again.",
        mouse: "Press **↺ Undo** or **↻ Redo** in the toolbar.",
        keys: "`Cmd+Z` to undo, `Cmd+Shift+Z` to redo (`Ctrl` on Windows).",
        who: EDITORS,
        good: "Undo works during the show too — a mis-pressed timing button is one press away from fixed.",
      },
      {
        id: "delete-rows",
        name: "Delete",
        forWhat: "Removes rows from the sheet for good.",
        how: "Pick the rows, open the row menu and choose **Delete row**.",
        who: EDITORS,
        good: "Not during a live show — strike instead, so the record of what happened stays.",
      },
      {
        id: "saving",
        name: "Saving… and Offline",
        forWhat: "Tells you when your changes have not reached the server yet.",
        how: "Nothing to press. An amber **Saving…** appears while changes are on their way. **Offline · changes kept here** means the connection has dropped — your changes wait on this device and go when it comes back.",
        good: "If you try to close the tab while changes are waiting, it asks first.",
      },
      {
        id: "ink",
        name: "Ink",
        forWhat: "Lets you scribble on the sheet like a pen on paper — circles, arrows, reminders.",
        steps: [
          "Press **Ink** in the toolbar.",
          "Pick a pen colour and draw with a mouse or an Apple Pencil.",
          "Use **Eraser** to rub out a whole mark, **Undo** and **Redo** for the last stroke, **Hide ink** for a clean look, and **Clear ink** (press twice) to wipe everything.",
          "Press **Ink** again to stop drawing and click into cells again.",
        ],
        finger: "Turn on **Finger** to draw with your finger. While it is on, a finger no longer scrolls the sheet.",
        good: "Your ink is yours alone — nobody else sees it. Each mark sticks to its row, even when rows move.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "spreadsheet",
    title: "Editing like a spreadsheet",
    intro: [
      "The sheet works like Google Sheets or Excel. If you know those, you already know this.",
      "This works on the edit page and on the show page. During a live show, press **✎ Edit run sheet** first, so your keys do not move the show by mistake. It is not on phones.",
      "On a Mac press `Cmd`; on Windows press `Ctrl` instead.",
    ],
    items: [
      {
        id: "blue-box",
        name: "The blue box",
        forWhat: "Shows which cell your keys will act on.",
        how: "Click any cell once. A blue box appears around it.",
        who: EDITORS,
        good: "Click anywhere outside the sheet to put the box away. Double-click still opens a cell the old way.",
      },
      {
        id: "type-to-replace",
        name: "Type to replace",
        forWhat: "The fastest way to change a cell.",
        how: "With the blue box on a cell, just start typing. What you type replaces what was there.",
        keys: "To change a cell without wiping it, press `Enter` or `F2` — it opens as it is.",
      },
      {
        id: "save-move",
        name: "Save and move on",
        forWhat: "Finishes a cell and takes you to the next one, without the mouse.",
        steps: [
          "`Enter` saves and moves down.",
          "`Tab` saves and moves right. `Shift+Tab` moves left.",
          "`Shift+Enter` starts a new line inside the cell.",
          "`Esc` closes the cell.",
        ],
        good: "Pressing `Enter` on the last row adds a new row underneath.",
      },
      {
        id: "arrows",
        name: "Move around",
        forWhat: "Moves the blue box from cell to cell.",
        keys: "Arrow keys move one cell. `Cmd` + an arrow jumps to the end of the filled cells you are in, or on to the next filled cell — the same as in a spreadsheet.",
      },
      {
        id: "select-block",
        name: "Pick a block of cells",
        forWhat: "Chooses many cells at once, to copy, cut, fill or empty them.",
        keys: "Hold `Shift` and press the arrow keys.",
        mouse: "Press on the first cell and drag to the last. Or click the first, then hold `Shift` and click the last.",
        finger: "On an iPad: tap the first cell so it has the blue box, then drag from the blue box. (Dragging anywhere else scrolls the sheet.)",
      },
      {
        id: "copy-cut",
        name: "Copy and cut",
        forWhat: "Copies cells so you can paste them somewhere else — even straight into Google Sheets or Excel.",
        keys: "`Cmd+C` copies. `Cmd+X` cuts (copies, then empties the cells).",
      },
      {
        id: "paste",
        name: "Paste",
        forWhat: "Brings a block of cells in from Google Sheets, Excel, or another part of the sheet.",
        steps: [
          "Copy the cells in the other program.",
          "Click the cell where the top-left corner should go.",
          "Press `Cmd+V`.",
        ],
        good: "Times like “6:30 pm” and lengths like “2:30” are read into the time and length columns. Bold, italic, underline, strikethrough and a coloured cell come across too, from Google Sheets or Excel. If the block is taller than the sheet, new rows are added at the end.",
      },
      {
        id: "fill-down",
        name: "Fill down",
        forWhat: "Copies the top cell of a block into every cell below it.",
        keys: "Pick a block and press `Cmd+D`. With one cell picked, it copies the cell above.",
      },
      {
        id: "empty-cells",
        name: "Empty cells",
        forWhat: "Clears what is in the picked cells.",
        keys: "Press `Delete` or `Backspace`.",
      },
      {
        id: "spreadsheet-safety",
        name: "Undo and locked rows",
        forWhat: "Keeps big changes safe.",
        how: "After every paste, fill or clear, a short note at the top says what happened, with an **↺ Undo** button. One press (or one `Cmd+Z`) takes the whole thing back. Locked rows are never changed — the note says how many were skipped.",
      },
      {
        id: "row-menu",
        name: "Row menu",
        forWhat: "Everything you can do to a row, in one place.",
        mouse: "Right-click the row.",
        keys: "Put the blue box on a cell in the row, then press `Shift+F10` or the Menu key. Use the arrow keys and `Enter` to choose; `Esc` closes it.",
        finger: "Press and hold the row for half a second. On a phone the menu slides up from the bottom, with **Cancel**. On an iPad it opens beside your finger.",
        steps: [
          "Before the show, on the show page, the top part holds the walkthrough: **Start the walkthrough from this row** (or **Move the walkthrough to this row**), **Previous row**, **Next row**, **End walkthrough** and **Message the stage…**. (Start show isn't here — the show starts on the clock, not from a row; use the green **Start show** button.)",
          "Below that, for anyone who can edit: **Add a row above**, **Add a row below**, **Make a copy of this row**, **Turn into a heading**, **Turn into a fixed time**, **Strike out row**, **Lock row**, **Only play this if…**, the colours, **Copy to another sheet…**, **Delete row** and **Unpick this row**. With several rows picked, “row” becomes “3 rows”, and so on.",
        ],
        good: "Right-clicking a row that is not picked picks it. With several rows picked, the menu acts on all of them and says how many. A quick tap or a scroll never opens it. Every change shows a note with an **↺ Undo** button.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "before-show",
    title: "Before the show",
    items: [
      {
        id: "open-show",
        name: "Open show",
        forWhat: "Takes you from the edit page to the show page, where the show is run.",
        how: "Press **▶ Open show** next to **EDITING** at the top of the edit page.",
        who: "People who can run the show.",
      },
      {
        id: "walkthrough",
        name: "Walkthrough",
        forWhat: "Lets you rehearse with the crew before the show. A blue highlight moves down the sheet, and every connected screen sees it.",
        steps: [
          "On the show page, press **Next** to put the highlight on the first row.",
          "Press **Next** and **Prev** to move it. The highlighted row shows on every screen; point at **Walkthrough** to see its row number.",
          "To start from a particular row, open the row menu on it and choose **Walk through from row …**. Once the walkthrough is going, click (or tap) any row to walk there.",
          "Press **End walkthrough** to take the highlight away.",
        ],
        who: CALLER,
        good: "Nothing is timed or recorded. The timer and prompter follow the highlight too.",
      },
      {
        id: "follow-showcaller",
        name: "Follow showcaller",
        forWhat: "Brings your screen back to where the Showcaller is, after you scrolled away to read ahead.",
        how: "If the walkthrough moves while you are looking somewhere else, **⇣ Follow showcaller** appears. Press it.",
        good: "It only moves your own screen.",
      },
      {
        id: "timing-check",
        name: "Timing check (Reconcile)",
        forWhat: "Finds places where the sheet's times and lengths do not add up, and helps you fix them.",
        steps: [
          "If there are any, an amber **⚠ timing gaps — Reconcile** button appears in the toolbar. Press it.",
          "Each problem is explained in plain words, with the sums.",
          "Pick a fix. One fix can move every fixed time below, so the whole sheet agrees again.",
        ],
        who: EDITORS,
        good: "One Undo takes a fix back. The check does not run during a live show.",
      },
      {
        id: "start-warnings",
        name: "Things to look at",
        forWhat: "Warns you about anything odd on the sheet before you go live.",
        how: "If something is worth a look, **Start show** turns into **Start anyway** and lists up to four things. Fix them, or press **Start anyway**.",
        good: "It warns, it never blocks. If kick-off is in one minute, the show starts.",
      },
      {
        id: "show-information",
        name: "Show information",
        forWhat: "Keeps the extra details from an imported sheet — contact lists, notes, page headings — without putting them in the running order.",
        how: "Open the menu (☰) and choose **Show information**. Only there when the sheet has some.",
        who: CALLER,
      },
      {
        id: "my-role",
        name: "My role",
        forWhat: "Lights up your own items, and counts down to your next one.",
        steps: [
          "Press **My role** in the toolbar.",
          "Pick your job, such as Camera 1 or PA, or type your own. You can pick more than one.",
          "Your rows turn your colour, and a bar at the bottom counts down to your next item.",
        ],
        good: "When your item is on air, the bar says **● YOU’RE ON**. Anyone can pick a role, even on a view-only link.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "running",
    title: "Running the show",
    intro: [
      "The show is run from the **show page**. The row on air is called the **live cue**. It is bigger, has a moving bar, and every screen follows it.",
    ],
    items: [
      {
        id: "start-show",
        name: "Start show",
        forWhat: "Goes live.",
        steps: [
          "Press **Start show** in the box at the top.",
          "The show lands on the row the clock says should be on air now. If the first item is still to come, it waits and counts down to it.",
        ],
        who: CALLER,
        good: "Starting also turns on **Follow clock**, so the show moves along by itself. A version of the sheet is saved the moment it starts.",
      },
      {
        id: "follow-clock",
        name: "Follow clock",
        forWhat: "Lets the clock run the show: each item goes on air at its printed time, even if every laptop is closed.",
        how: "Press **◷ Follow clock** to hand the show to the clock. Press it again to take it back and move the show yourself.",
        who: CALLER,
        good: "Green **Clock synced** means the live cue is on the row the clock expects. Amber **Following clock** means it will line up at the next item.",
      },
      {
        id: "step-by-hand",
        name: "Next and previous",
        forWhat: "Moves the show along by hand.",
        keys: "`Space` moves to the next item. `Shift+Space` goes back one. Not while you are typing in a cell.",
        who: CALLER,
        good: "There are no Next and Prev buttons during the show on purpose. To take a particular item, use **CUE** on that row.",
      },
      {
        id: "cue",
        name: "CUE",
        forWhat: "Puts a particular row on air right now.",
        mouse: "Point at a row below the live cue. Press **CUE** in the middle of the row.",
        finger: "On an iPad, tap the row, then press **CUE** in the strip at the bottom of the screen.",
        who: CALLER,
        good: "If that skips over rows, it asks first (“Strike 2?”), because the rows it passes are struck.",
      },
      {
        id: "nudges",
        name: "Timing buttons (−30 −15 −5, +5 +15 +30)",
        forWhat: "Makes the item on air a few seconds shorter or longer, to bring the show back on time.",
        mouse: "Point at the live row. Press a minus button to take seconds out, a plus button to add them.",
        finger: "On an iPad they sit in a strip at the bottom. They act on the live row, or the one row you picked.",
        who: CALLER,
        good: "Everything below moves by the same amount. One Undo puts it back. Only during a live show, and not on phones.",
      },
      {
        id: "hold",
        name: "HOLD and GO",
        forWhat: "Keeps an item on air past its end — for an injury, a stoppage, a speech running long.",
        steps: [
          "Press **HOLD** on the live row. The show stays there and keeps counting.",
          "When it is time to move on, press **GO**. It shows how long you held.",
        ],
        who: CALLER,
        good: "The extra time is added to the item, and everything below moves by the same amount.",
      },
      {
        id: "sync-cue",
        name: "Sync Cue",
        forWhat: "Brings your screen back to the live cue after you scrolled away.",
        how: "Press **⇣ Sync Cue** at the top of the sheet. Your screen follows the show again.",
        good: "Scrolling never fights you — your screen simply stops following until you press it.",
      },
      {
        id: "readouts",
        name: "The big timer and the readouts",
        forWhat: "Tells you, at a glance, how the show is doing.",
        steps: [
          "The big timer in the middle counts down the item on air: green, then amber near the end, then red counting up if it runs over.",
          "On the left: **Start**, **Dur** and **End** — the plan. **Ran** shows how far over or under the items so far have run.",
          "On the right: **Proj. end** — when the show will really finish — and the time of day.",
          "Top right, **✓ Saved** means every change is saved and shared. If the connection drops it says **Offline · changes kept here** — keep working; your changes are sent when it reconnects. **Show link reconnecting…** means Start, Next and the clock are reconnecting by themselves.",
        ],
      },
      {
        id: "over-under",
        name: "Over and under",
        forWhat: "Shows how long each item really took against its plan.",
        how: "After an item leaves the air, a small chip appears by its length: red “+0:12” ran over, green “−0:08” ran under. Point at it for the real time.",
        good: "The figures stay after the show, so the next morning you can see where the time went.",
      },
      {
        id: "ticks",
        name: "Played ticks",
        forWhat: "Marks every row that has been on air, so the show never offers it as next again.",
        steps: [
          "A ✓ appears on the row number and the words go grey.",
          "To play it again, click the tick, then **Confirm**.",
          "To skip a row above the live cue for good, point at it and press **✓ Mark as played**.",
        ],
        who: "Everyone sees the ticks. Changing them: " + CALLER,
        good: "Starting a show clears every tick.",
      },
      {
        id: "behind-clock",
        name: "Behind the clock",
        forWhat: "Warns everyone when the show has stopped moving and the clock has run ahead.",
        how: "A bar says how many rows behind the live cue is. The Showcaller can press **Follow clock** in that bar to catch up.",
      },
      {
        id: "result",
        name: "Full time — call the result",
        forWhat: "Picks which ending happens, so the other endings are skipped on every screen.",
        steps: [
          "Near full time a bar appears at the bottom of the screen, with a countdown.",
          "Press **Win**, **Lose**, **Draw** or **⚡ Golden point** — whichever happened. The show finishes the item on air, then plays that ending.",
          "Golden point plays the extra-time rows, then asks for the final result again.",
          "Pressed the wrong one? Press **Reset** and every ending comes back.",
        ],
        who: CALLER,
        good: "Which buttons you see depends on the kind of show. If nobody calls a result, the show carries on and the bar says so.",
      },
      {
        id: "build-extra-time",
        name: "Build extra time",
        forWhat: "Adds golden point rows to a sheet that never had them, on the night a match is level.",
        how: "At the full-time row, press the **⚡** button that offers to build the extra period. It adds the breaks and the periods, and moves every printed time below.",
        who: CALLER,
        good: "One Undo takes it all back out. Only offered for kinds of show that can go to extra time.",
      },
      {
        id: "period-rail",
        name: "Period strip",
        forWhat: "Shows which part of the game you are in, down the left edge of the sheet.",
        how: "Nothing to press. It reads **1H** and **2H** for halves, **1Q** to **4Q** for quarters, and **GP** for golden point. Endings show **WIN**, **LOSE**, **DRAW** or **GP** down a coloured bar.",
        good: "On a day with two games, the second game has a tinted edge down the row numbers.",
      },
      {
        id: "message-stage",
        name: "Message stage",
        forWhat: "Flashes a short message in big letters on every timer and prompter screen — to tell a speaker to wrap up, for example.",
        steps: [
          "Press **Message stage**.",
          "Pick **Wrap up**, **30 seconds**, **Stretch 2 minutes**, **Stand by**, **Slow down** or **Speed up** — or type your own and press **Send**.",
          "The message stays up until you press **Clear**.",
        ],
        mouse: "Also in the row menu: right-click any row and choose **Message the stage…**.",
        who: CALLER,
        good: "The show page shows what is up, so nothing is left on a screen by accident.",
      },
      {
        id: "stopwatch",
        name: "Stopwatch",
        forWhat: "Times anything you like — a speech, a break — separately from the show.",
        how: "Press the stopwatch beside the show's controls to start it, again to stop it, and the reset button to go back to zero.",
        good: "It appears once the show is live. Not on phones.",
      },
      {
        id: "edit-live",
        name: "✎ Edit run sheet",
        forWhat: "Opens the editing tools during a live show, when you really need them.",
        how: "Press **✎ Edit run sheet** in the toolbar. Press **✕ Editing** to put them away.",
        who: EDITORS,
        good: "Kept behind a button so the live screen stays calm, and so keys do not change cells by mistake.",
      },
      {
        id: "stop",
        name: "Stop",
        forWhat: "Ends the live show.",
        steps: ["Press **Stop**.", "It changes to **Confirm**. Press it within ten seconds to end the show. Press anything else to cancel."],
        who: CALLER,
      },
      {
        id: "end-event",
        name: "End event and Reopen to viewers",
        forWhat: "Closes the sheet to the crew once the event is over.",
        how: "When the show is over, a **Show over** bar appears at the bottom — press **End event**. It is also in the menu (☰) and in the show's ⋯ menu on the dashboard. **Reopen** lets them back in.",
        who: CALLER,
        good: "It stops the show if it is still running. You, and anyone who can edit, keep your access.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "screens",
    title: "Screens for the crew and the venue",
    items: [
      {
        id: "view-only-links",
        name: "View-only links",
        forWhat: "Gives crew a link that opens the sheet to read, on any phone or computer, with no account.",
        steps: [
          "On the show page, open the menu (☰) and choose **View-only links**.",
          "Press **Copy view-only link** and send it to your crew.",
          "Press **Columns** on a link to choose what it shows.",
          "Press **Turn off**, then press it again to be sure, to stop a link working everywhere at once.",
        ],
        who: CALLER,
        good: "The panel also lists who can open the sheet with an account, and who has it open right now. You can also copy a link from the show's ⋯ menu on the dashboard.",
      },
      {
        id: "view-page",
        name: "The view-only page",
        forWhat: "What crew see: the run sheet, moving with the show, that they cannot change.",
        how: "Open a view-only link. You see **VIEW ONLY** at the top, the live cue, and **LIVE** under the timer while the show is on air.",
        good: "Crew can still pick **My role**, raise notes, use **Find**, and open the Timer, Prompter or Backstage display from the menu (☰).",
      },
      {
        id: "install",
        name: "Put OpenCall on your home screen",
        forWhat: "Makes OpenCall open like an app — full screen, from its own icon, without the browser's bars.",
        finger: "iPhone or iPad (Safari): tap **Share** (the square with an arrow), then **Add to Home Screen**. Android (Chrome): tap the menu (⋮), then **Install app** or **Add to Home screen**.",
        good: "Phones show a one-time tip with these steps; on Android it has an **Install** button. Close it and it won't come back.",
      },
      {
        id: "ipad-caller",
        name: "Running the show on an iPad",
        forWhat: "Puts the show's controls where your thumbs are while you hold a tablet.",
        finger: "On an iPad, Start show, the walkthrough, Message stage — and once you're live, Hold and Stop — sit in a bar along the bottom edge, with bigger buttons.",
        who: "The showcaller, on a tablet. Computers and phones keep the controls at the top.",
      },
      {
        id: "crew-tabs",
        name: "The tab bar on a phone",
        forWhat: "Lets crew switch between the run sheet and the big timer with a thumb.",
        finger: "At the bottom of the screen: **Sheet**, **Timer**, and **Notes** (or **Help** if you opened a view-only link, which can't read notes). Tap one to switch.",
        who: "Crew on a phone. The showcaller's screen doesn't show it — their controls live at the top.",
      },
      {
        id: "timer",
        name: "Timer",
        forWhat: "A big, full-screen countdown for a speaker or a monitor on stage.",
        steps: [
          "Open the menu (☰) and choose **Timer** under Views.",
          "Double-click the timer to fill the whole screen.",
        ],
        good: "Green while on time, amber near the end, red when over. It shows the item before and the item after, counts down to the first item before the show, and shows stage messages. The screen stays awake.",
      },
      {
        id: "prompter",
        name: "Prompter",
        forWhat: "Shows the words a presenter reads, large, scrolling at the right speed for the item on air.",
        steps: [
          "Press **▤ Prompter** in the toolbar, or choose **Prompter** in the menu (☰).",
          "**auto pace** scrolls the words so they finish as the item's time runs out.",
          "**A−** and **A+** change the size of the words. **mirror** flips them for a glass prompter.",
          "Drag the speed slider to set the speed by hand.",
        ],
        keys: "`Space` starts or stops scrolling. `↑` and `↓` change the speed. `+` and `−` change the size.",
        good: "It follows the show and the walkthrough. **⇣ Sync Cue** takes you back to the live words.",
      },
      {
        id: "backstage-display",
        name: "Backstage display",
        forWhat: "A screen for a TV in the green room or the tunnel: what is on air, how long it has left, what is next, and the clock — big enough to read across a room.",
        how: "Open the menu (☰) and choose **Backstage display** under Views. Nothing to press after that.",
        good: "Works from a view-only link too. Stage messages show on it.",
      },
      {
        id: "on-cue-signals",
        name: "On-cue signals",
        forWhat: "Tells other machines what is on air, so graphics or lights can change by themselves when a row goes on air.",
        steps: [
          "Open the menu (☰) and choose **On-cue signals**.",
          "Type up to five web addresses, one per line. Each time a row goes on air, OpenCall visits them and says what is on air and what is next.",
          "Press **Save**, then **Send a test** to check it works. **Recent** lists what was sent and whether it arrived.",
        ],
        who: EDITORS,
        good: "Equipment at the venue can instead ask OpenCall what is on air, using the address at the bottom of the panel and a view-only link's code.",
      },
      {
        id: "output",
        name: "Export PDF, Print and Export CSV",
        forWhat: "Gets the run sheet out of OpenCall — on paper, as a PDF, or as a spreadsheet file.",
        how: "Open the menu (☰) and choose **Export PDF**, **Print** or **Export CSV** under Output. Untick **Include my ink** for a clean copy without your scribbles.",
        good: "Every column is included, however narrow your window is. Every printed page has the show's name at the top and \"Page 3 of 7\" at the bottom, and a heading is never left alone at the foot of a page.",
      },
      {
        id: "old-guest-links",
        name: "Older guest links",
        forWhat: "Guest links handed out before view-only links existed still open the sheet.",
        how: "They are listed in the **View-only links** panel. Press **Turn off** twice to close one (the first press asks if you are sure).",
        who: CALLER,
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "together",
    title: "Working together",
    items: [
      {
        id: "presence",
        name: "Who else is here",
        forWhat: "Shows who else has the sheet open, so two people do not type in the same cell.",
        how: "Small coloured circles with initials sit at the top right. Point at one to see the name and where they are. A cell someone is typing in has an outline in their colour.",
        good: "Crew on view-only links are not shown here — see **View-only links** for them.",
      },
      {
        id: "edit-lock",
        name: "Start editing, Done editing, Take over",
        forWhat: "On the edit page, only one person changes the sheet at a time, so changes never clash.",
        steps: [
          "Press **Start editing** to take the sheet.",
          "Press **Done editing** when you finish, so somebody else can.",
          "If the person editing has gone quiet, **Take over** appears.",
        ],
        who: EDITORS,
        good: "Running the show is never locked.",
      },
      {
        id: "notes",
        name: "Notes from the crew",
        forWhat: "Lets crew flag a problem on a row — a spelling mistake, a missing shot — without a radio call.",
        steps: [
          "Tap the row you mean.",
          "Press **✎ Notes**, add a line if you like, and press **Raise note**.",
          "The Showcaller sees a number on the row and on the **Notes** button, and can jump to the row.",
          "When it is sorted, they press **Resolve**.",
        ],
        who: "Anyone who can read the sheet can raise a note.",
        good: "Notes are kept after they are dealt with, for the debrief.",
      },
      {
        id: "live-together",
        name: "Every screen follows",
        forWhat: "Keeps everyone on the same page, literally.",
        how: "Nothing to press. Changes, the live cue, the walkthrough and stage messages reach every screen within a moment.",
        good: "If a screen loses its connection, it keeps showing the last thing it knew and catches up when it reconnects.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "history",
    title: "History and safety",
    items: [
      {
        id: "version-history",
        name: "Version history",
        forWhat: "Saved copies of the sheet you can go back to.",
        steps: [
          "Open the menu (☰) and choose **Version history**.",
          "Press **Save version now** to keep a copy yourself.",
          "On any version, press **What would restoring this undo?** to see exactly what would change.",
          "Press **Restore here** to put the sheet back (press twice to be sure), or **Restore as copy** to make a new show from it.",
        ],
        who: EDITORS,
        good: "A version is saved by itself when a show starts, before an import, and before every change an AI assistant makes. **Download as-run report (CSV)** gives a list of what went on air and when.",
      },
      {
        id: "changes",
        name: "Changes",
        forWhat: "A list of every change to the sheet — who made it, when, and what it did.",
        steps: [
          "Open the menu (☰) and choose **Changes**.",
          "Open any line to see every field it changed, before and after.",
          "Press **Undo just this change** to take back that one change and keep everything since — or **Restore to just before this** to put the whole sheet back.",
        ],
        who: EDITORS,
        good: "An undo is listed too, and can itself be undone.",
      },
      {
        id: "no-delete-live",
        name: "Strike instead of delete",
        forWhat: "Keeps the record of what happened during a show.",
        how: "While a show is live, Delete is not offered. Strike the row instead — it stays on the sheet with a line through it.",
      },
      {
        id: "left-running",
        name: "Left running",
        forWhat: "Catches a show nobody stopped.",
        how: "Nothing to press. After six hours with no change the dashboard says **left running**. After a whole day, the show ends itself.",
      },
      {
        id: "sheet-wont-load",
        name: "When a sheet will not open",
        forWhat: "Explains, in plain words, why a sheet is not loading.",
        how: "A strip at the bottom says what went wrong, with **Details**, **Copy** and **Retry**. Press **Retry** first. If it still fails, press **Copy** and send the text to whoever looks after OpenCall.",
        good: "The problem is also written to the error log by itself.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "ai",
    title: "AI assistant",
    intro: [
      "You can let an AI assistant, such as Claude, read your run sheets and — if you say so — change them for you. For example: “Make every Sponsor A read 30 seconds long.”",
    ],
    items: [
      {
        id: "connect-assistant",
        name: "Connect an assistant",
        forWhat: "Links your AI assistant to your OpenCall account.",
        steps: [
          "Open the menu (☰), choose **My account**, and find **AI assistants**. Copy the web address shown there.",
          "In Claude, add a custom connector (Claude's name for a link to another app) and paste that address.",
          "Claude sends you to an OpenCall page that lists what it is asking to do. Untick anything you do not want, then press **Allow**.",
        ],
        who: "Anyone with an account. It can only reach the sheets your own account can.",
      },
      {
        id: "assistant-permissions",
        name: "What the assistant may do",
        forWhat: "You decide how much the assistant is trusted with.",
        steps: [
          "**Read your run sheets** — see the shows you can open, with their times and every column.",
          "**Change your run sheets** — change words, lengths and times, and add, move, strike or delete rows. Offered to a System Administrator, Showcaller or Producer.",
          "**Read the error log** and **Mark fixed errors as resolved** — only offered to a System Administrator.",
        ],
        good: "It can never start, step or stop a show. While a show is live it can only change words and strike rows. It leaves a sheet alone while someone else is editing it, and never changes a locked row.",
      },
      {
        id: "assistant-preview",
        name: "Look before it changes",
        forWhat: "Lets the assistant try a change on a copy first and tell you what would happen.",
        how: "For bigger changes — more than one row, times or lengths, moving or deleting — the assistant is told to try it on a copy first and check with you.",
        good: "After every change it tells you exactly what changed and gives a link to undo it.",
      },
      {
        id: "assistant-safety",
        name: "Undoing an assistant's change",
        forWhat: "Puts things right if the assistant gets something wrong.",
        how: "Before every change, the sheet as it was is saved in **Version history**, marked **AI**. Each change is also a line in **Changes**, where **Undo just this change** takes it back.",
      },
      {
        id: "disconnect-assistant",
        name: "Disconnect",
        forWhat: "Stops an assistant reaching your sheets.",
        how: "Go to **My account** → **AI assistants** and press **Disconnect** beside it. It stops at once.",
        good: "Changing your password disconnects every assistant too.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "admin",
    title: "Admin",
    intro: ["These pages are in the menu (☰) on the dashboard, under **Admin** (or **Company**)."],
    items: [
      {
        id: "users-access",
        name: "Users & access",
        forWhat: "Lists the people who can sign in, and what each one can open.",
        steps: [
          "Press **+ User**, type a name and email, and press **Create account**.",
          "Press **Change access** beside anyone to give or take away a company or an event, then **Save access**.",
          "Press **Delete** to remove someone.",
        ],
        who: "A System Administrator sees everyone. A company sees and manages its own people.",
      },
      {
        id: "invite",
        name: "Invite someone",
        forWhat: "Sends someone an email so they can set up their own account.",
        steps: [
          "On **Users & access**, find **Invite someone**.",
          "Type their email, choose what **They may open** — for example Producer for one event — and press **Send invitation**.",
          "Or press **Copy link** and send the invitation yourself.",
        ],
        good: "People who have not joined yet are listed under **Invited, not joined yet**.",
      },
      {
        id: "kinds-of-show",
        name: "Kinds of show",
        forWhat: "Lists the kinds of show and how each one can end, and lets a company add its own.",
        steps: [
          "Open **Kinds of show** from the menu.",
          "Under **Add a kind of show**, give it a name and choose **How it ends** — for example “Win, lose or draw”.",
          "If it has an extra period, say what your sheets call it.",
        ],
        good: "The page also lists every imported sheet, with the original file to download.",
      },
      {
        id: "error-log",
        name: "Error log",
        forWhat: "A list of everything that has gone wrong, so it can be fixed.",
        how: "Open **Error log** from the menu. **Refresh** reads it again. **Show resolved** shows errors already fixed, with what fixed them. **Clear log** empties it — press it twice, because it can't be undone.",
        who: "Only a System Administrator.",
      },
      {
        id: "account-activity",
        name: "Account activity",
        forWhat: "A record of sign-ins, password changes, invitations, access changes and deletions — who, when, and from where.",
        how: "Open **Account activity** from the menu.",
        who: "Only a System Administrator.",
        good: "Old records are cleared on a schedule: failed sign-ins after 90 days, the rest after two years.",
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: "more-help",
    title: "Getting more help",
    items: [
      {
        id: "report-problem",
        name: "Report a problem",
        forWhat: "Gets something that is broken in front of the person who can fix it.",
        steps: [
          "Write down what you pressed, what you expected, and what happened instead.",
          "Note the version number at the bottom right of the dashboard (scroll to the end of the page).",
          "Send it to your System Administrator.",
        ],
        good: "Many errors are written to the error log by themselves, so the details may already be waiting there.",
      },
      {
        id: "tooltips",
        name: "Point to explain",
        forWhat: "Explains any button where you are, without leaving the page.",
        mouse: "Point at a button and wait a moment. A short explanation appears.",
        keys: "Press `Tab` to move to a button; the explanation appears for that one too.",
      },
    ],
  },
];

export const SHORTCUTS: Shortcut[] = [
  { keys: "`Space`", does: "Next item", where: "Show page, live show (not while typing)" },
  { keys: "`Shift+Space`", does: "Back one item", where: "Show page, live show (not while typing)" },
  { keys: "`Cmd+K`", does: "Jump to a row", where: "Any run sheet" },
  { keys: "`Cmd+Shift+F`", does: "Find and replace", where: "Any run sheet" },
  { keys: "`Cmd+Z`", does: "Undo", where: "Editing a sheet" },
  { keys: "`Cmd+Shift+Z`", does: "Redo", where: "Editing a sheet" },
  { keys: "Arrow keys", does: "Move the blue box one cell", where: "Editing a sheet" },
  { keys: "`Cmd` + arrow", does: "Jump to the end of the filled cells, or the next filled cell", where: "Editing a sheet" },
  { keys: "`Cmd+K`, then a word", does: "Do something: start, prompter, add row, version, help…", where: "Any run sheet" },
  { keys: "`Shift+F10`", does: "Open the row menu", where: "Editing a sheet, with a cell picked" },
  { keys: "`Shift` + arrow", does: "Pick a block of cells", where: "Editing a sheet" },
  { keys: "Any letter", does: "Replace the cell with what you type", where: "Editing a sheet" },
  { keys: "`Enter` or `F2`", does: "Open the cell as it is", where: "Editing a sheet" },
  { keys: "`Enter`", does: "Save and move down (adds a row on the last row)", where: "Inside a cell" },
  { keys: "`Tab`", does: "Save and move right", where: "Inside a cell, or on the blue box" },
  { keys: "`Shift+Tab`", does: "Save and move left", where: "Inside a cell, or on the blue box" },
  { keys: "`Shift+Enter`", does: "New line inside the cell", where: "Inside a cell" },
  { keys: "`Esc`", does: "Close the cell, menu or panel", where: "Anywhere" },
  { keys: "`Cmd+C`", does: "Copy the picked cells", where: "Editing a sheet" },
  { keys: "`Cmd+X`", does: "Cut the picked cells", where: "Editing a sheet" },
  { keys: "`Cmd+V`", does: "Paste cells from Google Sheets or Excel", where: "Editing a sheet" },
  { keys: "`Cmd+D`", does: "Fill down", where: "Editing a sheet" },
  { keys: "`Delete`", does: "Empty the picked cells", where: "Editing a sheet" },
  { keys: "`↑` `↓`", does: "Move through the row menu", where: "Row menu open" },
  { keys: "`Space`", does: "Start or stop scrolling", where: "Prompter" },
  { keys: "`↑` `↓`", does: "Slower or faster", where: "Prompter" },
  { keys: "`+` `−`", does: "Bigger or smaller words", where: "Prompter" },
];

export const GESTURES: Gesture[] = [
  { gesture: "Press and hold a row (half a second)", does: "Opens the row menu", where: "Phone and iPad" },
  { gesture: "Tap Sheet, Timer or Notes at the bottom", does: "Switches between the run sheet, the big timer and notes", where: "Crew on a phone" },
  { gesture: "Pinch with two fingers", does: "Zooms in to make things bigger", where: "Every page — except the show page while a show is live, so a stray pinch can't hide the controls" },
  { gesture: "Tap a row number", does: "Picks the row; more taps add or remove rows", where: "Phone and iPad" },
  { gesture: "Double-tap a cell", does: "Opens the cell to type in", where: "iPad and other tablets" },
  { gesture: "Tap a row during a walkthrough", does: "Walks the crew to that row", where: "Show page, before the show" },
  { gesture: "Scroll the sheet", does: "Reads ahead; press Sync Cue to follow the show again", where: "Any run sheet" },
  { gesture: "Draw with a finger", does: "Draws ink, once Ink and Finger are on", where: "iPad" },
  { gesture: "Tap the sheet name", does: "Back to the dashboard", where: "Phone" },
];
