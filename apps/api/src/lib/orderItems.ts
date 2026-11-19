import type { CreateOrderItem } from "@meucardapio/shared-types";
import type { GroupRow } from "../modules/optionGroups/optionGroups.domain";
import { fromPriceCents, resolveLine, unavailableGroups } from "../modules/optionGroups/optionGroups.domain";
import { CodedError } from "../shared/errors";

// Os valores agregados do pedido são INTEGER no PostgreSQL.
const MAX_ORDER_CENTS = 2_147_483_647;

type OrderableProduct = {
  id: string;
  name: string;
  priceCents: number;
  additionals: { id: string; name: string; priceCents: number }[];
};

export function assertOrderMoneyFits(cents: number) {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > MAX_ORDER_CENTS) {
    throw new CodedError(400, "ORDER_VALUE_TOO_HIGH", "O pedido excede o limite de valor. Divida em pedidos menores.");
  }
}

/** Aplica a mesma regra de preço no balcão, na mesa e na vitrine. */
export function resolveOrderItems(
  items: CreateOrderItem[],
  products: OrderableProduct[],
  groupsByProduct: Map<string, GroupRow[]>,
) {
  const byProduct = new Map(products.map((product) => [product.id, product]));
  const itemsData = items.map((item) => {
    const product = byProduct.get(item.productId);
    if (!product) throw new CodedError(400, "PRODUCT_NOT_FOUND", "Um ou mais produtos não existem nesta loja.");
    const additionsById = new Map(product.additionals.map((entry) => [entry.id, entry]));
    const additionals = (item.additionalIds ?? []).map((id) => {
      const additional = additionsById.get(id);
      if (!additional) throw new CodedError(400, "ADDITIONAL_NOT_FOUND", "Um adicional escolhido não está disponível neste produto.");
      return additional;
    });
    const groups = groupsByProduct.get(product.id) ?? [];
    const resolved = resolveLine(product, groups, item.optionSelections ?? []);
    if (!resolved.ok) {
      const issue = resolved.issues[0];
      throw new CodedError(400, issue.code, issue.message, { details: { productId: product.id, issues: resolved.issues } });
    }
    const unitTotalCents = resolved.unitPriceCents + additionals.reduce((sum, entry) => sum + entry.priceCents, 0);
    const lineTotalCents = unitTotalCents * item.quantity;
    assertOrderMoneyFits(lineTotalCents);
    return {
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPriceCents: resolved.baseCents,
      unitTotalCents,
      notes: item.notes,
      lineTotalCents,
      additionals: { create: additionals.map(({ name, priceCents }) => ({ name, priceCents })) },
      options: { create: resolved.copies },
    };
  });
  const changed = itemsData.flatMap((item, index) => {
    const expected = items[index].expectedUnitPriceCents;
    return expected === undefined || expected === item.unitTotalCents ? [] : [{
      index,
      productId: item.productId,
      name: item.productName,
      unitPriceCents: item.unitTotalCents,
    }];
  });
  if (changed.length > 0) {
    throw new CodedError(409, "ITEM_PRICE_CHANGED", "O preço de um item mudou. Confira o carrinho antes de confirmar.", { details: { items: changed } });
  }
  const subtotalCents = itemsData.reduce((sum, item) => sum + item.lineTotalCents, 0);
  assertOrderMoneyFits(subtotalCents);
  return {
    subtotalCents,
    // Deixa os incrementos de compatibilidade fora da coluna de preço-base do pedido.
    items: itemsData.map(({ lineTotalCents: _total, unitTotalCents: _unitTotal, ...item }) => item),
  };
}

/** Lista pública de escolhas ativas sem identificadores de loja ou metadados internos. */
export function orderOptionFields(groups: GroupRow[]) {
  return {
    fromPriceCents: fromPriceCents(groups),
    unavailableByOptions: unavailableGroups(groups).length > 0,
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
