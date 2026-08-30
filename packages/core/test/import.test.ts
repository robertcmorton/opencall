import { describe, expect, it } from "vitest";
import { defaultViewColumns } from "../src/eventTypes";
import { PROMPTER_COLOR, buildSheet, classifySheet, looksLikeBotchedValue, findCueTypeColumn, PROMPTER_TAG, classifyRows, detectHeaderRow, detectOutcomes, detectRoles, detectBlocks, findRoleColumn, foldWrappedHeader, mapColumns, reclaimRowsAboveHeader, splitRunTogetherHeadings, mergeWrappedRows, parseDurationLoose, parseTimeLoose, planImport, suggestDurationFix, suggestTimeFix, UNPARSED_DURATION_KEY } from "../src/import";

describe("parseDurationLoose", () => {
  it("parses worded durations", () => {
    expect(parseDurationLoose("3 mins")).toBe(180);
    expect(parseDurationLoose("1min 27 secs")).toBe(87);
    expect(parseDurationLoose("30 secs")).toBe(30);
    expect(parseDurationLoose("15 seconds")).toBe(15);
    expect(parseDurationLoose("2min 10 secs")).toBe(130);
    expect(parseDurationLoose("0mins")).toBe(0);
    expect(parseDurationLoose("2 hrs")).toBe(7200);
  });
  it("parses colon forms incl. spreadsheet oddities", () => {
    expect(parseDurationLoose("0:90:00")).toBe(90 * 60); // 90-minute leak
    expect(parseDurationLoose("0:90:00 am")).toBe(90 * 60); // AM/PM leak
    expect(parseDurationLoose("08:00")).toBe(480);
    expect(parseDurationLoose("1:30")).toBe(90);
    expect(parseDurationLoose("0:01:30")).toBe(90);
  });
  it("keeps shorthand working and rejects garbage", () => {
    expect(parseDurationLoose("1m30s")).toBe(90);
    expect(parseDurationLoose("90")).toBe(90);
    expect(parseDurationLoose("Sau")).toBeNull();
    expect(parseDurationLoose("")).toBeNull();
  });
});

describe("parseTimeLoose", () => {
  it("parses real-world time formats", () => {
    expect(parseTimeLoose("5:00:00PM")).toBe(17 * 3600);
    expect(parseTimeLoose("6:00:00 pm")).toBe(18 * 3600);
    expect(parseTimeLoose("16:00:00")).toBe(16 * 3600);
    expect(parseTimeLoose("4:30pm")).toBe(16.5 * 3600);
    expect(parseTimeLoose("0900")).toBe(9 * 3600);
    expect(parseTimeLoose("1615")).toBe(16 * 3600 + 15 * 60);
    expect(parseTimeLoose("9am")).toBe(9 * 3600);
  });
  it("rejects garbage", () => {
    expect(parseTimeLoose("Sau")).toBeNull();
    expect(parseTimeLoose("")).toBeNull();
    expect(parseTimeLoose("9900")).toBeNull();
  });
});

// House style A: segment run sheet — ITEM | TIME | DURATION | ACTION | WHO | WHAT
const styleA: string[][] = [
  ["", "", "", "Springfield Derby — FINAL", "", ""],
  ["ITEM", "TIME", "DURATION", "ACTION", "WHO", "WHAT"],
  ["1", "3:45:00PM", "0:90:00 am", "Check Content", "", "Crew call"],
  ["2", "6:00:00 pm", "0:00:20", "Pre Record - Walk Over", "CREW", "Overlay only"],
  ["3", "7:00:00 pm", "", "TEAM LIST DUE", "", ""],
  ["", "", "", "", "", ""],
  ["4", "7:00:00 pm", "0:07:30", "House Beats", "AUDIO", "DJ tracks"],
];

// House style B: presentation grid with free-text durations and errors
const styleB: string[][] = [
  ["#", "TIME", "DURATION", "ACTIVITY", "LOCATION", "AUDIO", "BIG SCREEN", "NOTES"],
  ["1", "16:00:00", "0mins", "Gates Open", "", "", "", ""],
  ["2", "16:13:00", "1 min 30 secs", "Underscore", "Ctrl Room", "PA", "", ""],
  ["3", "Sau", "3 mins", "MC Segment 1", "FOP", "PA", "Live Vision", "typo time"],
  ["", "", "", "", "", "", "", ""],
];

// House style C: agency cue sheet — # | TIME OF DAY | ACTIVITY | DUR | SCREEN
const styleC: string[][] = [
  ["CUE SHEET", "", "", "", ""],
  ["#", "TIME OF DAY", "ACTIVITY", "DUR", "SCREEN"],
  ["21", "3:30:00 PM", "Holding Graphic", "08:00", "Holding Graphic"],
  ["24", "3:30:00 PM", "Exhibition Match Begins", "", ""],
  ["58", "4:12:00 PM", "TVC Reel 1", "02:42", "TVC Reel 1"],
];

describe("header detection & mapping", () => {
  it("finds the header row past title junk", () => {
    expect(detectHeaderRow(styleA)).toBe(1);
    expect(detectHeaderRow(styleB)).toBe(0);
    expect(detectHeaderRow(styleC)).toBe(1);
  });
  it("maps known and unknown headers", () => {
    const mapping = mapColumns(styleB[0]!);
    expect(mapping[0]).toEqual({ kind: "skip" }); // #
    expect(mapping[1]).toEqual({ kind: "start" });
    expect(mapping[2]).toEqual({ kind: "duration" });
    expect(mapping[3]).toEqual({ kind: "title" }); // ACTIVITY
    // Every header is kept VERBATIM — the rundown mirrors the sheet exactly.
    expect(mapping[4]).toEqual({ kind: "department", key: "location", title: "LOCATION" });
    expect(mapping[5]).toEqual({ kind: "department", key: "audio", title: "AUDIO" });
    expect(mapping[6]).toEqual({ kind: "department", key: "big-screen", title: "BIG SCREEN" });
  });
});

describe("row classification", () => {
  it("classifies style A: cues, milestone, spacer, duration leak", () => {
    const { rows } = planImport(styleA);
    expect(rows[0]!.kind).toBe("cue");
    expect(rows[0]!.durationSec).toBe(90 * 60);
    expect(rows[1]!.durationSec).toBe(20);
    expect(rows[2]!.kind).toBe("milestone"); // TEAM LIST DUE: time, no duration
    expect(rows[3]!.kind).toBe("spacer");
    // WHO and WHAT import as their own columns, mirroring the sheet.
    expect(rows[4]!.cells.who).toBe("AUDIO");
    expect(rows[4]!.cells.what).toBe("DJ tracks");
  });
  it("flags unparseable cells instead of dropping them (style B)", () => {
    const { rows } = planImport(styleB);
    expect(rows[0]!.kind).toBe("cue"); // "0mins" parses to 0 → cue, not milestone
    expect(rows[0]!.durationSec).toBe(0);
    const typo = rows[2]!;
    expect(typo.startSec).toBeNull();
    expect(typo.startRaw).toBe("Sau"); // preserved for the preview
    expect(typo.durationSec).toBe(180);
  });
  it("classifies style C: match-state banner is a milestone with time", () => {
    const { rows } = planImport(styleC);
    expect(rows[0]!.durationSec).toBe(480); // "08:00" = 8 minutes
    expect(rows[1]!.kind).toBe("milestone");
    expect(rows[2]!.durationSec).toBe(162);
  });
  it("drops repeated page headers from PDF extraction", () => {
    const grid = [...styleB, styleB[0]!, ["4", "17:00:00", "2 mins", "Read 1", "", "PA", "", ""]];
    const { rows } = planImport(grid);
    expect(rows.filter((r) => r.title === "ACTIVITY")).toHaveLength(0);
    expect(rows[rows.length - 1]!.title).toBe("Read 1");
  });
});

describe("classifyRows direct", () => {
  it("banner rows: title only", () => {
    const grid = [
      ["TITLE", "START", "DURATION"],
      ["MAIN SHOW", "", ""],
    ];
    const rows = classifyRows(grid, 0, mapColumns(grid[0]!));
    expect(rows[0]!.kind).toBe("banner");
  });
});

describe("untitled columns", () => {
  it("recognizes a header-less cue-type column by its data", () => {
    const grid = [
      ["#", "TIME", "", "ACTIVITY", "AUDIO"],
      ["1", "16:00:00", "VTR", "Opening Reel", ""],
      ["2", "", "PA", "Welcome Read", "PA"],
      ["3", "", "GFX", "Sponsor Graphic", ""],
    ];
    const { mapping, rows } = planImport(grid);
    expect(mapping[2]).toEqual({ kind: "department", key: "type", title: "Type" });
    expect(rows[0]!.cells.type).toBe("VTR");
  });
  it("imports other header-less columns as Column N instead of dropping them", () => {
    const grid = [
      ["TIME", "ACTIVITY", ""],
      ["16:00:00", "Doors", "escort VIPs via north gate"],
    ];
    const { mapping, rows } = planImport(grid);
    expect(mapping[2]).toEqual({ kind: "department", key: "column-3", title: "Column 3" });
    expect(rows[0]!.cells["column-3"]).toContain("escort");
  });
});

describe("column fidelity", () => {
  it("suffixes duplicate headers so no two columns share a name", () => {
    const mapping = mapColumns(["ACTIVITY", "NOTES", "NOTES"]);
    expect(mapping[1]).toEqual({ kind: "department", key: "notes", title: "NOTES" });
    expect(mapping[2]).toEqual({ kind: "department", key: "notes-2", title: "NOTES (2)" });
  });
});

describe("detectRoles", () => {
  it("mines repeated role tokens with colours, skipping times and durations", () => {
    const grid = [
      ["ACTIVITY", "TYPE", "LOCATION"],
      ["Open", "PA", "Ctrl Room"],
      ["Read", "PA", "Ctrl Room"],
      ["Reel", "VTR", "Ctrl Room"],
      ["Read 2", "PA", "16:00:00"],
      ["Reel 2", "VTR", "Ctrl Room"],
      ["Sting", "VTR", ""],
    ];
    const { rows } = planImport(grid);
    const roles = detectRoles(rows);
    const names = roles.map((r) => r.name);
    expect(names).toContain("PA");
    expect(names).toContain("VTR");
    expect(names).toContain("Ctrl Room");
    expect(names).not.toContain("16:00:00");
    expect(new Set(roles.map((r) => r.color)).size).toBe(roles.length); // distinct colours
  });
});

describe("mergeWrappedRows", () => {
  // A PDF-extracted grid: one row per visual line, items numbered in col 0,
  // wrapped cells spilling onto continuation lines.
  const pdfGrid = [
    ["ITEM", "TIME", "DURATION", "ACTION", "WHO", "WHAT"],
    ["1", "", "", "", "", "KA, Production Crew"],
    ["", "", "", "Check Content", "", "SET - Tunnel go pro"],
    ["", "3:00:00PM", "0:60:00", "", "", "CHECK - Dressing room cam"],
    ["2", "4:30:00PM", "0:15:00", "Crew arrive", "", "DJ set desk"],
    ["3", "5:45:00PM", "0:30:00", "Rehearsals", "", "- 5:45 - soundcheck"],
    ["", "", "", "", "", "- 6:00 - MC segment"],
    ["", "", "", "", "", "- 6:10 - rehearsal"],
    ["4", "6:30:00PM", "0:17:30", "Music Fill", "AUDIO", "DJ tracks"],
    ["", "", "", "", "GFX", "Holding loop"],
    ["5", "6:50:00PM", "0:01:15", "Toss seg", "JORDAN", "Pre-record"],
    ["6", "7:00:00PM", "0:01:15", "Meet seg", "JORDAN", "Pre-record"],
  ];

  it("merges continuation lines into one row per numbered item", () => {
    const { grid, rows } = planImport(pdfGrid, { mergeWrapped: true });
    // 6 items → 6 data rows (plus the header).
    expect(grid.length).toBe(7);
    const importable = rows.filter((r) => r.kind !== "spacer");
    expect(importable.length).toBe(6);
    // Item 1's title came from a continuation line; its time from another.
    expect(importable[0]!.title).toBe("Check Content");
    expect(importable[0]!.startSec).toBe(15 * 3600);
    expect(importable[0]!.cells["what"]).toContain("Tunnel go pro");
    // Item 3's wrapped WHAT lines all merged (times inside stay in WHAT).
    expect(importable[2]!.cells["what"]!.split("\n").length).toBe(3);
    expect(importable[2]!.startSec).toBe(17 * 3600 + 45 * 60);
    // No empty shell rows between items.
    expect(importable.every((r) => r.title || r.cells["what"])).toBe(true);
  });

  it("leaves grids without a credible item-number column untouched", () => {
    const grid = [
      ["TIME", "ACTIVITY"],
      ["16:00:00", "Doors"],
      ["16:30:00", "Show"],
    ];
    expect(mergeWrappedRows(grid, 0)).toBe(grid);
  });

  it("identifies the sheet's own role column and mines roles from it alone", () => {
    const { headers, mapping, roleColumnKey, rows } = planImport(pdfGrid, { mergeWrapped: true });
    expect(roleColumnKey).toBe(findRoleColumn(headers, mapping));
    expect(roleColumnKey).toBe("who");
    const roles = detectRoles(rows.filter((r) => r.kind !== "spacer"), 12, roleColumnKey);
    const names = roles.map((r) => r.name);
    expect(names).toContain("JORDAN");
    // "DJ tracks" lives in WHAT — never a role when the sheet has a WHO column.
    expect(names.every((n) => !n.includes("tracks"))).toBe(true);
  });
});

describe("mergeWrappedRows with ruled-line boundaries", () => {
  // Row layout (page 0, y descending). Rules at 100/88/50/38/26:
  //   [100..88]  item 1 (one line)
  //   [88..50]   item 2 — tall: number on its 2nd line, 2 more lines BELOW
  //              the midpoint to item 3 (previously mis-attached forward)
  //   [50..38]   an unnumbered ALL-CAPS banner row (its own row)
  //   [38..26]   item 3 (one line)
  const grid = [
    ["ITEM", "TIME", "ACTION", "WHAT"],
    ["1", "5:00:00PM", "Open", "walk in"],          // y 94
    ["", "", "", "wrapped a"],                       // y 82
    ["2", "5:10:00PM", "Long segment", "wrapped b"], // y 74
    ["", "", "", "wrapped c"],                       // y 62
    ["", "", "", "wrapped d"],                       // y 54  (nearer item 3's line!)
    ["", "", "MAIN SHOW", ""],                       // y 44  banner band
    ["3", "5:30:00PM", "Kick", "boom"],              // y 32
    ["4", "5:40:00PM", "A", ""],                     // pad to reach the ≥5 integers bar
    ["5", "5:41:00PM", "B", ""],
    ["6", "5:42:00PM", "C", ""],
    ["7", "5:43:00PM", "D", ""],
  ];
  const lineMeta = [
    { page: 0, y: 200 },
    { page: 0, y: 94 },
    { page: 0, y: 82 },
    { page: 0, y: 74 },
    { page: 0, y: 62 },
    { page: 0, y: 54 },
    { page: 0, y: 44 },
    { page: 0, y: 32 },
    { page: 0, y: 20 },
    { page: 0, y: 16 },
    { page: 0, y: 12 },
    { page: 0, y: 8 },
  ];
  const rowLines = [{ page: 0, ys: [100, 88, 50, 38, 26] }];

  it("groups by physical row, keeps unnumbered banner rows, preserves order", () => {
    const merged = mergeWrappedRows(grid, 0, lineMeta, rowLines);
    // header + item1 + item2 + banner + items 3..7
    expect(merged.length).toBe(9);
    expect(merged[2]![3]).toBe("wrapped a\nwrapped b\nwrapped c\nwrapped d"); // ALL of item 2's lines
    expect(merged[3]![2]).toBe("MAIN SHOW"); // banner survives as its own row, in place
    expect(merged[4]![0]).toBe("3");
    expect(merged[4]![3]).toBe("boom"); // nothing leaked into item 3
  });

  it("still classifies the banner as a section after the merge", () => {
    const { rows } = planImport(grid, { mergeWrapped: true, lineMeta, rowLines });
    const banner = rows.find((r) => r.title === "MAIN SHOW");
    expect(banner?.kind).toBe("banner");
  });
});

describe("mergeWrappedRows: ruled sub-rows inside one item", () => {
  // Sheets rule the WHO/WHAT lines INSIDE a merged item: bands without a
  // number that carry data-column content join the item above; only
  // title-only bands stay standalone.
  const grid = [
    ["ITEM", "TIME", "ACTION", "WHO", "WHAT"],
    ["1", "6:30:00PM", "Music Fill", "AUDIO", "track list"],  // y 94
    ["", "", "", "GFX", "holding loop"],                       // y 82 — own band!
    ["", "", "", "GFX", "title card"],                         // y 70 — own band!
    ["2", "6:50:00PM", "Toss seg", "HOST", "prerecord"],       // y 58
    ["3", "6:55:00PM", "A", "", ""],
    ["4", "6:56:00PM", "B", "", ""],
    ["5", "6:57:00PM", "C", "", ""],
  ];
  const lineMeta = [
    { page: 0, y: 200 },
    { page: 0, y: 94 },
    { page: 0, y: 82 },
    { page: 0, y: 70 },
    { page: 0, y: 58 },
    { page: 0, y: 46 },
    { page: 0, y: 34 },
    { page: 0, y: 22 },
  ];
  // Rules split item 1 into three inner sub-rows.
  const rowLines = [{ page: 0, ys: [100, 88, 76, 64, 52, 40, 28, 16] }];

  it("joins ruled sub-rows to the item above them", () => {
    const { rows } = planImport(grid, { mergeWrapped: true, lineMeta, rowLines });
    const item1 = rows.find((r) => r.title === "Music Fill");
    expect(item1?.cells.who).toBe("AUDIO\nGFX\nGFX");
    expect(item1?.cells.what).toBe("track list\nholding loop\ntitle card");
    const item2 = rows.find((r) => r.title === "Toss seg");
    expect(item2?.cells.who).toBe("HOST");
  });
});

describe("unparseable-cell repair suggestions", () => {
  it("repairs common time typos", () => {
    expect(suggestTimeFix("19h30")).toBe("19:30");
    expect(suggestTimeFix("7;30 pm")).toBe("7:30 pm");
    expect(suggestTimeFix("TBC 7:30pm approx")).toBe("7:30 pm");
    expect(suggestTimeFix("730pm")).toBe("7:30 pm");
    expect(suggestTimeFix("Sau")).toBeNull();
    expect(suggestTimeFix("16:00:00")).toBeNull(); // already parses — nothing to fix
  });
  it("repairs common duration typos", () => {
    expect(suggestDurationFix("2.30")).toBe("2:30");
    expect(suggestDurationFix("approx 5 mins TBC")).toBe("5 mins");
    expect(suggestDurationFix("¬5¬")).toBe("5:00"); // bare number = minutes
    expect(suggestDurationFix("1m30s")).toBeNull(); // already parses
  });
});

describe("parseDurationLoose summed parts", () => {
  it("sums plus-joined durations", () => {
    expect(parseDurationLoose("40mins + 3mins")).toBe(43 * 60);
    expect(parseDurationLoose("1 hr + 15 mins")).toBe(75 * 60);
    expect(parseDurationLoose("5 + banana")).toBeNull();
  });
});

describe("detectOutcomes", () => {
  const row = (title: string): import("../src/import").ClassifiedRow => ({
    kind: "cue",
    title,
    startSec: null,
    startRaw: null,
    durationSec: null,
    durationRaw: null,
    cells: {},
    sourceIndex: 0,
  });

  it("tags ending blocks from their banners, draw-at-fulltime as golden", () => {
    const rows = [
      row("Kick off"),
      row("Fulltime - HOME TEAM WIN"),
      row("Celebration"),
      row("Fulltime - HOME TEAM LOSE"),
      row("Wrap"),
      row("Full Time (DRAW)"),
      row("GOLDEN POINT Kick off"),
      row("GP Try"),
    ];
    detectOutcomes(rows);
    expect(rows.map((r) => r.outcome ?? null)).toEqual([null, "win", "win", "lose", "lose", "golden", "golden", "golden"]);
  });

  it("leaves sheets without ending banners untouched", () => {
    const rows = [row("Walk in"), row("Anthem"), row("Full time siren")];
    detectOutcomes(rows);
    expect(rows.every((r) => !r.outcome)).toBe(true);
  });
});

describe("centred department headers", () => {
  it("gives an anonymous data band the sheet's own column name", () => {
    // A NOTES header sits in its own band while the note text lands one band
    // to the left — the PDF layout case that imports "Column 7" beside an
    // empty "NOTES".
    const grid: string[][] = [
      ["ITEM", "TIME", "ACTION", "", "NOTES"],
      ...Array.from({ length: 20 }, (_, i) => [
        String(i + 1),
        `1${String(i).padStart(2, "0")}0`,
        `Cue ${i + 1}`,
        i % 3 === 0 ? `note ${i}` : "",
        "",
      ]),
    ];
    const { mapping } = planImport(grid);
    const notes = mapping
      .map((t, i) => ({ t, i }))
      .filter((x) => x.t.kind === "department" && (x.t as { title: string }).title === "NOTES");
    expect(notes.length).toBe(1);
    expect(notes[0]!.i).toBe(3); // the band holding the notes, not the empty header band
  });
});

// ── Import fidelity: what the sheet says is what the rundown says ─────────────
// These encode the ways a real sheet lost content on the way in. The fixtures
// are synthetic — shaped like production sheets, carrying none of their text.

describe("buildSheet fidelity", () => {
  /** A cue sheet with the shape that broke: ITEM/TIME/DUR/SCR/ACTION/WHO/NOTES. */
  const sheet = (): string[][] => [
    ["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO", "NOTES", ""],
    ["1", "17:15:00", "", "", "GATES", "", "", ""],
    ["2", "17:15:00", "01:00", "VTR", "HOLDING", "", "", "00:00"],
    ["3", "17:16:00", "00:30", "", "WELCOME", "GH", "arrive 1pm", "00:15"],
    ["4", "17:16:30", "00:30", "GFX", "PARTNER CARD", "", "check content", "00:45"],
    ["5", "", "Fullback", "1", "A. Player", "", "", ""],
    ["6", "", "Interchange", "", "", "", "", ""],
    ["7", "17:17:00", "00:45", "GFX", "TEAM READ", "GH", "", "01:15"],
  ];
  const build = (grid: string[][]) => buildSheet(planImport(grid));

  it("keeps every numbered row, with the sheet's own numbering", () => {
    const built = build(sheet());
    expect(built.rows.map((r) => r.sourceNumber)).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("carries times, durations and cells across unchanged", () => {
    const row = build(sheet()).rows.find((r) => r.sourceNumber === "3")!;
    expect(row.hardStartSec).toBe(17 * 3600 + 16 * 60);
    expect(row.durationSec).toBe(30);
    expect(row.cells?.who).toBe("GH");
    expect(row.cells?.notes).toBe("arrive 1pm");
  });

  it("keeps the sheet's headings and its left-to-right column order", () => {
    const built = build(sheet());
    expect(built.baseTitles).toEqual({ title: "ACTION", start: "TIME", duration: "DUR" });
    expect(built.columnOrder.indexOf("start")).toBeLessThan(built.columnOrder.indexOf("duration"));
    expect(built.columnOrder.indexOf("duration")).toBeLessThan(built.columnOrder.indexOf("title"));
    expect(built.columnOrder.indexOf("title")).toBeLessThan(built.columnOrder.indexOf("notes"));
  });

  it("keeps text a structural column cannot hold, instead of dropping it", () => {
    // "Fullback" sits in the DUR column of a team list. It is not a duration,
    // and it used to vanish; now it lands beside the column it came from.
    const built = build(sheet());
    const row = built.rows.find((r) => r.sourceNumber === "5")!;
    expect(row.cells?.[UNPARSED_DURATION_KEY]).toBe("Fullback");
    expect(built.columns.some((c) => c.key === UNPARSED_DURATION_KEY)).toBe(true);
    expect(built.columnOrder).toContain(UNPARSED_DURATION_KEY);
  });

  it("keeps an untitled column whose data starts far down the sheet", () => {
    // A countdown column that is blank for the first pages was sampled as empty
    // and dropped; identification now reads the whole sheet.
    const grid = sheet();
    const late = [["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO", "NOTES", ""]];
    for (let i = 1; i <= 80; i++) late.push([String(i), "17:15:00", "00:30", "", `ITEM ${i}`, "", "", ""]);
    late.push(["81", "17:20:00", "00:30", "", "LATE", "", "", "05:00"]);
    const built = buildSheet(planImport(late));
    expect(built.rows[80]!.cells?.["column-8"]).toBe("05:00");
    void grid;
  });

  it("drops a right-hand column that only mirrors row numbers", () => {
    const grid = [
      ["ITEM", "TIME", "DUR", "ACTION", ""],
      ["1", "17:15:00", "00:30", "ONE", "1"],
      ["2", "17:15:30", "00:30", "TWO", "2"],
      ["3", "17:16:00", "00:30", "THREE", "3"],
    ];
    const built = buildSheet(planImport(grid));
    expect(built.columns.map((c) => c.key)).not.toContain("column-5");
  });
});

describe("script detection", () => {
  // A run sheet marks the words a presenter says by setting them in italic.
  const sheet = (): string[][] => [
    ["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO"],
    ["1", "19:00:00", "01:00", "CAM", "WELCOME", "LC"],
    ["2", "", "", "", "Ladies and gentlemen, please welcome to the field a proud son of this club,", ""],
    ["3", "", "", "", "a premiership winner and a true champion of the game.", ""],
    ["4", "", "", "TRK", "WALK-ON MUSIC - EDIT 2", ""],
    ["5", "", "", "", "LX - STAGE LIGHTS TO FULL", ""],
    ["6", "19:02:00", "00:30", "VTR", "SPONSOR REEL", ""],
    ["7", "19:02:30", "00:30", "GFX", "SCORE BUG", ""],
    ["8", "19:03:00", "00:20", "LED", "CROWD PROMPT", ""],
    ["9", "19:03:20", "00:10", "CAM", "WIDE SHOT", ""],
  ];
  const italics = [
    "Ladies and gentlemen, please welcome to the field a proud son of this club,",
    "a premiership winner and a true champion of the game.",
    "WALK-ON MUSIC - EDIT 2",
  ];
  const build = () => buildSheet(planImport(sheet(), { italicText: italics }));

  it("marks italic sentences as script", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), italics);
    expect(rows.filter((r) => r.script).map((r) => r.sourceNumber)).toEqual(["2", "3"]);
  });

  it("does not mark an italic LABEL — a track name is not a read", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), italics);
    expect(rows.find((r) => r.sourceNumber === "4")?.script).toBeFalsy();
  });

  it("does not mark an all-caps instruction, however long", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), italics);
    expect(rows.find((r) => r.sourceNumber === "5")?.script).toBeFalsy();
  });

  it("marks nothing at all when the source carries no italics", () => {
    const rows = classifySheet(sheet(), 0, mapColumns(sheet()[0]!, sheet().slice(1)), undefined);
    expect(rows.some((r) => r.script)).toBe(false);
  });

  it("tags script rows in the sheet's own cue column", () => {
    const built = build();
    const tagged = built.rows.filter((r) => r.cells?.scr === PROMPTER_TAG);
    expect(tagged.map((r) => r.sourceNumber)).toEqual(["2", "3"]);
  });

  it("never overwrites a cue the sheet already gave a row", () => {
    const built = build();
    expect(built.rows.find((r) => r.sourceNumber === "1")?.cells?.scr).toBe("CAM");
    expect(built.rows.find((r) => r.sourceNumber === "4")?.cells?.scr).toBe("TRK");
  });

  it("keeps a read as a row, not a section header", () => {
    // Text-only rows classify as banners; a read rendered as a grey heading is
    // both wrong to look at and loses the cells the marker lives in.
    expect(build().rows.filter((r) => r.sourceNumber === "2")[0]?.type).toBe("cue");
  });

  it("finds the cue column by its contents, not its name", () => {
    const grid = sheet();
    const mapping = mapColumns(grid[0]!, grid.slice(1));
    expect(findCueTypeColumn(mapping, classifySheet(grid, 0, mapping))).toBe("scr");
  });
});

describe("looksLikeBotchedValue", () => {
  it("treats a label in a time column as content, not an error", () => {
    // A team list puts positions in the duration column; a pre-show row says
    // TBC. The sheet is right — there is nothing for anyone to fix.
    for (const v of ["Interchange", "Head Coach", "Fullback", "Second Row", "TBC", "Assistant Coach"]) {
      expect(looksLikeBotchedValue(v)).toBe(false);
    }
  });

  it("still flags a value that was reaching for a time or duration", () => {
    for (const v of ["7.3O pm", "0:9O:00", "2 mins x", "12:", "1030hrs?"]) {
      expect(looksLikeBotchedValue(v)).toBe(true);
    }
  });
});

describe("roles from every column that assigns work", () => {
  const grid = (): string[][] => [
    ["ITEM", "TIME", "DUR", "SCR", "ACTION", "WHO"],
    ["1", "19:00:00", "00:30", "VTR", "SPONSOR REEL", "GH"],
    ["2", "19:00:30", "00:30", "GFX", "SCORE BUG", "LC"],
    ["3", "19:01:00", "00:20", "LED", "CROWD PROMPT", "GH"],
    ["4", "19:01:20", "00:10", "CAM", "WIDE SHOT", "LC JM"],
    ["5", "19:01:30", "00:30", "VTR", "HIGHLIGHTS", "cue DP"],
    ["6", "19:02:00", "00:30", "GFX", "TEAM LIST", "DP cue"],
  ];
  const built = () => buildSheet(planImport(grid()));

  it("finds the people AND the positions that run the show", () => {
    const names = built().roles.map((r) => r.name);
    for (const expected of ["GH", "LC", "DP", "VTR", "GFX"]) expect(names).toContain(expected);
  });

  it("reports both columns as places an assignment is recorded", () => {
    expect(built().roleColumnKeys).toEqual(expect.arrayContaining(["who", "scr"]));
  });

  it("makes the prompter a role, however the sheet said so", () => {
    // Recognised from its formatting rather than written in the cue column —
    // the tag is added after role detection has run, so the same job would
    // otherwise be a role on one sheet and not on another.
    const withScript = grid();
    withScript.push(["7", "", "", "", "Ladies and gentlemen, please welcome our guest tonight.", ""]);
    const b = buildSheet(planImport(withScript, { italicText: ["Ladies and gentlemen, please welcome our guest tonight."] }));
    expect(b.rows.some((r) => r.cells?.scr === PROMPTER_TAG)).toBe(true);
    expect(b.roles.map((r) => r.name.toLowerCase())).toContain(PROMPTER_TAG);
  });

  it("gives the prompter the same colour wherever it lands", () => {
    const withScript = grid();
    withScript.push(["7", "", "", "", "Ladies and gentlemen, please welcome our guest tonight.", ""]);
    const b = buildSheet(planImport(withScript, { italicText: ["Ladies and gentlemen, please welcome our guest tonight."] }));
    expect(b.roles.find((r) => r.name.toLowerCase() === PROMPTER_TAG)?.color).toBe(PROMPTER_COLOR);
  });
});

describe("outcome branches on a multi-game day", () => {
  // Two games in one sheet, each with its own endings.
  const grid = (): string[][] => [
    ["ITEM", "TIME", "DUR", "ACTION"],
    ["1", "13:00:00", "40:00", "GAME ONE - Kick off"],
    ["2", "", "", "FULLTIME - HOME WIN"],
    ["3", "", "", "Winners presentation"],
    ["4", "", "", "FULLTIME - HOME LOSE"],
    ["5", "", "", "Commiserations read"],
    ["6", "15:00:00", "", "Between games - crowd entertainment"],
    ["7", "16:00:00", "40:00", "GAME TWO - Kick off"],
    ["8", "", "", "FULLTIME - HOME WIN"],
    ["9", "", "", "Winners presentation two"],
    ["10", "", "", "FULLTIME - HOME LOSE"],
    ["11", "", "", "Commiserations read two"],
  ];
  const rows = () => planImport(grid()).rows;

  it("does not tag the rest of the day with the first game's ending", () => {
    // "Between games - filler" sits after game one's branches and is nobody's ending.
    const filler = rows().find((r) => r.sourceNumber === "6")!;
    expect(filler.outcome).toBeFalsy();
  });

  it("numbers each game's endings separately", () => {
    const r = rows();
    expect(r.find((x) => x.sourceNumber === "2")?.outcomeGame).toBe(1);
    expect(r.find((x) => x.sourceNumber === "3")?.outcomeGame).toBe(1);
    expect(r.find((x) => x.sourceNumber === "8")?.outcomeGame).toBe(2);
    expect(r.find((x) => x.sourceNumber === "9")?.outcomeGame).toBe(2);
  });

  it("keeps win and lose apart within a game", () => {
    const r = rows();
    expect(r.find((x) => x.sourceNumber === "3")?.outcome).toBe("win");
    expect(r.find((x) => x.sourceNumber === "5")?.outcome).toBe("lose");
    expect(r.find((x) => x.sourceNumber === "9")?.outcome).toBe("win");
    expect(r.find((x) => x.sourceNumber === "11")?.outcome).toBe("lose");
  });

  it("carries the game number through to the built rows", () => {
    const built = buildSheet(planImport(grid()));
    const games = new Set(built.rows.filter((r) => r.outcome).map((r) => r.outcomeGame));
    expect(games).toEqual(new Set([1, 2]));
  });
});

describe("values that are not questions", () => {
  it("ignores a bracketed elapsed marker", () => {
    // A second clock printed beside the real times. Read as a start it would
    // put the row at twenty-five past four in the morning.
    for (const v of ["(0:00)", "(4:25)", "(14:20)"]) expect(looksLikeBotchedValue(v)).toBe(false);
  });

  it("ignores page furniture caught by the column above it", () => {
    for (const v of ["Page 1", "Page 12", "page 3"]) expect(looksLikeBotchedValue(v)).toBe(false);
  });

  it("ignores room allocations in a venue document's time column", () => {
    for (const v of ["Changeroom 3", "Radio Box No. 2", "TV Suite No. 1", "LEVEL 1 OUTLETS", "G2", "Warm-up Room 1 / 2"])
      expect(looksLikeBotchedValue(v)).toBe(false);
  });

  it("still flags anything shaped like a time someone mistyped", () => {
    for (const v of ["12:", ":30", "7.3O pm", "0:9O:00", "2 mins x", "1030hrs?", "6 mins 15 mins"])
      expect(looksLikeBotchedValue(v)).toBe(true);
  });
});

describe("what a view-only link shows by default", () => {
  const columns = [
    { key: "start", kind: "startTime" },
    { key: "dur", kind: "duration" },
    { key: "scr", kind: "richtext" },
    { key: "title", kind: "title" },
    { key: "who", kind: "richtext" },
    { key: "notes", kind: "richtext" },
  ];

  it("keeps when, what and whose job — and nothing else", () => {
    expect(defaultViewColumns(columns, ["who"])).toEqual(["start", "dur", "title", "who"]);
  });

  it("takes only the first role column when a sheet records work in several", () => {
    expect(defaultViewColumns(columns, ["who", "scr"])).toEqual(["start", "dur", "title", "who"]);
  });

  it("copes with a sheet that names no role column", () => {
    expect(defaultViewColumns(columns, [])).toEqual(["start", "dur", "title"]);
  });

  it("returns them in the sheet's own order, not the order asked for", () => {
    expect(defaultViewColumns(columns, ["who"])[0]).toBe("start");
  });
});

describe("a column that is not the sheet's numbering", () => {
  /**
   * A sheet with no column headers: the header detector settles on the title
   * block and the number-column detector then picks whichever column holds a
   * few stray digits. Two real sheets folded from ~285 rows into seven.
   */
  const headerless = (): string[][] => {
    const rows: string[][] = [["", "", "2025 SEASON — ROUND 11"]];
    for (let i = 0; i < 60; i++) {
      // A time and some text, and no numbering anywhere.
      rows.push(["", `${9 + Math.floor(i / 6)}:${String((i % 6) * 10).padStart(2, "0")}am`, `Item ${i}`]);
    }
    // Three lines that happen to hold a bare number — a stand, a camera.
    rows.push(["3", "", "Camera position"], ["4", "", "Camera position"], ["7", "", "Stand"]);
    return rows;
  };

  it("does not fold the sheet into the handful of lines that hold digits", () => {
    const built = buildSheet(planImport(headerless(), { mergeWrapped: true }));
    // Nothing like 3 rows: every timed line is its own item.
    expect(built.rows.length).toBeGreaterThan(50);
  });

  it("still merges a sheet that really does number itself", () => {
    const numbered: string[][] = [["ITEM", "TIME", "ACTION"]];
    for (let i = 1; i <= 30; i++) {
      numbered.push([String(i), `${9 + Math.floor(i / 6)}:00am`, `Item ${i}`]);
      numbered.push(["", "", `…continued line for ${i}`]); // the wrap this merge exists for
    }
    const built = buildSheet(planImport(numbered, { mergeWrapped: true }));
    expect(built.rows.length).toBe(30);
  });
});

/**
 * A blank TIME cell must not come back as a printed time.
 *
 * From a live sheet: two rows with nothing in the TIME column arrived showing
 * 7:06:00 PM, because the cascade could work out where they fell. That number
 * is indistinguishable on screen from one somebody typed, so a showcaller
 * holds a cue to a minute the document never claimed.
 *
 * The two questions had been fused into one flag. What the sheet SAYS (is
 * there a time?) is per row and universal. What the sheet MEANS (is a
 * duration spent or merely listed?) genuinely differs by sheet shape, and
 * keeps its measured test.
 */
describe("blank times are never invented, whatever shape the sheet is", () => {
  /** Densely timed — a match-day run sheet, where the chain is the point. */
  const runSheet = (): string[][] => [
    ["ITEM", "TIME", "DUR", "ACTION"],
    ["1", "18:00:00", "10:00", "First"],
    ["2", "18:10:00", "10:00", "Second"],
    ["3", "", "05:00", "Buffer with no printed time"],
    ["4", "18:25:00", "10:00", "Third"],
    ["5", "18:35:00", "10:00", "Fourth"],
    ["6", "18:45:00", "10:00", "Fifth"],
    ["7", "18:55:00", "10:00", "Sixth"],
    ["8", "19:05:00", "10:00", "Seventh"],
    ["9", "19:15:00", "10:00", "Eighth"],
    ["10", "19:25:00", "10:00", "Ninth"],
  ];

  it("marks a blank-time row untimed even on a densely timed run sheet", () => {
    const built = buildSheet(planImport(runSheet()));
    const blank = built.rows.find((r) => r.sourceNumber === "3");
    expect(blank?.untimed).toBe(true);
    expect(blank?.hardStartSec ?? null).toBeNull();
  });

  it("still SPENDS that row's duration — the running order is unchanged", () => {
    const built = buildSheet(planImport(runSheet()));
    const blank = built.rows.find((r) => r.sourceNumber === "3");
    // durationMuted is what stops a duration counting. On a run sheet it must
    // stay off, or the buffer would take no time and every later row would
    // drift five minutes early.
    expect(blank?.durationMuted).toBeUndefined();
    expect(blank?.durationSec).toBe(300);
  });

  it("leaves rows that DO carry a printed time exactly as they were", () => {
    const built = buildSheet(planImport(runSheet()));
    const timed = built.rows.find((r) => r.sourceNumber === "4");
    expect(timed?.untimed).toBeUndefined();
    expect(timed?.hardStartSec).toBe(18 * 3600 + 25 * 60);
  });
});

describe("foldWrappedHeader", () => {
  // A narrow column headed "TIME OF DAY" prints as two lines, and a PDF hands
  // them over as two. The header row is then holed exactly where the stacked
  // headings were, the column arrives unnamed, and the sheet's times are never
  // read as times.
  const stacked = [
    ["", "", "TIME OF", "", "", "", "SIDE", ""],
    ["ITEM", "FROM ZERO", "", "DURATION", "ACTIVITY", "ON SCREEN", "", "MC"],
    ["", "", "DAY", "", "", "", "PANEL", ""],
    ["1", "5:50:00", "10:15:00 AM", "0:15:00", "Crew onsite", "", "", ""],
  ];

  it("folds the lines above and below into the holes", () => {
    expect(foldWrappedHeader(stacked, 1)).toEqual({
      headers: ["ITEM", "FROM ZERO", "TIME OF DAY", "DURATION", "ACTIVITY", "ON SCREEN", "SIDE PANEL", "MC"],
      folded: [0, 2],
    });
  });

  it("folds one side when only one side wraps", () => {
    const below = [
      ["ITEM", "", "DURATION"],
      ["", "TIME", ""],
      ["1", "10:15:00 AM", "0:15:00"],
    ];
    expect(foldWrappedHeader(below, 0)).toEqual({ headers: ["ITEM", "TIME", "DURATION"], folded: [1] });
  });

  it("leaves a header alone when nothing wraps", () => {
    const plain = [
      ["ITEM", "TIME", "DURATION"],
      ["1", "10:15:00 AM", "0:15:00"],
    ];
    expect(foldWrappedHeader(plain, 0)).toEqual({ headers: ["ITEM", "TIME", "DURATION"], folded: [] });
  });

  // The guard that matters: the line under a header is USUALLY the first row of
  // the sheet, and eating it would lose a cue and shift every number after it.
  it("never eats a row of data", () => {
    const withData = [
      ["ITEM", "", "DURATION"],
      ["1", "10:15:00 AM", "0:15:00"],
    ];
    expect(foldWrappedHeader(withData, 0).folded).toEqual([]);
  });

  // The dangerous shape: a SPARSE first row, narrower than the header and
  // filling only a hole in it, so neither the width nor the collision guard
  // has anything to say. What refuses it is that a time is a value, not a
  // heading — without that, this sheet loses its first cue silently.
  it("never eats a sparse row of data that fits the holes", () => {
    const sparse = [
      ["ITEM", "", "DURATION", "ACTIVITY"],
      ["", "10:15:00 AM", "", ""],
    ];
    expect(foldWrappedHeader(sparse, 0).folded).toEqual([]);
  });

  it("refuses a neighbour that would overwrite a heading", () => {
    // "ACTIVITY" sits where the header already says "ITEM" — not a wrapped
    // heading, so nothing is folded even though the rest would fit.
    // Kept narrower than the header so the width guard cannot be what refuses
    // it — this has to be refused for colliding, not for being wide.
    const collides = [
      ["ITEM", "", "DURATION", "ACTIVITY"],
      ["TITLE", "TIME", "", ""],
    ];
    expect(foldWrappedHeader(collides, 0).folded).toEqual([]);
  });

  it("refuses a neighbour carrying as many cells as the header", () => {
    const asWide = [
      ["ITEM", "", ""],
      ["", "TIME", "DURATION"],
    ];
    expect(foldWrappedHeader(asWide, 0).folded).toEqual([]);
  });

  it("gives a wrapped time column its start mapping back", () => {
    const plan = planImport(stacked, { headerIndex: 1 });
    expect(plan.headers[2]).toBe("TIME OF DAY");
    expect(plan.mapping[2]).toEqual({ kind: "start" });
    // The line folded from below is heading, not the sheet's first cue.
    expect(plan.rows.map((r) => r.title)).not.toContain("DAY");
    expect(plan.rows.filter((r) => r.title === "Crew onsite")).toHaveLength(1);
  });
});

describe("splitRunTogetherHeadings", () => {
  // A PDF hands over runs of text, not cells. A narrow DURATION column butted
  // against ACTIVITY comes out as the single run "DURATION ACTIVITY", which
  // lands in one column and leaves the other unnamed — so nothing maps to
  // duration and a sheet full of readable lengths imports with none.
  it("splits two headings that arrived as one run", () => {
    expect(splitRunTogetherHeadings(["ITEM", "TIME", "DURATION ACTIVITY", "", "WHO"])).toEqual([
      "ITEM",
      "TIME",
      "DURATION",
      "ACTIVITY",
      "WHO",
    ]);
  });

  it("keeps the sheet's own spelling, not a normalised one", () => {
    expect(splitRunTogetherHeadings(["Dur Activity", ""])).toEqual(["Dur", "Activity"]);
  });

  it("will not split when the next column has a heading to lose", () => {
    const headers = ["DURATION ACTIVITY", "WHO"];
    expect(splitRunTogetherHeadings(headers)).toEqual(headers);
  });

  // The guard that matters: most two-word headings are ONE heading. Splitting
  // "TIME OF DAY" or a sheet's "RUN TIME" would invent a column and unname a
  // real one, so both halves have to be headings in their own right.
  it("leaves an ordinary two-word heading alone", () => {
    expect(splitRunTogetherHeadings(["TIME OF DAY", ""])).toEqual(["TIME OF DAY", ""]);
    expect(splitRunTogetherHeadings(["RUN TIME", ""])).toEqual(["RUN TIME", ""]);
    expect(splitRunTogetherHeadings(["LED KEY MOMENTS", ""])).toEqual(["LED KEY MOMENTS", ""]);
  });

  it("gives the split column its duration mapping back", () => {
    const grid = [
      ["ITEM", "TIME", "DURATION ACTIVITY", "", "WHO"],
      ["1", "11:30:00AM", "90:00", "CONTENT CHECK", "CREW"],
      ["2", "1:00:00PM", "45:00", "PRODUCTION MEETING", "CREW"],
      ["3", "1:45:00PM", "15:00", "TECH CHECK", "CREW"],
    ];
    const plan = planImport(grid, { headerIndex: 0 });
    expect(plan.mapping[2]).toEqual({ kind: "duration" });
    expect(plan.mapping[3]).toEqual({ kind: "title" });
    expect(plan.rows.map((r) => r.durationSec)).toEqual([5400, 2700, 900]);
    expect(plan.rows.map((r) => r.title)).toEqual(["CONTENT CHECK", "PRODUCTION MEETING", "TECH CHECK"]);
  });
});

describe("reclaimRowsAboveHeader", () => {
  // Some run sheets open with a block of build-up and only rule in the column
  // heading once the doors are about to open. Everything above it was being
  // thrown away as title matter — on a real sheet that silently removed its
  // first ten items and moved the show's start three hours later.
  // Six numbered rows below the heading, because the numbering column is only
  // credible once it has a run of them — a three-row fixture proves nothing a
  // real sheet would hit.
  const late = [
    ["", "", "MATCH DAY RUN SHEET"],
    ["1", "11:30AM", "CONTENT CHECK"],
    ["2", "1:00PM", "PRODUCTION MEETING"],
    ["3", "1:45PM", "TECH CHECK"],
    ["ITEM", "TIME", "ACTIVITY"],
    ["4", "2:45PM", "GATES OPEN"],
    ["5", "2:53PM", "VTR | WALK ON TRACK"],
    ["6", "2:56PM", "GA - WELCOME"],
    ["7", "2:57PM", "INTRO COIN TOSS"],
    ["8", "2:59PM", "INTRO FOOTY TALK"],
    ["9", "3:02PM", "VTR | 50 GAMES"],
  ];

  it("finds where the table really starts", () => {
    expect(reclaimRowsAboveHeader(late, 4, 0)).toBe(1);
  });

  it("keeps the rows it reclaimed, heading and all", () => {
    const plan = planImport(late, { headerIndex: 4 });
    expect(plan.rows.map((r) => r.title).slice(0, 5)).toEqual([
      "CONTENT CHECK",
      "PRODUCTION MEETING",
      "TECH CHECK",
      "GATES OPEN",
      "VTR | WALK ON TRACK",
    ]);
    expect(plan.rows).toHaveLength(9);
  });

  // The numbering has to run straight THROUGH the heading. Without that test
  // any sheet with a few stray numbers above its header would have its title
  // block dragged in as cues.
  it("refuses when the numbering does not continue past the heading", () => {
    const broken = late.map((r) => [...r]);
    broken[5]![0] = "9"; // the sheet resumes at 9, not 4
    broken[6]![0] = "10";
    expect(reclaimRowsAboveHeader(broken, 4, 0)).toBe(4);
  });

  it("refuses when the numbers above do not ascend", () => {
    const jumbled = late.map((r) => [...r]);
    jumbled[2]![0] = "7";
    expect(reclaimRowsAboveHeader(jumbled, 4, 0)).toBe(4);
  });

  it("refuses on too few numbered lines to show a run", () => {
    const two = late.map((r) => [...r]);
    two[1] = ["", "", ""]; // only two numbered lines left above the heading
    expect(reclaimRowsAboveHeader(two, 4, 0)).toBe(4);
  });

  it("does nothing without a numbering column", () => {
    expect(reclaimRowsAboveHeader(late, 4, null)).toBe(4);
  });

  it("leaves an ordinary sheet where its heading already is", () => {
    const normal = [["ITEM", "TIME", "ACTIVITY"], ["1", "1:00PM", "A"], ["2", "2:00PM", "B"], ["3", "3:00PM", "C"]];
    expect(reclaimRowsAboveHeader(normal, 0, 0)).toBe(0);
  });
});

describe("detectHeaderRow — how deep it looks", () => {
  const filler = (n: number): string[][] => Array.from({ length: n }, () => ["", "", ""]);

  // A real match-day document opens with a title block, a Key Timings list and
  // a whole Match Day Contacts table before its run sheet begins, putting the
  // heading on line 51. At the old fixed window of 30 it was never seen, and
  // the fallback is line 0 — the title block — so every column was named after
  // a piece of the title and the sheet imported with no title, no time and no
  // duration at all.
  it("finds a heading buried under other tables", () => {
    const grid = [...filler(51), ["ITEM No.", "TIME", "DUR."], ...filler(170)];
    expect(detectHeaderRow(grid)).toBe(51);
  });

  // Still bounded. A heading sits at the TOP of the rows it heads, and letting
  // the scan run to the end would let some coincidence far down the document
  // throw away everything above it.
  it("will not take a heading-like line from the bottom of the sheet", () => {
    const grid = [...filler(200), ["ITEM", "TIME", "DURATION"], ...filler(5)];
    expect(detectHeaderRow(grid)).toBe(0);
  });

  it("keeps the earliest line when two score the same", () => {
    const grid = [["ITEM", "TIME"], ...filler(20), ["ITEM", "TIME"], ...filler(20)];
    expect(detectHeaderRow(grid)).toBe(0);
  });

  it("still answers 0 when nothing in the sheet reads as a heading", () => {
    expect(detectHeaderRow([["Event plan"], ["Saturday"], ["Attendance: 26,000"]])).toBe(0);
  });

  // "DUR." and "ITEM No." are how sheets actually head those columns. Without
  // the trailing stop coming off, the line above scores 2 of a possible 4 —
  // enough to lose to anything else in the running.
  it("reads a heading abbreviated with a full stop", () => {
    expect(mapColumns(["ITEM No.", "TIME", "DUR.", "ACTIVITY"])).toEqual([
      { kind: "skip" },
      { kind: "start" },
      { kind: "duration" },
      { kind: "title" },
    ]);
  });
});

describe("detectBlocks — a row printed inside another row's window", () => {
  /** A rugby league half: 35 minutes of match clock, 42:00 of afternoon. */
  const row = (title: string, startSec: number | null, durationSec: number | null) => ({
    kind: "cue" as const, title, startSec, startRaw: null, durationSec, durationRaw: null,
    cells: {}, sourceIndex: 0,
  });
  const HH = (h: number, m: number, s = 0) => h * 3600 + m * 60 + s;

  it("marks what runs during a match as contained, not as time to spend", () => {
    const rows = [
      row("SECOND HALF", HH(16, 10), 42 * 60),
      row("IN MATCH CONTENT", null, 7 * 60),
      row("NRL Coin Toss", HH(16, 30), null),
      row("Full Time", HH(16, 52), 60),
    ];
    detectBlocks(rows as never);
    expect(rows.map((r) => (r as { contained?: boolean }).contained ?? false)).toEqual([false, true, true, false]);
  });

  // The proof is the sheet's own arithmetic and it has to be exact. If full
  // time is printed a minute out, the sheet is not stating that the half ends
  // where its duration says, and re-timing on a near miss would be a guess.
  it("refuses when the closing row does not land on the block's end", () => {
    const rows = [
      row("SECOND HALF", HH(16, 10), 42 * 60),
      row("IN MATCH CONTENT", null, 7 * 60),
      row("NRL Coin Toss", HH(16, 30), null),
      row("Full Time", HH(16, 53), 60),
    ];
    detectBlocks(rows as never);
    expect(rows.some((r) => (r as { contained?: boolean }).contained)).toBe(false);
  });

  // Untimed children alone are the OTHER shape — a block whose contents fill
  // it — and that is handled by the spans rule, not this one.
  it("leaves an ordinary run of timed rows alone", () => {
    const rows = [
      row("TVC Reel", HH(16, 10), 60),
      row("Welcome", HH(16, 11), 60),
      row("Coin toss", HH(16, 12), 60),
    ];
    detectBlocks(rows as never);
    expect(rows.some((r) => (r as { contained?: boolean }).contained)).toBe(false);
  });

  // Three things printed at the same minute cannot be three minutes of show.
  it("boxes rows that all start at the same printed time", () => {
    const rows = [
      row("COLLECT COMMS", HH(13, 45), 15 * 60),
      row("TECH CHECK", HH(13, 45), 15 * 60),
      row("Team list in", HH(13, 45), 10 * 60),
      row("REHEARSALS", HH(14, 0), 30 * 60),
    ];
    detectBlocks(rows as never);
    expect(rows.map((r) => (r as { contained?: boolean }).contained ?? false)).toEqual([false, true, true, false]);
  });

  // Narrow on purpose. A block followed only by UNTIMED rows is the other
  // shape — contents that fill their container — and the spans rule decides
  // that one. Without this the new rule reaches into those too, muting five
  // more minutes on a real sheet and giving one question two answers.
  it("leaves a block whose children have no printed times of their own", () => {
    const rows = [
      row("TVC Reel", HH(16, 0), 180),
      row("Sponsor A 30", null, 30),
      row("Sponsor B 30", null, 30),
      row("Welcome", HH(16, 3), 60),
    ];
    detectBlocks(rows as never);
    expect(rows.some((r) => (r as { contained?: boolean }).contained)).toBe(false);
  });

  // Times that go backwards are their own problem; swallowing rows is not the
  // way to resolve one.
  it("stops at a row stamped before the block it would sit in", () => {
    const rows = [
      row("Photo wall", HH(18, 29), 60),
      row("Earlier thing", HH(18, 28), 30),
      row("Chant", HH(18, 29, 30), 30),
      row("Team entry", HH(18, 30), 60),
    ];
    detectBlocks(rows as never);
    expect(rows.some((r) => (r as { contained?: boolean }).contained)).toBe(false);
  });

  it("still boxes when the out-of-order row spends no time anyway", () => {
    const rows = [
      row("Photo wall", HH(18, 29), 60),
      { ...row("TWO MINUTE BELL", HH(18, 28), null), parallel: true },
      row("Chant", HH(18, 29, 30), 30),
      row("Team entry", HH(18, 30), 60),
    ];
    detectBlocks(rows as never);
    expect((rows[2] as { contained?: boolean }).contained).toBe(true);
  });
});
