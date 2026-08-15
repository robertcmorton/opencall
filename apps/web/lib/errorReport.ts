"use client";

import { API_URL } from "./api";

// Everything that breaks in a browser gets journaled on the server so it can
// be reviewed (and fixed) from the admin dashboard's Error log. Reporting is
// best-effort and deduplicated — it must never cause errors of its own.

const seen = new Set<string>();
let budget = 20; // per page load

export function reportClientError(message: string, stack?: string | null): void {
  try {
    const key = message.slice(0, 200);
    if (budget <= 0 || seen.has(key)) return;
    seen.add(key);
    budget -= 1;
    void fetch(`${API_URL}/client-errors`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: message.slice(0, 2000),
        stack: stack?.slice(0, 8000),
        url: typeof window === "undefined" ? undefined : window.location.href,
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* never throw from the reporter */
  }
}

/**
 * Listen for errors BEFORE React hydrates, not after.
 *
 * This is why the journal has been blind to a whole class of fault. The
 * listeners were registered inside a `useEffect`, and React reports a hydration
 * mismatch during the COMMIT — `onRecoverableError`, which Next forwards to
 * `window.reportError` — while passive effects run one scheduler task LATER.
 * So the error was dispatched, went uncaught, printed "Minified React error
 * #418" to the console, and by the time our listener existed there was nothing
 * left to hear. Not a missing handler: a race, lost by one task, every time.
 *
 * It cost a real diagnosis. The production journal read as empty and healthy
 * while every single load of a run sheet was throwing a hydration error into
 * the console, and nothing on the server ever knew.
 *
 * Module scope is the fix. This module is imported by the layout's client
 * chunk, which Next evaluates before it calls `hydrateRoot`, so the listener is
 * live for anything the first commit reports. `useLayoutEffect` would also beat
 * the error loop, but only by ordering inside React — this does not depend on
 * that staying true.
 *
 * Idempotent, because a module can be evaluated more than once across chunks,
 * and two listeners would double-report everything.
 */
let installed = false;
type Recover = (message: string) => void;
export function installGlobalErrorHandlers(recover: Recover = () => undefined): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("error", (e: ErrorEvent) => {
    reportClientError(
      e.message || "window error",
      e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`,
    );
    recover(e.message ?? "");
  });
  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason = e.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason);
    reportClientError(`unhandled rejection: ${message}`, reason instanceof Error ? reason.stack : undefined);
    recover(message);
  });
}
