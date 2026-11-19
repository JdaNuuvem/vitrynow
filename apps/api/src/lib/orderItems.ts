// API-15 (B8): monta as linhas do pedido para as rotas da MESA e do PAINEL (a vitrine publica tem o mesmo desenho em routes/storefront.ts).
// O preco vem SO do servidor (RN-B8-03); a escolha vira copia imutavel (RN-B8-07); opcao de outra loja/produto/inativa/inexistente = mesma resposta (RN-B8-02).
import type { Product, ProductAdditional } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";
import { fromPriceCents, resolveLine, unavailableGroups, type GroupRow, type OptionCopy } from "../modules/optionGroups/optionGroups.domain";
import { CodedError } from "../shared/errors";
import { PrismaOptionGroupsRepository } from "../modules/optionGroups/optionGroups.repository";

// Os valores agregados do pedido são INTEGER no PostgreSQL.
const MAX_ORDER_CENTS = 2_147_483_647;
// R1 (Nightingale): teto de seleções de opção SEM login. Por item e por pedido; acima disso 400 antes de qualquer consulta cara.
export const MAX_OPTION_SELECTIONS_PER_ITEM = 30;
export const MAX_OPTION_SELECTIONS_PER_ORDER = 200;

export const orderMoneyFits = (cents: number) => Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_ORDER_CENTS;
export function assertOrderMoneyFits(cents: number) {
  if (!orderMoneyFits(cents)) throw new CodedError(400, "ORDER_VALUE_TOO_HIGH", "O pedido excede o limite de valor. Divida em pedidos menores.");
}
const TOO_HIGH = ["O pedido excede o limite de valor. Divida em pedidos menores.", "ORDER_VALUE_TOO_HIGH"] as const;

// `optionSelections` (nome que o front usa) é ALIAS de `options`: mesma regra, mesmo preço.
type InputItem = {
  productId: string;
  quantity: number;
  notes?: string | null;
  additionalIds?: string[];
  options?: Array<{ optionId: string; quantity?: number }>;
  optionSelections?: Array<{ optionId: string; quantity?: number }>;
  expectedUnitPriceCents?: number;
};

export type OrderLine = {
  productId: string;
  productName: string;
  quantity: number;
  unitPriceCents: number;
  notes?: string | null;
  lineTotalCents: number;
  additionals: Array<{ name: string; priceCents: number }>;
  optionCopies: OptionCopy[];
};

export type OrderLinesResult = { ok: true; lines: OrderLine[] } | { ok: false; status: number; body: { error: string; code: string; issues?: unknown[]; details?: unknown } };

export async function buildOrderLines(storeId: string, products: Array<Product & { additionals: ProductAdditional[] }>, items: InputItem[]): Promise<OrderLinesResult> {
  const fail = (status: number, error: string, code: string, extra: { issues?: unknown[]; details?: unknown } = {}): OrderLinesResult => ({ ok: false, status, body: { error, code, ...extra } });
  // R1: tetos ANTES de qualquer consulta; `options` e `optionSelections` juntos no mesmo item são ambíguos.
  let totalSelections = 0;
  for (const item of items) {
    if (item.options && item.optionSelections) return fail(400, "Envie `options` OU `optionSelections` no mesmo item, não os dois.", "OPTIONS_AMBIGUOUS");
    const count = (item.options ?? item.optionSelections ?? []).length;
    if (count > MAX_OPTION_SELECTIONS_PER_ITEM) return fail(400, "Há opções demais neste item.", "OPTIONS_TOO_MANY");
    totalSelections += count;
  }
  if (totalSelections > MAX_OPTION_SELECTIONS_PER_ORDER) return fail(400, "Há opções demais neste pedido.", "OPTIONS_TOO_MANY");
  const productById = new Map(products.map((p) => [p.id, p]));
  const groupsByProduct = await new PrismaOptionGroupsRepository(prisma).groupsForProducts(storeId, [...productById.keys()]);
  const issues: Array<{ productId: string; code: string; message: string; groupId?: string }> = [];
  const lines: OrderLine[] = [];
  const priceChanged: Array<{ index: number; productId: string; name: string; unitPriceCents: number }> = [];
  for (const [index, item] of items.entries()) {
    const selected = item.options ?? item.optionSelections;
    const product = productById.get(item.productId)!;
    const groups: GroupRow[] = groupsByProduct.get(product.id) ?? [];
    const realGroups = groups.filter((g) => g.source !== "LEGACY_ADDITIONALS");
    // Adicional LEGADO e opções podem vir no mesmo item (o front mistura): o adicional soma POR CIMA do unitário, as opções já estão nele.
    // O mesmo id nos dois (o espelho LEGACY tem o id do adicional) cobraria em dobro: recusa.
    const chosenAdditionals: ProductAdditional[] = [];
    const picked = new Set((selected ?? []).map((o) => o.optionId));
    for (const id of item.additionalIds ?? []) {
      const additional = product.additionals.find((a) => a.id === id);
      if (!additional) return fail(400, `adicional ${id} não pertence ao produto ${product.id}`, "ADDITIONAL_NOT_FOUND");
      if (picked.has(id)) return fail(400, "O mesmo item foi enviado como opção e como adicional.", "OPTIONS_AMBIGUOUS");
      chosenAdditionals.push(additional);
    }
    const additionalsCents = chosenAdditionals.reduce((sum, a) => sum + a.priceCents, 0);
    if (realGroups.length > 0 || selected) {
      const resolved = resolveLine({ name: product.name, priceCents: product.priceCents }, groups, selected ?? []);
      if (!resolved.ok) {
        for (const issue of resolved.issues) issues.push({ productId: product.id, code: issue.code, message: issue.message, groupId: issue.groupId });
        return fail(400, "As opções escolhidas não são válidas.", "OPTION_INVALID", { issues });
      }
      const unitTotal = resolved.unitPriceCents + additionalsCents;
      if (!orderMoneyFits(unitTotal * item.quantity)) return fail(400, ...TOO_HIGH);
      if (item.expectedUnitPriceCents !== undefined && item.expectedUnitPriceCents !== unitTotal) priceChanged.push({ index, productId: product.id, name: product.name, unitPriceCents: unitTotal });
      lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, unitPriceCents: resolved.unitPriceCents, notes: item.notes, lineTotalCents: unitTotal * item.quantity, additionals: chosenAdditionals.map(({ name, priceCents }) => ({ name, priceCents })), optionCopies: resolved.copies });
      continue;
    }
    const extra = additionalsCents;
    const chosen = chosenAdditionals;
    if (!orderMoneyFits((product.priceCents + extra) * item.quantity)) return fail(400, ...TOO_HIGH);
    // `expectedUnitPriceCents` compara com o TOTAL por unidade (base + opções SOMA + adicionais legados), nunca com o campo gravado, e SÓ gera 409: nunca vira preço.
    if (item.expectedUnitPriceCents !== undefined && item.expectedUnitPriceCents !== product.priceCents + extra) priceChanged.push({ index, productId: product.id, name: product.name, unitPriceCents: product.priceCents + extra });
    lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, unitPriceCents: product.priceCents, notes: item.notes, lineTotalCents: (product.priceCents + extra) * item.quantity, additionals: chosen, optionCopies: [] });
  }
  if (!orderMoneyFits(lines.reduce((sum, l) => sum + l.lineTotalCents, 0))) return fail(400, ...TOO_HIGH);
  if (priceChanged.length > 0) return fail(409, "O preço de um item mudou. Confira o carrinho antes de confirmar.", "ITEM_PRICE_CHANGED", { details: { items: priceChanged } });
  return { ok: true, lines };
}

/** Parte `options` do `create` do item (cópia na MESMA transação do pedido). */
export const optionCopiesCreate = (copies: OptionCopy[]) =>
  copies.length > 0 ? { options: { create: copies.map((o) => ({ groupName: o.groupName, name: o.name, priceCents: o.priceCents, quantity: o.quantity, priceMode: o.priceMode })) } } : {};

/** Campos públicos de opções do produto (catálogo do painel e cardápio): só grupos NATIVOS, opções ATIVAS, sem ids de loja nem metadados internos. */
export function orderOptionFields(groups: GroupRow[]) {
  const unavailable = unavailableGroups(groups).length > 0;
  return {
    fromPriceCents: fromPriceCents(groups),
    unavailableByOptions: unavailable,
    unavailable, // nome da main (API-15 p3); `unavailableByOptions` é o que o front lê
    optionGroups: groups.map((group) => ({
      id: group.id,
      name: group.name,
      helpText: group.helpText ?? null,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      maxPerOption: group.maxPerOption,
      priceMode: group.priceMode,
      options: group.options.filter((option) => option.active).map(({ id, name, priceCents }) => ({ id, name, priceCents })),
    })),
  };
}
