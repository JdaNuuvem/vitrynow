import type { Category, MenuBannerConfig, MenuBannerTarget, Product } from "@/core/domain/storefront";
export type { MenuBannerConfig, MenuBannerTarget } from "@/core/domain/storefront";

// Adicione campanhas somente com conteúdo autorizado e IDs do catálogo da respectiva loja.
// Uma alteração aqui exige nova entrega do frontend; não é uma configuração persistida da loja.
const bannersByStore: Readonly<Record<string, MenuBannerConfig>> = {};

export function bannerForStore(slug: string): MenuBannerConfig | undefined {
  if (process.env.NEXT_PUBLIC_LOCAL_RAMENKU === "1" && slug === "ramenku") {
    return {
      id: "ramen-da-casa",
      title: "Ramen da casa",
      description: "Escolha seu caldo e os seus adicionais.",
      imageUrl: "/campanhas/ramenku-tigela.webp",
      imageLayout: "cutout",
      action: { label: "Ver ramen", target: { kind: "category", id: "local-ramenku-ramen" } },
    };
  }
  return Object.prototype.hasOwnProperty.call(bannersByStore, slug) ? bannersByStore[slug] : undefined;
}

type ResolvedBannerTarget = { kind: "category"; id: string } | { kind: "product"; product: Product };

// Resolvido contra o menu atual: campanhas antigas não deixam ações apontando para itens removidos.
export function resolveBannerTarget(target: MenuBannerTarget, categories: Category[]): ResolvedBannerTarget | undefined {
  if (target.kind === "category") {
    const category = categories.find((item) => item.id === target.id && item.products.length > 0);
    return category ? { kind: "category", id: category.id } : undefined;
  }

  for (const category of categories) {
    const product = category.products.find((item) => item.id === target.id);
    if (product) return { kind: "product", product };
  }
  return undefined;
}
