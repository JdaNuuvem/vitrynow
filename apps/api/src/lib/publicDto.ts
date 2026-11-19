// SEC-18 — LISTA DE PERMISSAO das respostas das rotas publicas (sem login). Cada rota publica monta a resposta SO por estas funcoes: um campo novo no
// banco (id da loja, data de criacao, `active`, posicao, qualquer coisa interna ou pessoal) NAO vaza por acidente, porque nada aqui e copiado em bloco.
// Adicionar um campo publico = editar esta lista de proposito (e o teste `public-dto.test.ts`, que trava o conjunto exato de chaves).
import type { Category, Product, ProductAdditional, Store } from "@meucardapio/db";
import type { orderOptionFields } from "./orderItems";

export const PUBLIC_STORE_KEYS = ["name", "slug", "logoUrl", "coverImageUrl", "primaryColor", "address", "whatsapp", "openingHours", "minOrderCents", "deliveryEnabled", "pickupEnabled", "acceptingOrders", "deliveryFeeCents", "hideSoldOutProducts"] as const;
export const PUBLIC_CATEGORY_KEYS = ["id", "name", "icon", "products"] as const;
export const PUBLIC_PRODUCT_KEYS = ["id", "name", "description", "imageUrl", "priceCents", "featured", "soldOut", "additionals", "fromPriceCents", "optionGroups", "unavailableByOptions"] as const;
export const PUBLIC_ADDITIONAL_KEYS = ["id", "name", "priceCents"] as const;

export const publicStore = (s: Store) => ({
  name: s.name,
  slug: s.slug,
  logoUrl: s.logoUrl,
  coverImageUrl: s.coverImageUrl,
  primaryColor: s.primaryColor,
  address: s.address,
  whatsapp: s.whatsapp,
  openingHours: s.openingHours,
  minOrderCents: s.minOrderCents,
  deliveryEnabled: s.deliveryEnabled,
  pickupEnabled: s.pickupEnabled,
  acceptingOrders: s.acceptingOrders && !s.platformSuspendedAt, // API-25: loja suspensa pela plataforma nao recebe pedido (cardapio publico)
  deliveryFeeCents: s.deliveryFeeCents,
  hideSoldOutProducts: s.hideSoldOutProducts, // API-17
});

export const publicAdditional = (a: ProductAdditional) => ({ id: a.id, name: a.name, priceCents: a.priceCents });

// `soldOutUntil` NAO entra no tipo: a rota ja o consumiu ao calcular o `soldOut` efetivo (API-17) e ele nao e publico.
type PublicProductInput = Omit<Product, "soldOutUntil"> & { additionals: ProductAdditional[] } & ReturnType<typeof orderOptionFields>;

export const publicProduct = (p: PublicProductInput) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  imageUrl: p.imageUrl,
  priceCents: p.priceCents,
  featured: p.featured,
  soldOut: p.soldOut, // API-17: valor EFETIVO agora (a rota o calcula com isSoldOutNow antes do DTO); `soldOutUntil` NAO e publico
  additionals: p.additionals.map(publicAdditional),
  fromPriceCents: p.fromPriceCents,
  optionGroups: p.optionGroups,
  unavailableByOptions: p.unavailableByOptions,
});

export const publicCategory = (c: Category & { products: PublicProductInput[] }) => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  products: c.products.map(publicProduct),
});
