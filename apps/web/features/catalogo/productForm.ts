import type { Additional, Product, ProductInput } from "@/core/domain/catalog";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";

export type AdditionalDraft = { id?: string; name: string; price: string };

export type ProductDraft = {
  name: string;
  description: string;
  imageUrl: string;
  price: string;
  featured: boolean;
  active: boolean;
  additionals: AdditionalDraft[];
};

// Valor em centavos -> texto mascarado do MoneyInput ("3550" -> "35,50").
export function centsToMasked(cents: number): string {
  return maskMoneyInput(String(cents));
}

export function emptyAdditional(): AdditionalDraft {
  return { name: "", price: "" };
}

function additionalToDraft(additional: Additional): AdditionalDraft {
  return { id: additional.id, name: additional.name, price: centsToMasked(additional.priceCents) };
}

export function draftFromProduct(product?: Product): ProductDraft {
  return {
    name: product?.name ?? "",
    description: product?.description ?? "",
    imageUrl: product?.imageUrl ?? "",
    price: product ? centsToMasked(product.priceCents) : "",
    featured: product?.featured ?? false,
    active: product?.active ?? true,
    additionals: product?.additionals.map(additionalToDraft) ?? [],
  };
}

export function toProductInput(categoryId: string, draft: ProductDraft): ProductInput {
  return {
    categoryId,
    name: draft.name,
    description: draft.description || undefined,
    imageUrl: draft.imageUrl,
    priceCents: digitsToCents(draft.price),
    featured: draft.featured,
    active: draft.active,
    additionals: draft.additionals
      .filter((additional) => additional.name.trim().length > 0)
      .map((additional) => ({ id: additional.id, name: additional.name, priceCents: digitsToCents(additional.price) })),
  };
}
