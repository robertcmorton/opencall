import { PrompterView } from "../../../components/PrompterView";
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
  return <PrompterView rundownId={id} joinCode={code} initialEpoch={prefetched?.epoch} />;
}
