"use client";

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { describeDevice, rememberName, viewerName } from "../lib/viewerIdentity";
import { BrandWordmark } from "./ui";

/**
 * Asks who is holding a view-only link, once, before the sheet appears.
 *
 * These links get forwarded — that is what they are for — so the showcaller
 * needs a name against each device rather than a count of connections. Asked
 * before the sheet rather than after, because nobody answers a question they
 * can already see past.
 *
 * The name is remembered on the device, so this is a once-per-device
 * interruption and not a login. If the recording fails the sheet still opens:
 * someone on a venue wifi holding a run sheet is not going to be turned away
 * over a piece of bookkeeping.
 */
export function ViewerGate({ code, children }: { code?: string; children: React.ReactNode }) {
  const [name, setName] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const known = viewerName();
    setName(known);
    setReady(true);
    if (known && code) void report(known, code);
  }, [code]);

  // A link with no code is someone already signed in; there is nothing to ask.
  if (!code) return <>{children}</>;
  if (!ready) return null;
  if (name) return <>{children}</>;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = typed.trim();
    if (!value) return;
    rememberName(value);
    setName(value);
    void report(value, code);
  };

  return (
    <main className="viewer-gate">
      <div className="vg-card">
        <BrandWordmark size={20} />
        <h1 className="vg-title">Who&rsquo;s watching?</h1>
        <p className="vg-blurb">
          This link opens the run sheet read-only. Your name goes on the crew list so the showcaller knows the sheet reached
          you.
        </p>
        <form onSubmit={submit} className="vg-form">
          <input
            className="input"
            autoFocus
            value={typed}
            maxLength={60}
            placeholder="Your name — e.g. Sam, Camera 2"
            onChange={(e) => setTyped(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={!typed.trim()}>
            Open the run sheet
          </button>
        </form>
        <p className="vg-note">
          Recorded with your name: the browser and operating system you are using, your screen size, and the network
          address you connected from. It is shown to whoever runs this run sheet, and goes when the link is revoked.
        </p>
      </div>
    </main>
  );
}

function report(name: string, code: string): Promise<void> {
  return api
    .recordViewer(code, describeDevice(name))
    .then(() => undefined)
    .catch(() => {
      // Never a reason to withhold the sheet — see the note above.
    });
}
