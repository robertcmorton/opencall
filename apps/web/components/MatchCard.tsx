"use client";

import { useState } from "react";
import { gamesOf, type EventTypeDef } from "@opencall/core";

/**
 * "Set up the match" (21 Oct, Robert: "the dropdown in the import page should
 * just be 'rugby league', then a second step … where we assign the type of game
 * and list the parameters each game has — so the user knows and is in
 * control").
 *
 * A strip above the sheet while the show is not live. Folded, it names the
 * game and its shape in one line. Open, it lists the five games, the rules of
 * the one picked, and this match's times — changeable, and compared with what
 * the sheet itself adds up to. A sheet imported as just "Rugby league" opens
 * asking which game it is, because the endings depend on the answer.
 *
 * A sheet can carry more than one game — a double-header, a women's game
 * before the men's (Robert, same day: "if there are multiple games on the same
 * day we need to make a selection for each"). Each gets its own section; a
 * later game follows game 1 until it is given its own.
 */

export interface MatchTimes {
  halfSec?: number;
  halfTimeSec?: number;
  extraHalfSec?: number;
}

/** What the sheet's own rows add up to, per period, for the "on your sheet" column. */
export interface SheetPeriod {
  kind: "first-half" | "half-time" | "second-half";
  sec: number;
  /** Which game on the sheet, from 1. */
  game: number;
  startSec: number;
}

const mmss = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** "35", "35:00", "4:30" → seconds; null when it isn't a time. */
const parseMmss = (text: string): number | null => {
  const t = text.trim();
  const m = /^(\d{1,3})(?::([0-5]\d))?$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
};

/** The game's shape in a few words, for the folded line and each choice. */
export const gameSummary = (t: EventTypeDef, times: Required<MatchTimes>): string => {
  const halves = `${Math.round(times.halfSec / 60)}-min halves`;
  if (!t.game || times.extraHalfSec === 0 || !t.extraLabel) return `${halves} · level is a draw`;
  const extra = `${t.extraLabel.toLowerCase()} ${Math.round(times.extraHalfSec / 60)} + ${Math.round(times.extraHalfSec / 60)}`;
  return t.afterExtra.includes("draw") ? `${halves} · ${extra}, then a draw` : `${halves} · ${extra}, then golden point`;
};

/** Which games the sheet's own halves look like: about 35 minutes is the women's game, about 40 the men's. */
const looksLike = (periods: SheetPeriod[]): "women" | "men" | null => {
  const halves = periods.filter((p) => p.kind !== "half-time").map((p) => p.sec / 60);
  if (halves.length === 0) return null;
  if (halves.every((m) => m >= 33 && m <= 37)) return "women";
  if (halves.every((m) => m >= 38 && m <= 42)) return "men";
  return null;
};

/** One game on the sheet, as the card shows it. */
export interface MatchGame {
  /** Counting from 1, in sheet order. */
  n: number;
  type: EventTypeDef;
  /** Its own times, where they differ from the game's rules. */
  times: MatchTimes | null;
  periods: SheetPeriod[];
  /** When it kicks off, already formatted — tells two games apart. */
  kicksOff?: string;
  /** A later game with no choice of its own, following game 1. */
  follows?: boolean;
}

export function MatchCard({
  games,
  canChange,
  onPick,
  onTimes,
}: {
  games: MatchGame[];
  canChange: boolean;
  onPick: (n: number, id: string) => Promise<void>;
  onTimes: (n: number, next: MatchTimes | null) => void;
}) {
  const unchosen = games.some((g) => g.type.needsGame);
  const [open, setOpen] = useState(unchosen);
  const many = games.length > 1;
  const one = games[0]!;
  const effOf = (g: MatchGame): Required<MatchTimes> => ({
    halfSec: g.times?.halfSec ?? g.type.game?.halfSec ?? 40 * 60,
    halfTimeSec: g.times?.halfTimeSec ?? g.type.game?.halfTimeSec ?? 15 * 60,
    extraHalfSec: g.times?.extraHalfSec ?? g.type.game?.extraHalfSec ?? 5 * 60,
  });

  return (
    <section className={`match-card no-print ${unchosen ? "is-unchosen" : ""}`} aria-label={many ? "The matches" : "The match"}>
      <div className="mc-head">
        <div className="mc-what">
          <span className="mc-kicker">{many ? `${games.length} games` : "Match"}</span>
          {unchosen ? (
            <strong>{many ? "Which game is each one? The endings depend on it." : "Which game is this? The endings depend on it."}</strong>
          ) : many && games.length <= 4 ? (
            <span className="mc-list">
              {games.map((g) => (
                <span key={g.n}>
                  <strong>{g.n}</strong> {g.type.label}
                </span>
              ))}
            </span>
          ) : many ? (
            // A long day (a test sheet runs ninety-six) reads as counts, not a roll call.
            <span className="mc-summary">
              {[...games.reduce((m, g) => m.set(g.type.label, (m.get(g.type.label) ?? 0) + 1), new Map<string, number>())]
                .map(([label, count]) => (count === games.length ? `all ${label}` : `${count} × ${label}`))
                .join(" · ")}
            </span>
          ) : (
            <>
              <strong>{one.type.label}</strong>
              <span className="mc-summary">{gameSummary(one.type, effOf(one))}</span>
            </>
          )}
        </div>
        <button type="button" className={`btn btn-sm ${unchosen && !open ? "btn-primary" : ""}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? (unchosen ? "Later" : "Done") : unchosen ? "Choose" : canChange ? "Change" : "Rules"}
        </button>
      </div>
      {open && (
        <div className={games.length > 4 ? "mc-scroll" : "mc-all"}>
          {games.map((g) => (
            <GameSetup
              key={g.n}
              game={g}
              eff={effOf(g)}
              heading={many ? `Game ${g.n}${g.kicksOff ? ` · kicks off ${g.kicksOff}` : ""}` : null}
              folded={games.length > 4 && !g.type.needsGame}
              canChange={canChange}
              onPick={(id) => onPick(g.n, id)}
              onTimes={(next) => onTimes(g.n, next)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GameSetup({
  game,
  eff,
  heading,
  folded: startFolded,
  canChange,
  onPick,
  onTimes,
}: {
  game: MatchGame;
  eff: Required<MatchTimes>;
  heading: string | null;
  /** On a long day each game starts as one line, opened by tapping it. */
  folded?: boolean;
  canChange: boolean;
  onPick: (id: string) => Promise<void>;
  onTimes: (next: MatchTimes | null) => void;
}) {
  const { type, times, periods } = game;
  const unchosen = !!type.needsGame;
  const [folded, setFolded] = useState(!!startFolded);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choices = gamesOf("rugby-league");
  const rules = type.game;
  const hint = looksLike(periods);
  const matchesSheet = (g: EventTypeDef) =>
    hint != null && g.game != null && g.game.extraHalfSec > 0 && (hint === "women" ? g.game.halfSec === 35 * 60 : g.game.halfSec === 40 * 60);

  const pick = async (id: string) => {
    if ((id === type.id && !game.follows) || busy) return;
    setBusy(id);
    setError(null);
    try {
      await onPick(id);
    } catch (e) {
      setError(
        e instanceof Error && /403|forbidden|allowed/i.test(e.message)
          ? "Only someone who manages this sheet can change the game."
          : "Couldn't change the game — try again.",
      );
    } finally {
      setBusy(null);
    }
  };

  const setTime = (key: keyof MatchTimes, text: string) => {
    const sec = parseMmss(text);
    if (sec == null || !rules) return;
    const next: MatchTimes = { ...(times ?? {}), [key]: sec };
    // Back to the rule's own figure: drop the change rather than store a copy of it.
    if (sec === rules[key]) delete next[key];
    onTimes(Object.keys(next).length ? next : null);
  };

  const sheet = (kind: SheetPeriod["kind"]) => {
    const found = periods.filter((p) => p.kind === kind);
    if (found.length === 0) return <span className="mc-sheet is-none">not on the sheet</span>;
    const want = kind === "half-time" ? eff.halfTimeSec : eff.halfSec;
    const shortest = Math.min(...found.map((p) => p.sec));
    const short = shortest < want - 60;
    return (
      <span className={`mc-sheet ${short ? "is-short" : ""}`} data-tip={short ? "The sheet gives this less time than the game takes" : undefined}>
        {[...new Set(found.map((p) => mmss(p.sec)))].join(", ")} on the sheet
        {short ? " — shorter" : ""}
      </span>
    );
  };

  const timeRow = (key: keyof MatchTimes, label: string, kind?: SheetPeriod["kind"]) => {
    const changed = times?.[key] != null && rules != null && times[key] !== rules[key];
    return (
      <div className="mc-time">
        <label>
          <span className="mc-time-label">{label}</span>
          <input
            key={`${type.id}:${eff[key]}`}
            className="input mono"
            inputMode="numeric"
            defaultValue={mmss(eff[key])}
            disabled={!canChange}
            aria-label={`${heading ? `${heading.split(" · ")[0]}: ` : ""}${label}, minutes and seconds`}
            onBlur={(e) => setTime(key, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
          />
        </label>
        {changed && rules ? (
          <button type="button" className="btn btn-sm btn-ghost" disabled={!canChange} onClick={() => setTime(key, mmss(rules[key]))}>
            Rules say {mmss(rules[key])}
          </button>
        ) : (
          kind && sheet(kind)
        )}
      </div>
    );
  };

  if (folded)
    return (
      <div className="mc-body">
        <button type="button" className="mc-fold" aria-expanded={false} onClick={() => setFolded(false)}>
          <span className="mc-game-head">{heading}</span>
          <span className="mc-summary">
            {type.label} · {gameSummary(type, eff)}
          </span>
        </button>
      </div>
    );

  return (
    <div className="mc-body">
      {heading && (
        <h3 className="mc-game-head">
          {heading}
          {game.follows && !unchosen && <span className="mc-follows">same as game 1 until you choose</span>}
        </h3>
      )}
      <div className="mc-games" role="radiogroup" aria-label={heading ? `${heading.split(" · ")[0]}: which game` : "Which game"}>
        {choices.map((g) => (
          <button
            key={g.id}
            type="button"
            role="radio"
            aria-checked={g.id === type.id}
            className={`mc-game ${g.id === type.id ? "is-on" : ""}`}
            disabled={!canChange || busy != null}
            onClick={() => void pick(g.id)}
          >
            <span className="mc-game-name">
              {g.label}
              {unchosen && matchesSheet(g) && <span className="mc-tag">matches your sheet</span>}
            </span>
            <span className="mc-game-sum">
              {g.game
                ? gameSummary(g, {
                    halfSec: g.game.halfSec,
                    halfTimeSec: g.game.halfTimeSec,
                    extraHalfSec: g.game.extraHalfSec,
                  })
                : ""}
            </span>
          </button>
        ))}
      </div>
      {error && (
        <p className="mc-error" role="alert">
          {error}
        </p>
      )}
      {rules && (
        <div className="mc-detail">
          <div>
            <h4>The rules</h4>
            <ul className="mc-rules">
              {rules.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4>{heading ? "This game" : "This match"}</h4>
            {timeRow("halfSec", "Each half", "first-half")}
            {timeRow("halfTimeSec", "Half time", "half-time")}
            {rules.extraHalfSec > 0 && type.extraLabel && timeRow("extraHalfSec", `Each half of ${type.extraLabel.toLowerCase()}`)}
            <p className="mc-note">
              {rules.extraHalfSec > 0 && type.extraLabel
                ? `The ${type.extraLabel.toLowerCase()} length is what's added to the sheet if the scores are level at full time.`
                : "Level at full time ends the match — nothing is added."}{" "}
              The sheet's own rows aren't changed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
