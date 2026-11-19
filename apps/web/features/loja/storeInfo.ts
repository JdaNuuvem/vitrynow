import type { Category, Product, StoreInfo } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";

export function isStoreAcceptingOrders(store: Pick<StoreInfo, "acceptingOrders" | "accepting">): boolean {
  return store.acceptingOrders && store.accepting !== false;
}

export function prepTimesLine(store: Pick<StoreInfo, "prepMinutes" | "deliveryEnabled" | "pickupEnabled">): string {
  const parts: string[] = [];
  const delivery = store.prepMinutes?.delivery;
  const pickup = store.prepMinutes?.pickup;
  if (store.deliveryEnabled && delivery != null) parts.push(`Entrega: ${delivery} min de preparo`);
  if (store.pickupEnabled && pickup != null) parts.push(`Retirada: ${pickup} min de preparo`);
  return parts.join(" · ");
}

// Regras de apresentação do cardápio v2 (spec 12). Funções puras: a tela só desenha o que sai daqui.

// "Mínimo R$ 20,00 · Entrega R$ 6,00 · Retirada": cada trecho só aparece se existir (spec 12 §2.4).
// Taxa zero com entrega ligada vira "Entrega grátis". Nada é inventado: só o que a loja cadastrou.
export function conditionsLine(store: Pick<StoreInfo, "minOrderCents" | "deliveryEnabled" | "pickupEnabled" | "deliveryFeeCents">): string {
  const parts: string[] = [];
  if (store.minOrderCents !== null && store.minOrderCents !== undefined) parts.push(`Mínimo ${formatCents(store.minOrderCents)}`);
  if (store.deliveryEnabled) parts.push(store.deliveryFeeCents > 0 ? `Entrega ${formatCents(store.deliveryFeeCents)}` : "Entrega grátis");
  if (store.pickupEnabled) parts.push("Retirada");
  return parts.join(" · ");
}

// Linha compacta (DV-V2-01, aceita pelo Claudio): categoria com MENOS DA METADE dos produtos com foto não usa o
// bloco de foto, para não parecer vazia. Exatamente metade ainda usa o bloco. Categoria sem produto: não importa.
export function isCompactCategory(category: Pick<Category, "products">): boolean {
  const total = category.products.length;
  if (total === 0) return false;
  const withPhoto = category.products.filter((product) => Boolean(product.imageUrl)).length;
  return withPhoto * 2 < total;
}

// Comportamento do "+" no cartão (spec 12 §3, regra do Leonardo; o servidor valida do mesmo jeito):
//  - "simple": sem adicionais → adiciona 1 e o "+" vira stepper (− n +);
//  - "options": só adicionais opcionais → adiciona 1 unidade SIMPLES (sem opções); o cartão mostra "Tem opções" e o
//    total do produto no selo, sem "−" (editar fica no carrinho);
//  - "detail": tem grupo obrigatório → o "+" abre o detalhe.
export type QuickAddMode = "simple" | "options" | "detail";

export function quickAddMode(product: Pick<Product, "additionals" | "optionGroups"> & { requiredGroups?: unknown[] }): QuickAddMode {
  if (product.requiredGroups?.length || product.optionGroups?.some((group) => group.minSelect > 0 || group.priceMode === "BASE")) return "detail";
  return product.additionals.length > 0 || product.optionGroups?.length ? "options" : "simple";
}

// Chip destacado na barra de categorias (spec 12 §2.1). Entradas: `spy` = categoria sob a linha de leitura (null se a
// página está acima da primeira seção), `pinned` = chip tocado enquanto a página está no fim, `atEnd` = o fim da página
// está à vista. Regras (parecer da Da Vinci, B1/A1):
//  - chip tocado e a página parou no fim: ele fica destacado (a categoria curta nunca chega à linha de leitura);
//  - no fim da página, rolando, a ÚLTIMA categoria é a destacada (idem), mas só se a leitura já saiu do topo:
//    num cardápio curto que cabe na tela o fim está à vista desde o início e o destaque é o da PRIMEIRA;
//  - acima da primeira seção (topo): sempre a PRIMEIRA categoria, nunca um valor guardado de antes.
export function activeCategoryId(input: { ids: string[]; spy: string | null; pinned: string | null; atEnd: boolean }): string | null {
  const { ids, spy, pinned, atEnd } = input;
  if (ids.length === 0) return null;
  if (pinned && atEnd && ids.includes(pinned)) return pinned;
  if (atEnd && spy !== null) return ids[ids.length - 1];
  return spy ?? ids[0];
}
