/**
 * The sheet's epoch, fetched by the web server while it renders the page — not
 * by the browser after it has loaded. SERVER ONLY: imported by page.tsx files.
 *
 * The document socket cannot open until the epoch is known — it is part of the
 * document's name — so the browser used to sit through a full cross-origin
 * round trip before it could even start connecting: DNS, TCP, TLS and a SELECT,
 * measured at 326-500ms on production, entirely in series ahead of the 1.7MB
 * the sheet still had to fetch. And it happened from wherever the operator is,
 * which for this app is often a long way from the server.
 *
 * From here it is one hop between two machines in the same place, and the
 * answer arrives in the HTML. The browser opens its socket in its first frame.
 * The same call answers whether the event has been ended, which the sheet
 * pages would otherwise ask separately.
 *
 * The show page has done this since August; on 23 Oct the edit page, the crew
 * view, the timer, the display and the prompter followed, after the speed
 * check timed the ones that still asked from the browser (0.4 s each from
 * Sydney, before their socket could even start).
 *
 * If it fails for any reason, nothing is passed and the client falls back to
 * fetching it exactly as before. A slow answer here must never be the thing
 * that stops a run sheet opening.
 */
export async function prefetchEpoch(id: string): Promise<{ epoch: number; viewingClosed: boolean } | undefined> {
  // SYNC_INTERNAL_URL: the sync server as THIS server reaches it, when that is
  // not the public address — a private network on the host, or the speed
  // check, whose public address deliberately goes through a slowed link.
  const base = process.env.SYNC_INTERNAL_URL ?? process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:8787";
  try {
    const res = await fetch(`${base}/rundowns/${encodeURIComponent(id)}/epoch`, { cache: "no-store" });
    if (!res.ok) return undefined; // 404 included: let the client report it the way it always has
    const body = (await res.json()) as { epoch?: unknown; viewingClosed?: unknown };
    if (typeof body.epoch !== "number") return undefined;
    return { epoch: body.epoch, viewingClosed: body.viewingClosed === true };
  } catch {
    return undefined;
  }
}
