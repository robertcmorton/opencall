import { RundownEditor } from "../../../components/RundownEditor";

/**
 * The sheet's epoch is fetched HERE, on the server, not from the browser.
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
 *
 * The same call answers the second question this page asked separately — has
 * the event been ended — so two round trips become none.
 *
 * If it fails for any reason, nothing is passed and the client falls back to
 * fetching it exactly as before. A slow answer here must never be the thing
 * that stops a run sheet opening.
 */
async function prefetchEpoch(id: string): Promise<{ epoch: number; viewingClosed: boolean } | undefined> {
  const base = process.env.NEXT_PUBLIC_SYNC_HTTP_URL ?? "http://localhost:8787";
  try {
    const res = await fetch(`${base}/rundowns/${id}/epoch`, { cache: "no-store" });
    if (!res.ok) return undefined; // 404 included: let the client report it the way it always has
    const body = (await res.json()) as { epoch?: unknown; viewingClosed?: unknown };
    if (typeof body.epoch !== "number") return undefined;
    return { epoch: body.epoch, viewingClosed: body.viewingClosed === true };
  } catch {
    return undefined;
  }
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  const prefetched = await prefetchEpoch(id);
  return (
    <RundownEditor
      rundownId={id}
      mode="show"
      joinCode={code}
      initialEpoch={prefetched?.epoch}
      initialViewingClosed={prefetched?.viewingClosed}
    />
  );
}
