"use client";

import { API_URL, getAdminToken, getActiveJoinCode } from "./api";
import { deviceId, safePath } from "./deviceId";

/**
 * The last few things this browser did (24 Oct 2026): pages opened, buttons
 * pressed, the show link coming and going, requests that failed. Kept in
 * memory and sent only with an error report, so a fault arrives with the
 * steps that led to it instead of a bare message.
 *
 * Names, never contents: a button by its label, a page by its address. Nothing
 * typed is recorded.
 */
export interface TrailStep {
  at: number;
  kind: "page" | "click" | "link" | "request";
  what: string;
}

const MAX = 30;
const steps: TrailStep[] = [];

export function trailStep(kind: TrailStep["kind"], what: string): void {
  steps.push({ at: Date.now(), kind, what: what.slice(0, 120) });
  if (steps.length > MAX) steps.shift();
}

export const trailSoFar = (): TrailStep[] => steps.slice();

// ── Pages opened, on the server's activity trail ──────────────────────────────
// Pages go to the server as well as into the trail: "who opened what, when" is
// half of what the timeline is for. Sent in small batches, and on the way out.
let queue: { path: string; at: number }[] = [];
let timer: number | null = null;

function flush(): void {
  if (timer != null) window.clearTimeout(timer);
  timer = null;
  if (queue.length === 0) return;
  const events = queue.splice(0, 20);
  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const admin = getAdminToken();
    if (admin) headers.authorization = `Bearer ${admin}`;
    const code = getActiveJoinCode();
    if (code) headers["x-join-code"] = code;
    const device = deviceId();
    if (device) headers["x-oc-device"] = device;
    void fetch(`${API_URL}/activity`, { method: "POST", headers, body: JSON.stringify({ events }), keepalive: true }).catch(() => undefined);
  } catch {
    /* never throw from the recorder */
  }
}

let lastPage: { path: string; at: number } | null = null;

export function trailPage(pathname: string): void {
  const path = safePath(pathname);
  // Once per arrival: React runs effects twice in development, and a page
  // that re-renders its address must not count as opened again.
  if (lastPage && lastPage.path === path && Date.now() - lastPage.at < 2000) return;
  lastPage = { path, at: Date.now() };
  trailStep("page", path);
  queue.push({ path, at: Date.now() });
  if (queue.length >= 20) flush();
  else if (timer == null) timer = window.setTimeout(flush, 4000);
}

/**
 * Buttons and links pressed, from one listener on the whole page. Installed
 * once, from the layout's client chunk, alongside the error listeners.
 */
let installed = false;
export function installTrail(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  document.addEventListener(
    "click",
    (e) => {
      const el = (e.target as Element | null)?.closest?.("button, a, [role=button], [role=menuitem], [role=tab]");
      if (!el) return;
      const label = el.getAttribute("aria-label") || (el as HTMLElement).innerText || el.getAttribute("title") || el.tagName.toLowerCase();
      trailStep("click", label.replace(/\s+/g, " ").trim().slice(0, 60));
    },
    { capture: true, passive: true },
  );
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}
