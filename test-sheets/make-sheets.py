#!/usr/bin/env python3
"""Rehearsal sheets for the importer and the live show.

Every name in here is invented. Fictional clubs (HARBOUR KINGS, RIVERS UNITED,
COAST RAIDERS, RANGERS ATHLETIC, NORTHBANK CITY, STONEWELL ROVERS) and fictional
sponsors (Northbank, Sponsor A, Advertiser, Coast Mutual, Harbour Freight)
only — nothing lifted from a real production's sheet.

Run:  python3 test-sheets/make-sheets.py     (writes the CSVs beside itself)
"""
import os, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
HDR = ["TIME", "DUR", "SCR", "ITEM / ACTION", "WHO", "NOTES"]

def q(v):
    v = "" if v is None else str(v)
    return '"' + v.replace('"', '""') + '"' if any(c in v for c in ',"\n') else v

def hms(sec):
    sec %= 86400
    return f"{sec//3600:02d}:{(sec%3600)//60:02d}:{sec%60:02d}"

def dur(sec):
    return f"{sec//60:02d}:{sec%60:02d}" if sec < 3600 else f"{sec//3600}:{(sec%3600)//60:02d}:{sec%60:02d}"

def write(name, rows, header=HDR, newline="\n"):
    path = os.path.join(HERE, name)
    with open(path, "w", newline="") as f:
        f.write(newline.join(",".join(q(c) for c in r) for r in [header] + rows) + newline)
    print(f"{name}: {len(rows)} rows")

def timed(t, d, scr, title, who, note=""):
    return [hms(t) if t is not None else "", dur(d) if d else "", scr, title, who, note]

# ── 1. A regular-season match, a whole evening, NO endings written ───────────
# This is the shape most real sheets have (24 of 27 in the sample corpus carry
# no ending rows at all): the chooser has to hang off the full-time row and the
# extra period has to be BUILT if it is called.
def regular_game(compress=1.0, start=17*3600):
    S = lambda s: int(round(s / compress))
    t = start; rows = []
    def add(d, scr, title, who, note=""):
        nonlocal t
        rows.append(timed(t, S(d), scr, title, who, note)); t += S(d)
    def milestone(title, who="SC", note=""):
        rows.append(timed(t, 0, "", title, who, note))
    milestone("CREW CALL — HARBOUR KINGS v RIVERS UNITED", "SC", "Everyone on comms by this time")
    add(30*60, "", "Rig and line checks", "CREW", "Cameras 1–4, both fotis, PA walk")
    add(20*60, "", "Production meeting", "ALL", "Level 5 — bring the sheet")
    add(15*60, "VTR", "PRE-RECORD — Coin toss package", "CAM", "Shot in the tunnel while rehearsals run")
    add(45*60, "", "Rehearsals — anthem, player walk, half-time show", "MC", "")
    milestone("GATES OPEN", "SC", "Fixed — the venue opens whatever we are doing")
    add(20*60, "AUDIO", "Crowd DJ — arrival set", "DJ", "")
    add(3*60, "prompter", "SPONSOR READ — Northbank welcome", "MC", "Read live from the sideline")
    add(10*60, "GFX", "Fan competition on the big screen", "MC", "Winners announced before warm-ups")
    add(25*60, "", "Team warm-ups", "SC", "Both squads on the field")
    add(3*60, "VTR", "Coin toss package plays", "VTR", "The pre-record from earlier")
    add(4*60, "AUDIO", "Anthem and player walk", "MC", "House lights to half")
    add(60, "", "KICK OFF", "SC", "")
    add(47*60, "", "First half", "SC", "Forty minutes plus stoppages")
    add(15*60, "GA", "HALF TIME — Northbank activation and half-time show", "MC", "Fifteen minutes; the show is eight of them")
    add(47*60, "", "Second half", "SC", "")
    add(2*60, "", "FULL TIME", "SC", "Siren — call the result here")
    add(6*60, "", "Post-match presentation", "MC", "Player of the match, then captains")
    add(5*60, "AUDIO", "Crowd exit music and thank you", "DJ", "")
    milestone("VENUE CLEAR", "SC", "")
    return rows

write("regular-game.csv", regular_game())
write("regular-game-fast.csv", regular_game(compress=10.0, start=0))

# ── 2. A double-header with the "next match" plug inside game 1's endings ────
def double_header():
    rows = []; t = 0
    def add(d, scr, title, who, note="", start=True):
        nonlocal t
        rows.append(timed(t if start else None, d, scr, title, who, note))
        if start: t += d
    def ending(title, *items):
        rows.append(["", "", "", title, "SC", ""])
        for d, scr, it, who in items: rows.append(["", dur(d), scr, it, who, ""])
    for g, (home, away, sponsor) in enumerate([("HARBOUR KINGS", "RIVERS UNITED", "Northbank"), ("COAST RAIDERS", "RANGERS ATHLETIC", "Sponsor A")], start=1):
        rows.append(timed(t, 0, "", f"GAME {g} — {home} v {away}", "SC"))
        add(30, "", "Walk-in and welcome", "MC")
        add(45, "prompter", f"SPONSOR READ — {sponsor}", "MC")
        add(60, "", f"KICK OFF — GAME {g}", "SC")
        add(240, "", "First half", "SC")
        add(60, "GA", f"HALF TIME — {sponsor} activation", "MC")
        add(240, "", "Second half", "SC")
        ending(f"FULL TIME — {home} WIN", (48, "AUDIO", "Winning song", "AUD"), (48, "", "Presentation", "MC"))
        ending(f"FULL TIME — {home} LOSS", (48, "AUDIO", "Music bed only", "AUD"), (48, "CAM", "Away captain interview", "CAM"))
        ending("FULL TIME — DRAW, GOLDEN POINT", (12, "", "HOLDING — golden point re-set", "SC"), (30, "", "Golden point — first half", "SC"), (12, "", "HOLDING — change of ends", "SC"), (30, "", "Golden point — second half", "SC"))
        ending("GOLDEN POINT — NO SCORE, MATCH DRAWN", (12, "", "Drawn match wrap", "MC"))
        if g == 1:
            # The trap: a plug for a fixture weeks away, sitting inside the endings.
            rows.append(["", "00:20", "GFX", "Next Match Round 14 — tickets on sale now", "MC", "A plug, not a game"])
        t += 180  # the slot the endings fill
    rows.append(timed(t, 0, "", "VENUE CLEAR", "SC"))
    return rows
write("double-header.csv", double_header())

# ── 3. The words that must NOT open an extra period ──────────────────────────
def buffer_trap():
    rows = []; t = 0
    def add(d, scr, title, who, note=""):
        nonlocal t
        rows.append(timed(t, d, scr, title, who, note)); t += d
    add(30, "", "Walk-in", "MC")
    add(60, "", "KICK OFF", "SC")
    add(240, "", "First half", "SC")
    add(60, "", "HALF TIME", "MC", "Rehearsals — Half time movements were this morning")
    add(240, "", "Second half", "SC")
    add(300, "", "Extra Time Buffer", "SC", "Held in case — five sheets print exactly this")
    add(30, "", "Extra Time Estimate — allow extra time for egress", "SC", "A note, not a period")
    rows.append(["", "", "", "FULL TIME — HARBOUR KINGS WIN", "SC", ""])
    rows.append(["", "00:48", "AUDIO", "Winning song", "AUD", ""])
    rows.append(["", "", "", "FULL TIME — HARBOUR KINGS LOSS", "SC", ""])
    rows.append(["", "00:48", "AUDIO", "Music bed only", "AUD", ""])
    rows.append(["", "", "", "FULL TIME — NO EXTRA TIME (exhibition) — draw stands", "SC", "A shortened exhibition game"])
    rows.append(["", "00:48", "", "Drawn match wrap", "MC", ""])
    t += 48
    rows.append(timed(t, 0, "", "VENUE CLEAR", "SC"))
    return rows
write("buffer-trap.csv", buffer_trap())

# ── 4. Across midnight ───────────────────────────────────────────────────────
def midnight():
    rows = []; t = 22*3600 + 30*60
    def add(d, scr, title, who, note=""):
        nonlocal t
        rows.append(timed(t, d, scr, title, who, note)); t += d
    add(30*60, "", "Late kick-off build", "SC")
    add(60, "", "KICK OFF", "SC")
    add(47*60, "", "First half", "SC")
    add(12*60, "", "HALF TIME", "MC")
    add(47*60, "", "Second half", "SC", "Ends after midnight")
    add(2*60, "", "FULL TIME", "SC", "")
    add(5*60, "", "Presentation", "MC")
    rows.append(timed(t, 0, "", "VENUE CLEAR", "SC"))
    return rows
write("midnight.csv", midnight())

# ── 5. Only the first row carries a time; everything cascades ────────────────
def durations_only():
    rows = [timed(19*3600, 30, "", "Walk-in", "MC")]
    for d, scr, title, who in [(45, "prompter", "SPONSOR READ", "MC"), (60, "", "KICK OFF", "SC"), (240, "", "First half", "SC"), (60, "GA", "HALF TIME", "MC"), (240, "", "Second half", "SC"), (120, "", "FULL TIME", "SC"), (300, "", "Presentation", "MC")]:
        rows.append(["", dur(d), scr, title, who, ""])
    rows.append([hms(19*3600 + 30*60), "", "", "TEAM BUS DEPARTS", "SC", "A fixed moment mid-sheet"])
    return rows
write("durations-only.csv", durations_only())

# ── 6. A malformed file: junk above the header, ragged rows, loose formats ───
def malformed():
    lines = [
        ["HARBOUR KINGS v RIVERS UNITED — RUN SHEET v3", "", "", "", "", ""],
        ["Prepared by the production office", "", "", "", "", ""],
        ["#", "TIME", "DURATION", "ACTION", "WHO", "NOTES"],
        ["1", "7.30pm", "1:30:00", "Check content", "KA", "a loose time and a long duration"],
        ["2", "9:00 PM", "90", "FMs arrive", "", "ninety what?"],
        ["", "", "", "", "", ""],
        ["3", "9:05pm", "10:00", "Production meeting"],  # ragged: two cells short
        ["#", "TIME", "DURATION", "ACTION", "WHO", "NOTES"],  # a running header, page 2
        ["4", "21:20", "", "Gates open", "SC", "24-hour clock this time"],
        ["5", "", "", "", "", "a row that is only a note"],
        ["6", "21:35:00", "40:00", "First half", "SC", ""],
        ["7", "22:15", "15", "Half time", "MC", "fifteen minutes, written as a bare number"],
        ["8", "22:30", "40:00", "Second half", "SC", ""],
        ["9", "23:10", "2:00", "Full time", "SC", ""],
    ]
    path = os.path.join(HERE, "malformed.csv")
    with open(path, "w", newline="") as f:
        f.write("\r\n".join(",".join(q(c) for c in r) for r in lines) + "\r\n")
    print(f"malformed.csv: {len(lines)} lines (CRLF, header on line 3)")
malformed()

# ── 7. Unicode, long titles, commas and newlines inside cells ────────────────
def unicode_sheet():
    long_title = "Sponsor segment — " + " ".join(["a very long segment name that keeps going"] * 5)
    rows = []; t = 0
    def add(d, scr, title, who, note=""):
        nonlocal t
        rows.append(timed(t, d, scr, title, who, note)); t += d
    add(30, "", "Walk-in 🎶 crowd welcome", "MC", "Emoji in a title")
    add(45, "prompter", "SPONSOR READ — “Northbank”, the ‘quoted’ one", "MC", "Curly quotes, a comma")
    add(60, "", long_title, "SC", "One title, 220 characters")
    add(240, "", "First half", "SC", "Line one\nLine two inside the cell")
    add(60, "GA", "HALF TIME — Coast Mutual", "MC", "")
    add(240, "", "Second half", "SC", "Naïve café — résumé")
    add(120, "", "FULL TIME", "SC", "")
    rows.append(timed(t, 0, "", "VENUE CLEAR", "SC"))
    return rows
write("unicode.csv", unicode_sheet())

# ── 8. Pre-records running alongside, one of them inside the ending block ────
def parallel_endings():
    rows = []; t = 0
    def add(d, scr, title, who, note="", parallel=False):
        nonlocal t
        rows.append(timed(t, d, scr, title, who, note))
        if not parallel: t += d
    add(30, "", "Walk-in", "MC")
    add(45, "VTR", "PRE-RECORD — Captain interview package", "CAM", "Shot during the walk-in", parallel=True)
    add(60, "", "KICK OFF", "SC")
    add(240, "", "First half", "SC")
    add(30, "VTR", "PRE-RECORD — Half-time show tease", "CAM", "Shot during the first half", parallel=True)
    add(60, "GA", "HALF TIME", "MC")
    add(240, "", "Second half", "SC")
    rows.append(["", "", "", "FULL TIME — HARBOUR KINGS WIN", "SC", ""])
    rows.append(["", "00:48", "VTR", "Captain interview package plays", "VTR", "The pre-record"])
    rows.append(["", "00:30", "VTR", "PRE-RECORD — Trophy lift for socials", "CAM", "Shot beside the presentation"])
    rows.append(["", "00:48", "", "Presentation", "MC", ""])
    rows.append(["", "", "", "FULL TIME — HARBOUR KINGS LOSS", "SC", ""])
    rows.append(["", "00:48", "AUDIO", "Music bed only", "AUD", ""])
    rows.append(["", "00:48", "CAM", "Away captain interview", "CAM", ""])
    rows.append(["", "", "", "FULL TIME — DRAW, GOLDEN POINT", "SC", ""])
    rows.append(["", "00:12", "", "HOLDING — golden point re-set", "SC", ""])
    rows.append(["", "00:30", "", "Golden point — first half", "SC", ""])
    rows.append(["", "00:12", "", "HOLDING — change of ends", "SC", ""])
    rows.append(["", "00:30", "", "Golden point — second half", "SC", ""])
    rows.append(["", "", "", "GOLDEN POINT — NO SCORE, MATCH DRAWN", "SC", ""])
    rows.append(["", "00:12", "", "Drawn match wrap", "MC", ""])
    t += 96
    rows.append(timed(t, 0, "", "VENUE CLEAR", "SC"))
    return rows
write("parallel-endings.csv", parallel_endings())
