import { PlatformStoreDetail } from "@/features/plataforma/PlatformStoreDetail";

export default function PlatformStoreRoute({ params }: { params: { id: string } }) {
  return <PlatformStoreDetail key={params.id} id={params.id} />;
}
