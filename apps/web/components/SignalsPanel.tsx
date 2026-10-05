"use client";

import { useEffect, useState } from "react";
import { api, API_URL } from "../lib/api";

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
          ✕
        </button>
      </div>

      <section className="signals-sec">
        <span className="signals-h">When a row goes on air, call these addresses</span>
        <span className="signals-p">One per line, https only, up to five. OpenCall sends the row on air and the next one, as JSON. Private network addresses are refused.</span>
        <textarea className="input" rows={3} placeholder="https://example.com/hooks/cue" value={text} onChange={(e) => setText(e.target.value)} />
        <span style={{ display: "flex", gap: 6 }}>
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
                  setNote({ ok: true, text: "Saved." });
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
          <span className="signals-h">Recent</span>
          <ul className="find-list">
            {data.deliveries.map((d, i) => (
              <li key={i} className="signals-log">
                <span style={{ color: d.ok ? "var(--under)" : "var(--over)" }}>{d.ok ? "✓" : "✕"}</span>
                <span className="find-where">
                  {d.host}
                  {d.test ? " (test)" : ""}
                </span>
                <span className="find-col">{d.ok ? `${d.status} · ${d.ms} ms` : (d.error ?? `HTTP ${d.status}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="signals-sec">
        <span className="signals-h">For equipment at the venue</span>
        <span className="signals-p">
          Point Companion, a graphics machine or a script at this address to ask what is on air now (and next). Replace YOUR-VIEW-CODE with the code of a
          view-only link for this sheet.
        </span>
        <code className="signals-code">{nowUrl}</code>
      </section>
    </div>
  );
}
