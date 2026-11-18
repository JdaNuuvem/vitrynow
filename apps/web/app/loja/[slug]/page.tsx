import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LojaRoot } from "@/features/loja/LojaRoot";
import { absoluteImageUrl, getMenuOnServer, storeDescription } from "@/lib/serverMenu";

// Cardápio público renderizado no servidor (ADR-0013): o HTML inicial já traz nome, categorias e
// produtos, e as tags Open Graph para o link compartilhado no WhatsApp/Instagram. O resultado fica em cache curto
// (ver lib/serverMenu.ts); o carrinho e o checkout hidratam no navegador. Loja suspensa (API-09) mostra só
// "indisponível", SEM dados da loja; loja removida vira 404.
type PageProps = { params: { slug: string } };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const result = await getMenuOnServer(params.slug);
  if (result.status !== "ok") return { title: "Cardápio", robots: { index: false } };

  const { store } = result.menu;
  const image = absoluteImageUrl(store.coverImageUrl) ?? absoluteImageUrl(store.logoUrl);
  const description = storeDescription(result.menu);
  return {
    title: `${store.name} — Cardápio`,
    description,
    openGraph: {
      type: "website",
      title: store.name,
      description,
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? "summary_large_image" : "summary", title: store.name, description },
  };
}

export default async function Page({ params }: PageProps) {
  const result = await getMenuOnServer(params.slug);
  if (result.status === "not-found") notFound();
  if (result.status === "suspended") {
    return (
      <main className="loja__message">
        <h1>Loja indisponível no momento</h1>
        <p>Tente novamente mais tarde.</p>
      </main>
    );
  }
  return <LojaRoot slug={params.slug} initialMenu={result.status === "ok" ? result.menu : undefined} />;
}
