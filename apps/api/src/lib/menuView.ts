import type { Store } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";
import { isSoldOutNow } from "./soldOut";
import { publicCategory, publicStore } from "./publicDto";
import { orderOptionFields } from "./orderItems";
import { optionGroupsService } from "../modules/optionGroups/optionGroups.module";

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
  // Os adicionais existentes vêm de ProductAdditional. O espelho da migração não passa pelo checkout novo.
  const groups = await optionGroupsService.groupsForProducts(store.id, categories.flatMap((category) => category.products.map((product) => product.id)), true);
  const now = new Date();
  const visibleCategories = categories.map(({ products, ...category }) => ({
    ...category,
    products: products
      .map(({ soldOut, soldOutUntil, ...product }) => {
        const optionFields = orderOptionFields(groups.get(product.id) ?? []);
        return { ...product, ...optionFields, soldOut: optionFields.unavailableByOptions || isSoldOutNow({ soldOut, soldOutUntil }, now) };
      })
      .filter((product) => !(store.hideSoldOutProducts && product.soldOut)),
  }));
  return { store: publicStore(store), categories: visibleCategories.map(publicCategory) };
}
