import { RundownEditor } from "../../../components/RundownEditor";
import { ViewerGate } from "../../../components/ViewerGate";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  return (
    <ViewerGate code={code}>
      <RundownEditor rundownId={id} mode="view" joinCode={code} />
    </ViewerGate>
  );
}
