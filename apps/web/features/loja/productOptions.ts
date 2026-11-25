import type { CartLine, OptionSelection, PublicOptionGroup } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";

type PriceableProduct = {
  priceCents: number;
  fromPriceCents?: number | null;
  optionGroups?: PublicOptionGroup[];
  additionals: { id?: string; name: string; priceCents: number }[];
};

export function startingPrice(product: Pick<PriceableProduct, "priceCents" | "fromPriceCents">) {
  return product.fromPriceCents == null
    ? formatCents(product.priceCents)
    : `A partir de ${formatCents(product.fromPriceCents)}`;
}

export function selectedCount(group: PublicOptionGroup, selections: OptionSelection[]) {
  const ids = new Set(group.options.map((entry) => entry.id));
  return selections.reduce((sum, entry) => sum + (ids.has(entry.optionId) ? entry.quantity : 0), 0);
}

export function choiceMaximum(group: PublicOptionGroup, selections: OptionSelection[], optionId: string) {
  if (group.maxSelect === null) return group.maxPerOption;
  const current = selections.find((entry) => entry.optionId === optionId)?.quantity ?? 0;
  return Math.min(group.maxPerOption, Math.max(0, group.maxSelect - selectedCount(group, selections) + current));
}

export function changeChoice(group: PublicOptionGroup, selections: OptionSelection[], optionId: string, quantity: number) {
  const single = group.minSelect === 1 && group.maxSelect === 1;
  const ids = new Set(group.options.map((entry) => entry.id));
  const removed = selections.filter((entry) => entry.optionId !== optionId && !(single && ids.has(entry.optionId)));
  const next = Math.min(Math.max(quantity, 0), choiceMaximum(group, removed, optionId));
  return next ? [...removed, { optionId, quantity: next }] : removed;
}

/** Para reabrir um item após mudança de catálogo, mantém somente escolhas que a tela ainda permite editar. */
export function editableSelections(groups: PublicOptionGroup[], selections: OptionSelection[]) {
  let current: OptionSelection[] = [];
  for (const group of groups) {
    for (const option of group.options) {
      const chosen = selections.find((entry) => entry.optionId === option.id);
      if (chosen) current = changeChoice(group, current, option.id, chosen.quantity);
    }
  }
  return current;
}

export function optionChoicesValid(groups: PublicOptionGroup[], selections: OptionSelection[]): boolean {
  const quantities = new Map(selections.map(({ optionId, quantity }) => [optionId, quantity]));
  if (selections.length !== quantities.size) return false;

  for (const group of groups) {
    let count = 0;
    for (const option of group.options) {
      const quantity = quantities.get(option.id);
      if (quantity === undefined) continue;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > group.maxPerOption) return false;
      count += quantity;
      quantities.delete(option.id);
    }
    if (count < group.minSelect || (group.maxSelect !== null && count > group.maxSelect)) return false;
  }
  return quantities.size === 0;
}

export function unitPriceWithChoices(product: PriceableProduct, line: Pick<CartLine, "additionalIds" | "optionSelections">) {
  let base = product.fromPriceCents ?? product.priceCents;
  let extras = line.additionalIds.reduce((sum, id) => sum + (product.additionals.find((entry) => entry.id === id)?.priceCents ?? 0), 0);
  const selected = new Map((line.optionSelections ?? []).map(({ optionId, quantity }) => [optionId, quantity]));
  for (const group of product.optionGroups ?? []) {
    for (const option of group.options) {
      const count = selected.get(option.id);
      if (!count) continue;
      if (group.priceMode === "BASE") base = option.priceCents;
      else extras += option.priceCents * count;
    }
  }
  return base + extras;
}

export function lineChoicesValid(product: PriceableProduct, line: Pick<CartLine, "additionalIds" | "optionSelections">) {
  return line.additionalIds.every((id) => product.additionals.some((entry) => entry.id === id))
    && optionChoicesValid(product.optionGroups ?? [], line.optionSelections ?? []);
}

export function choiceLabels(product: PriceableProduct, line: Pick<CartLine, "additionalIds" | "optionSelections">): string[] {
  const additionalNames = line.additionalIds.flatMap((id) => {
    const additional = product.additionals.find((entry) => entry.id === id);
    return additional ? [additional.name] : [];
  });
  const selected = new Map((line.optionSelections ?? []).map(({ optionId, quantity }) => [optionId, quantity]));
  for (const group of product.optionGroups ?? []) {
    for (const option of group.options) {
      const count = selected.get(option.id);
      if (count) additionalNames.push(`${group.name}: ${count > 1 ? `${count}× ` : ""}${option.name}`);
    }
  }
  return additionalNames;
}

export function orderNeedsUpdatedCatalog(code?: string | null) {
  return code === "ITEM_PRICE_CHANGED" || code === "ITEM_UNAVAILABLE" ||
    code === "PRODUCT_NOT_FOUND" || code === "ADDITIONAL_NOT_FOUND" ||
    code === "PRODUCT_UNAVAILABLE_BY_RULE" || !!code?.startsWith("OPTION_");
}
