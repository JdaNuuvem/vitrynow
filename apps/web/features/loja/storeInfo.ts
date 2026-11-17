import type { Category, Product, StoreInfo } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";

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
//  - "detail": tem grupo obrigatório → o "+" abre o detalhe. Ainda não existe grupo obrigatório no modelo (API-15);
//    quando o contrato trouxer `requiredGroups`, este é o ponto de ligação.
export type QuickAddMode = "simple" | "options" | "detail";

export function quickAddMode(product: Pick<Product, "additionals"> & { requiredGroups?: unknown[] }): QuickAddMode {
  if (product.requiredGroups && product.requiredGroups.length > 0) return "detail";
  return product.additionals.length > 0 ? "options" : "simple";
}
