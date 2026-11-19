import type { Metadata } from "next";
import { MesaCardapioPage } from "@/features/operacao/MesaCardapioPage";

export const metadata: Metadata = { title: "Cardápio da mesa", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function Page({ params }: { params: { slug: string; token: string } }) {
  return <MesaCardapioPage slug={params.slug} token={params.token} />;
}
