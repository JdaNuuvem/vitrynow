// SEC-18 — LISTA DE PERMISSAO das respostas das rotas publicas (sem login). Cada rota publica monta a resposta SO por estas funcoes: um campo novo no
// banco (id da loja, data de criacao, `active`, posicao, qualquer coisa interna ou pessoal) NAO vaza por acidente, porque nada aqui e copiado em bloco.
// Adicionar um campo publico = editar esta lista de proposito (e o teste `public-dto.test.ts`, que trava o conjunto exato de chaves).
import type { GroupRow } from "../modules/optionGroups/optionGroups.domain";
import type { Category, Product, ProductAdditional, Store } from "@meucardapio/db";
import { safeTimeZone } from "./storeTime";

export const PUBLIC_STORE_KEYS = ["name", "slug", "logoUrl", "coverImageUrl", "primaryColor", "address", "whatsapp", "openingHours", "minOrderCents", "deliveryEnabled", "pickupEnabled", "acceptingOrders", "deliveryFeeCents", "hideSoldOutProducts", "timezone", "menuLayout"] as const;
// Campanha publicada (CONTRATO-CAMPANHA): `action` so existe quando o destino ainda existe.
export const PUBLIC_CAMPAIGN_KEYS = ["id", "title", "description", "imageUrl", "imageLayout", "imagePosition"] as const;
// Horário DERIVADO da grade (PR-01, SSOT D2): acrescentados pelo portão público do cardápio (subscriptionGate), não pelo `publicStore`.
export const PUBLIC_STORE_HOURS_KEYS = ["openNow", "nextOpensAt", "hoursText"] as const;
// Modo ocupado (g1): `busyUntil` (ISO|null) e `reason` (motivo fechado de `hours.reason`; null quando aberta). `accepting` já existe: NÃO há `acceptingNow`. `busyStartedAt`/`busyExtraMinutes` não vazam.
export const PUBLIC_STORE_BUSY_KEYS = ["busyUntil", "reason"] as const;
export const PUBLIC_CATEGORY_KEYS = ["id", "name", "icon", "products"] as const;
export const PUBLIC_PRODUCT_KEYS = ["id", "name", "description", "imageUrl", "priceCents", "featured", "soldOut", "additionals", "optionGroups", "unavailable", "unavailableByOptions", "fromPriceCents", "tags", "promoCents", "promoEndsAt", "saleUnit", "minGrams", "stepGrams", "maxGrams", "portionGrams", "serves", "isSingleDish", "sellAlone", "model3dUrl"] as const;
export const PUBLIC_ADDITIONAL_KEYS = ["id", "name", "priceCents"] as const;
// API-15 parte 3 (B8): grupos de opcoes REAIS (MANUAL) do produto. Sem `source`, `active`, `position` nem ids de loja. So opcoes ATIVAS.
export const PUBLIC_OPTION_GROUP_KEYS = ["id", "name", "helpText", "minSelect", "maxSelect", "maxPerOption", "priceMode", "options"] as const;
export const PUBLIC_OPTION_KEYS = ["id", "name", "priceCents"] as const;

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
  timezone: safeTimeZone(s.timezone), // fuso inválido gravado no passado não chega cru ao cardápio: cai no padrão
  menuLayout: s.menuLayout, // modelo do cardápio: CLASSIC ou REELS
});

export const publicAdditional = (a: ProductAdditional) => ({ id: a.id, name: a.name, priceCents: a.priceCents });

export const publicOptionGroup = (g: GroupRow) => ({
  id: g.id,
  name: g.name,
  helpText: g.helpText ?? null,
  minSelect: g.minSelect,
  maxSelect: g.maxSelect,
  maxPerOption: g.maxPerOption,
  priceMode: g.priceMode,
  options: g.options.filter((o) => o.active).map((o) => ({ id: o.id, name: o.name, priceCents: o.priceCents })),
});

// `soldOutUntil` NAO entra no tipo: a rota ja o consumiu ao calcular o `soldOut` efetivo (API-17) e ele nao e publico.
type PublicProductInput = Omit<Product, "soldOutUntil"> & { additionals: ProductAdditional[]; optionGroups: GroupRow[]; unavailable: boolean; fromPriceCents: number | null; promoActiveNow: boolean };

export const publicProduct = (p: PublicProductInput) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  imageUrl: p.imageUrl,
  priceCents: p.priceCents,
  featured: p.featured,
  soldOut: p.soldOut, // API-17: valor EFETIVO agora (a rota o calcula com isSoldOutNow antes do DTO); `soldOutUntil` NAO e publico
  additionals: p.additionals.map(publicAdditional),
  optionGroups: p.optionGroups.map(publicOptionGroup),
  unavailableByOptions: p.unavailable, // nome que o front le (mesmo valor de `unavailable`)
  fromPriceCents: p.fromPriceCents, // "a partir de R$ X" (RN-B8-04): menor opcao ativa do grupo BASE; null sem variacao
  // Produto detalhado (PD, §7 da spec): a promoção SÓ aparece enquanto ativa AGORA (futura/vencida nunca; `promoStartsAt` nunca é público); sem `sku`, `listPriceCents`, `storeId`.
  promoCents: p.promoActiveNow ? p.promoCents : null,
  promoEndsAt: p.promoActiveNow ? p.promoEndsAt : null,
  tags: p.tags, // selos (lista fechada); `sku` nunca é público
  saleUnit: p.saleUnit,
  minGrams: p.saleUnit === "UN" ? null : p.minGrams,
  stepGrams: p.saleUnit === "UN" ? null : p.stepGrams,
  maxGrams: p.saleUnit === "UN" ? null : p.maxGrams,
  portionGrams: p.saleUnit === "UN" ? p.portionGrams : null, // por peso não mostra gramatura (RN-PD-27)
  serves: p.saleUnit === "UN" ? p.serves : null,
  isSingleDish: p.isSingleDish,
  sellAlone: p.sellAlone,
  model3dUrl: p.model3dPublished ? p.model3dUrl : null, // PRATO 3D: rascunho nunca é público
  unavailable: p.unavailable, // RN-B8-05: grupo obrigatorio sem opcao ativa => nao da para pedir (calculado pela rota)
});

export const publicCategory = (c: Category & { products: PublicProductInput[] }) => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  products: c.products.map(publicProduct),
});
