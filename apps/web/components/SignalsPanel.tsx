"use client";

import { useEffect, useState } from "react";
import { api, API_URL } from "../lib/api";
import { Icon } from "./ui";

type Signals = Awaited<ReturnType<typeof api.signals>>;

/**
 * Fire on cue: tell other systems when a row goes on air.
 *
 * Out: addresses OpenCall calls the moment a row goes on air. In: an address
 * equipment on the venue's network can ask "what is on air now?" — OpenCall
 * cannot reach into a venue's network, but the venue can always reach out.
 */
export function SignalsPanel({ rundownId, onClose }: { rundownId: string; onClose: () => void }) {
  const [data, setData] = useState<Signals | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () =>
    void api
      .signals(rundownId)
      .then((d) => {
        setData(d);
        setText(d.webhooks.join("\n"));
      })
      .catch((e: unknown) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }));
  useEffect(load, [rundownId]);

  const nowUrl = `${API_URL}/rundowns/${rundownId}/now?code=YOUR-VIEW-CODE`;

  return (
    <div className="find-panel signals-panel" role="dialog" aria-label="On-cue signals">
      <div className="find-row" style={{ alignItems: "center" }}>
        <strong style={{ flex: 1 }}>On-cue signals</strong>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
          {Icon.close}
        </button>
      </div>

      <section className="signals-sec">
        <span className="signals-h">Tell other systems when a row goes on air</span>
        <span className="signals-p">
          Some systems, like a graphics computer or an online tool, can be told the moment a new row goes on air. They will give you a web address
          for this. Paste it here — it starts with https:// — one per line, up to five. OpenCall sends them the row on air and the next one.
        </span>
        <textarea
          className="input"
          rows={3}
          aria-label="Web addresses to tell, one per line"
          placeholder="https://example.com/hooks/cue"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span style={{ display: "flex", gap: "var(--space-2)" }}>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setNote(null);
              void api
                .saveSignals(
                  rundownId,
                  text
                    .split(/\s+/)
                    .map((u) => u.trim())
                    .filter(Boolean),
                )
                .then((d) => {
                  setData(d);
                  setNote({ ok: true, text: "Saved. Press Send a test to check it works." });
                })
                .catch((e: unknown) => setNote({ ok: false, text: e instanceof Error ? e.message : String(e) }))
                .finally(() => setBusy(false));
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={busy || !data?.webhooks.length}
            onClick={() => {
              setBusy(true);
              void api
                .testSignals(rundownId)
                .then(() => load())
                .finally(() => setBusy(false));
            }}
          >
            Send a test
          </button>
        </span>
        {note && <span className={note.ok ? "find-done" : "find-count"} style={note.ok ? undefined : { color: "var(--over)" }}>{note.text}</span>}
      </section>

      {data && data.deliveries.length > 0 && (
        <section className="signals-sec">
          <span className="signals-h">Recently sent</span>
          <ul className="find-list">
            {data.deliveries.map((d, i) => (
              <li key={i} className="signals-log">
                <span style={{ color: d.ok ? "var(--under)" : "var(--over)" }} aria-label={d.ok ? "Worked" : "Failed"}>
                  {d.ok ? Icon.check : Icon.close}
                </span>
                <span className="find-where">
                  {d.host}
                  {d.test ? " (test)" : ""}
                </span>
                <span className="find-col">
                  {d.ok ? `Got through (${d.ms} ms)` : (d.error ?? `It answered with an error (code ${d.status})`)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="signals-sec">
        <span className="signals-h">For equipment at the venue</span>
        <span className="signals-p">
          Equipment on the venue's own network can't be reached from the internet, but it can ask OpenCall. Give it this address and it can check what
          is on air now, and what is next — Companion on a Stream Deck can do this, for example. Swap YOUR-VIEW-CODE for the code of one of this sheet's
          view-only links.
        </span>
        <code className="signals-code">{nowUrl}</code>
      </section>
    </div>
  );
}
