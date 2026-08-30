"use client";

import { useCallback, useEffect, useState } from "react";
import { EVENT_TYPES, eventTypeLabel, resolveEventType, type EventTypeSpec } from "@opencall/core";
import { api, API_URL, type CustomEventType, type ImportedSheet } from "../lib/api";
import { MissingFields } from "./ui";

/**
 * The kinds of show this installation knows about, and the ones a company adds.
 *
 * The built-in list was only ever going to cover what we had run sheets for.
 * What a type has to get right is small but unforgiving: what the result
 * chooser offers at full time. Offering Draw on a competition that plays extra
 * time until somebody leads puts a button on screen, at full time, that names
 * a result which cannot happen.
 */
export function EventTypesPanel() {
  const [custom, setCustom] = useState<CustomEventType[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api.eventTypes().then(setCustom).catch((e: unknown) => setError(String((e as Error)?.message ?? e)));
  }, []);
  useEffect(reload, [reload]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <AddEventTypeForm onDone={reload} />

      {error && <div className="panel" style={{ borderColor: "var(--over)", color: "var(--over)" }}>{error}</div>}

      {custom && custom.length > 0 && (
        <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <strong>Yours</strong>
          {custom.map((t) => (
            <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
              <strong style={{ flex: "0 0 230px", maxWidth: "100%" }}>{eventTypeLabel(t)}</strong>
              <span style={{ color: "var(--text-2)" }}>{describeEndings(t)}</span>
              {(t.resultDuePhrases?.length ?? 0) > 0 && (
                <span className="chip" data-tip="No result is asked for before the show reaches a row worded like this">
                  not before “{t.resultDuePhrases!.join("” / “")}”
                </span>
              )}
              <span style={{ flex: 1 }} />
              {/* Only your own. The ones an administrator added for the whole
                  installation are usable here but not yours to remove. */}
              {t.own && (
                <button
                  className="btn btn-sm btn-ghost"
                  style={{ color: "var(--over)" }}
                  data-tip="Sheets already set to this keep the setting, but it stops being offered"
                  onClick={() => void api.deleteEventType(t.rowId).then(reload)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <strong>Built in</strong>
        <span style={{ color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          These come with the app and cannot be changed. Add your own above if none of them ends the way your
          competition does.
        </span>
        {EVENT_TYPES.map((t) => (
          <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
            <strong style={{ flex: "0 0 230px", maxWidth: "100%" }}>{t.label}</strong>
            <span style={{ color: "var(--text-2)", flex: "1 1 240px", minWidth: 0 }}>{t.blurb}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

const OUTCOME_LABEL: Record<string, string> = { win: "Win", lose: "Lose", draw: "Draw", golden: "an extra period" };
const describeEndings = (t: EventTypeSpec): string => {
  const at = t.fullTime.map((o) => OUTCOME_LABEL[o] ?? o).join(", ");
  if (t.afterExtra.length === 0) return `Ends as: ${at}`;
  return `Ends as: ${at}; after ${t.extraLabel || "extra time"}: ${t.afterExtra.map((o) => OUTCOME_LABEL[o] ?? o).join(", ")}`;
};

/**
 * Describing a kind of show in the words of somebody who runs one.
 *
 * The question that decides everything is whether a level score ENDS the
 * match or SENDS IT ON, and then — if it sends it on — whether the extra
 * period can itself end level. Those two answers produce every shape the
 * built-in list needed, so they are what this asks, rather than presenting a
 * grid of outcome checkboxes and hoping for a coherent combination.
 */
function AddEventTypeForm({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [shape, setShape] = useState<"draw" | "extra-can-draw" | "extra-must-settle" | "single">("draw");
  const [extraLabel, setExtraLabel] = useState("Extra time");
  const [phrases, setPhrases] = useState("");
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const missing = [
    !label.trim() && "A name for this kind of show",
    shape !== "single" && shape !== "draw" && !extraLabel.trim() && "What the extra period is called",
  ].filter((v): v is string => typeof v === "string");

  if (!open)
    return (
      <div>
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          Add a kind of show
        </button>
      </div>
    );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    setError(null);
    if (missing.length > 0) return;
    const body = {
      label: label.trim(),
      fullTime:
        shape === "single" ? [] : shape === "draw" ? ["win", "lose", "draw"] : ["win", "lose", "golden"],
      afterExtra:
        shape === "extra-can-draw" ? ["win", "lose", "draw"] : shape === "extra-must-settle" ? ["win", "lose"] : [],
      extraLabel: shape === "extra-can-draw" || shape === "extra-must-settle" ? extraLabel.trim() : null,
      resultDuePhrases: phrases.split(",").map((p) => p.trim()).filter(Boolean),
      blurb: null,
    };
    void api
      .createEventType(body)
      .then(() => {
        setOpen(false);
        setLabel("");
        setPhrases("");
        setTried(false);
        onDone();
      })
      .catch((err: unknown) => setError(String((err as Error)?.message ?? err)));
  };

  return (
    <form className="panel field-row" onSubmit={submit}>
      <div style={{ flexBasis: "100%" }}>
        <strong>Add a kind of show</strong>
        <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          What this decides is what the result chooser offers when the match ends. Everything else about a sheet comes
          from the sheet.
        </span>
      </div>
      <div>
        <label className="field-label">Name</label>
        <input
          className={"input " + (tried && !label.trim() ? "field-missing" : "")}
          value={label}
          maxLength={60}
          placeholder="Water polo"
          onChange={(e) => setLabel(e.target.value)}
          style={{ minWidth: 220 }}
        />
      </div>
      <div>
        <label className="field-label">How it ends</label>
        <select className="input" value={shape} onChange={(e) => setShape(e.target.value as typeof shape)} style={{ minWidth: 300 }}>
          <option value="draw">Win, lose or draw — a level score is the result</option>
          <option value="extra-must-settle">Level goes to an extra period, played until somebody leads</option>
          <option value="extra-can-draw">Level goes to an extra period, which can still end level</option>
          <option value="single">One ending — it is whatever is on the sheet</option>
        </select>
      </div>
      {(shape === "extra-can-draw" || shape === "extra-must-settle") && (
        <div>
          <label className="field-label">The extra period is called</label>
          <input
            className={"input " + (tried && !extraLabel.trim() ? "field-missing" : "")}
            value={extraLabel}
            maxLength={40}
            placeholder="Golden point"
            onChange={(e) => setExtraLabel(e.target.value)}
            style={{ minWidth: 180 }}
          />
        </div>
      )}
      {shape !== "single" && (
        <div>
          <label
            className="field-label"
            data-tip="Words as they appear on your run sheets. The chooser appears in the last 30 seconds of the item before the endings — this stops it appearing before the match has reached the period where a result is possible at all."
          >
            No result before (optional)
          </label>
          <input
            className="input"
            value={phrases}
            placeholder="4th quarter, final period"
            onChange={(e) => setPhrases(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <span className="field-hint">
            Separate with commas. Matched against the row titles on your sheet — leave empty and the chooser simply
            appears 30 seconds before the endings.
          </span>
        </div>
      )}
      <div className="field-actions">
        <button className="btn btn-primary" type="submit">
          Add
        </button>
        <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {tried && missing.length > 0 && <MissingFields missing={missing} />}
      {error && <div className="missing-fields" style={{ borderColor: "var(--over)" }}>{error}</div>}
    </form>
  );
}

/**
 * The run sheets that have been imported, grouped by what kind of show they were.
 *
 * These files were already being kept so Update import could re-read them. What
 * they are FOR here is different: import rules are the part of this app most
 * likely to be wrong for a sport nobody tested it against, and the way to find
 * that out is to read real sheets. Grouping by kind is what makes the gaps
 * visible — a column of one sport and none of another says where the rules have
 * only ever been guessed at.
 */
export function ImportedSheetsPanel({ custom = [] }: { custom?: EventTypeSpec[] }) {
  const [sheets, setSheets] = useState<ImportedSheet[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.importedSheets().then(setSheets).catch((e: unknown) => setError(String((e as Error)?.message ?? e)));
  }, []);

  if (error) return <div className="panel" style={{ borderColor: "var(--over)", color: "var(--over)" }}>{error}</div>;
  if (!sheets) return null;

  const groups = new Map<string, ImportedSheet[]>();
  for (const s of sheets) {
    const key = s.sport ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  return (
    <section className="panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <strong>Imported run sheets</strong>
        <span style={{ display: "block", color: "var(--text-2)", fontSize: "var(--fs-sm)" }}>
          Every sheet imported here is kept as it arrived. Grouped by kind of show, because that is what says where the
          import rules have been tested and where they have only been guessed at.
        </span>
      </div>
      {sheets.length === 0 && <span style={{ color: "var(--text-3)" }}>Nothing imported yet.</span>}
      {[...groups.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([sport, list]) => (
          <div key={sport || "untyped"} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: "var(--fs-sm)" }}>
                {resolveEventType(sport, custom)?.label ?? (sport || "No kind of show set")}
              </strong>
              <span className="chip">{list.length}</span>
            </div>
            {list.map((s) => (
              <div
                key={s.rundownId}
                style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: "var(--fs-sm)", paddingLeft: 10 }}
              >
                <span style={{ minWidth: 190, color: "var(--text-2)" }}>{s.sourceName ?? s.name}</span>
                <span style={{ color: "var(--text-3)" }}>{s.eventName ?? ""}</span>
                <span style={{ color: "var(--text-3)" }}>{Math.round(s.bytes / 1024)} KB</span>
                <span style={{ color: "var(--text-3)" }}>{new Date(s.importedAt).toLocaleDateString()}</span>
                <a
                  className="btn btn-sm btn-ghost"
                  href={`${API_URL}/rundowns/${s.rundownId}/source`}
                  data-tip="The file exactly as it was imported"
                >
                  Download
                </a>
              </div>
            ))}
          </div>
        ))}
    </section>
  );
}
