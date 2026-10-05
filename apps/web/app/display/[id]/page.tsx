import { DisplayView } from "../../../components/DisplayView";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ code?: string }>;
}) {
  const { id } = await params;
  const { code } = await searchParams;
  return <DisplayView rundownId={id} joinCode={code} />;
}
