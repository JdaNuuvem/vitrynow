import { LojaRoot } from "@/features/loja/LojaRoot";

export default function Page({ params }: { params: { slug: string } }) {
  return <LojaRoot slug={params.slug} />;
}
