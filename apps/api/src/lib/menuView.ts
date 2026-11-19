import type { Store } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";
import { isSoldOutNow } from "./soldOut";
import { unavailableGroups, type GroupRow } from "../modules/optionGroups/optionGroups.domain";
import { PrismaOptionGroupsRepository } from "../modules/optionGroups/optionGroups.repository";
import { publicCampaign } from "../modules/campaign/campaign.service";
import { publicCategory, publicStore } from "./publicDto";

// Cardapio publico da loja (mesmo formato no link da loja e no QR da mesa). So produto ATIVO e DESTA loja (SEC-11).
// Lote 2: junta API-22 (builder unico para o link e o QR), API-17 (`soldOut` EFETIVO agora; com "esconder esgotados" o produto
// nem aparece) e SEC-18 (resposta so pela lista de permissao de `lib/publicDto.ts`, tambem no QR da mesa).
export async function buildMenuView(store: Store) {
  const categories = await prisma.category.findMany({
    where: { storeId: store.id },
    orderBy: { position: "asc" },
    include: {
      products: {
        where: { active: true, storeId: store.id },
        orderBy: { position: "asc" },
        include: { additionals: true },
      },
    },
  });
  const groupsByProduct = await new PrismaOptionGroupsRepository(prisma).groupsForProducts(store.id, categories.flatMap((c) => c.products.map((p) => p.id)));
  const now = new Date();
  const visibleCategories = categories.map(({ products, ...category }) => ({
    ...category,
    products: products
      .map(({ soldOut, soldOutUntil, ...product }) => {
        // O espelho LEGACY_ADDITIONALS ja sai em `additionals`; aqui so os grupos reais (sem duplicar a escolha).
        const real: GroupRow[] = (groupsByProduct.get(product.id) ?? []).filter((g) => g.source !== "LEGACY_ADDITIONALS");
        return { ...product, soldOut: isSoldOutNow({ soldOut, soldOutUntil }, now), optionGroups: real, unavailable: unavailableGroups(real).length > 0 };
      })
      .filter((product) => !(store.hideSoldOutProducts && product.soldOut)),
  }));
  return { store: { ...publicStore(store), campaign: await publicCampaign(store.id) }, categories: visibleCategories.map(publicCategory) };
}
