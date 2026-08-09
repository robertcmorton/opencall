import { AcceptInvite } from "../../../components/AcceptInvite";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <AcceptInvite token={token} />;
}
