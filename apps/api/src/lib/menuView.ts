import type { Store } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";

// Cardápio público da loja (mesmo formato no link da loja e no QR da mesa). Só produto ATIVO e DESTA loja (SEC-11).
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
  return {
    store: {
      name: store.name,
      slug: store.slug,
      logoUrl: store.logoUrl,
      coverImageUrl: store.coverImageUrl,
      primaryColor: store.primaryColor,
      address: store.address,
      whatsapp: store.whatsapp,
      openingHours: store.openingHours,
      minOrderCents: store.minOrderCents,
      deliveryEnabled: store.deliveryEnabled,
      pickupEnabled: store.pickupEnabled,
      acceptingOrders: store.acceptingOrders,
      deliveryFeeCents: store.deliveryFeeCents,
    },
    categories,
  };
}
