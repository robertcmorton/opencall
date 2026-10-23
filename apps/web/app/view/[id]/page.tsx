import { RundownEditor } from "../../../components/RundownEditor";
import { ViewerGate } from "../../../components/ViewerGate";
import { prefetchEpoch } from "../../../lib/prefetchEpoch";

/** The epoch comes with the page — see lib/prefetchEpoch.ts. */
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
    <ViewerGate code={code}>
      <RundownEditor rundownId={id} mode="view" joinCode={code} initialEpoch={prefetched?.epoch} initialViewingClosed={prefetched?.viewingClosed} />
    </ViewerGate>
  );
}
