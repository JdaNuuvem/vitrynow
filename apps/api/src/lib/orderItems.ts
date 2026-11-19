// API-15 (B8): monta as linhas do pedido para as rotas da MESA e do PAINEL (a vitrine publica tem o mesmo desenho em routes/storefront.ts).
// O preco vem SO do servidor (RN-B8-03); a escolha vira copia imutavel (RN-B8-07); opcao de outra loja/produto/inativa/inexistente = mesma resposta (RN-B8-02).
import type { Product, ProductAdditional } from "@meucardapio/db";
import { prisma } from "@meucardapio/db";
import { resolveLine, type GroupRow, type OptionCopy } from "../modules/optionGroups/optionGroups.domain";
import { PrismaOptionGroupsRepository } from "../modules/optionGroups/optionGroups.repository";

type InputItem = { productId: string; quantity: number; notes?: string | null; additionalIds?: string[]; options?: Array<{ optionId: string; quantity?: number }> };

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

export type OrderLinesResult = { ok: true; lines: OrderLine[] } | { ok: false; body: { error: string; code: string; issues?: unknown[] } };

export async function buildOrderLines(storeId: string, products: Array<Product & { additionals: ProductAdditional[] }>, items: InputItem[]): Promise<OrderLinesResult> {
  const productById = new Map(products.map((p) => [p.id, p]));
  const groupsByProduct = await new PrismaOptionGroupsRepository(prisma).groupsForProducts(storeId, [...productById.keys()]);
  const issues: Array<{ productId: string; code: string; message: string; groupId?: string }> = [];
  const lines: OrderLine[] = [];
  for (const item of items) {
    const product = productById.get(item.productId)!;
    const groups: GroupRow[] = groupsByProduct.get(product.id) ?? [];
    const realGroups = groups.filter((g) => g.source !== "LEGACY_ADDITIONALS");
    if (item.options && item.additionalIds?.length) return { ok: false, body: { error: "Envie `options` OU `additionalIds` no mesmo item, não os dois.", code: "OPTIONS_AMBIGUOUS" } };
    if (realGroups.length > 0 || item.options) {
      const resolved = resolveLine({ name: product.name, priceCents: product.priceCents }, groups, item.options ?? []);
      if (!resolved.ok) {
        for (const issue of resolved.issues) issues.push({ productId: product.id, code: issue.code, message: issue.message, groupId: issue.groupId });
        return { ok: false, body: { error: "As opções escolhidas não são válidas.", code: "OPTION_INVALID", issues } };
      }
      lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, unitPriceCents: resolved.unitPriceCents, notes: item.notes, lineTotalCents: resolved.unitPriceCents * item.quantity, additionals: [], optionCopies: resolved.copies });
      continue;
    }
    const byId = new Map(product.additionals.map((a) => [a.id, a]));
    const chosen: ProductAdditional[] = [];
    for (const id of item.additionalIds ?? []) {
      const additional = byId.get(id);
      if (!additional) return { ok: false, body: { error: `adicional ${id} não pertence ao produto ${product.id}`, code: "ADDITIONAL_NOT_FOUND" } };
      chosen.push(additional);
    }
    const extra = chosen.reduce((sum, a) => sum + a.priceCents, 0);
    lines.push({ productId: product.id, productName: product.name, quantity: item.quantity, unitPriceCents: product.priceCents, notes: item.notes, lineTotalCents: (product.priceCents + extra) * item.quantity, additionals: chosen, optionCopies: [] });
  }
  return { ok: true, lines };
}

/** Parte `options` do `create` do item (cópia na MESMA transação do pedido). */
export const optionCopiesCreate = (copies: OptionCopy[]) =>
  copies.length > 0 ? { options: { create: copies.map((o) => ({ groupName: o.groupName, name: o.name, priceCents: o.priceCents, quantity: o.quantity, priceMode: o.priceMode })) } } : {};
