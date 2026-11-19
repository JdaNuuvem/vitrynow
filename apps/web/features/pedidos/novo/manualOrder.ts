import type { Product } from "@/core/domain/catalog";
import type { DiscountReason, ManualOrderInput } from "@/core/domain/manualOrder";
import type { OrderPaymentMethod } from "@/core/domain/orderDetail";
import type { OptionSelection } from "@/core/domain/storefront";
import { unitPriceWithChoices } from "@/features/loja/productOptions";

export type DraftLine = { product: Product; quantity: number; additionalIds: string[]; optionSelections?: OptionSelection[]; notes: string };
export type ManualFields = {
  type: ManualOrderInput["type"]; channel: NonNullable<ManualOrderInput["channel"]>;
  customerName: string; customerPhone: string; address: string; notes: string;
  couponCode: string; forceCoupon: boolean; percent: string; reason: DiscountReason;
  method: OrderPaymentMethod | ""; paid: boolean; change: string; tip: string;
};
export const initialFields: ManualFields = {
  type: "BALCAO", channel: "BALCAO", customerName: "", customerPhone: "", address: "", notes: "",
  couponCode: "", forceCoupon: false, percent: "", reason: "CORTESIA", method: "", paid: false, change: "", tip: "",
};

export function lineCents(line: DraftLine) {
  return unitPriceWithChoices(line.product, line) * line.quantity;
}

export function decimalCents(value: string): number {
  return Math.round(Number(value.replace(",", ".")) * 100);
}

export function toManualInput(lines: DraftLine[], fields: ManualFields, owner: boolean): ManualOrderInput {
  const optional = (s: string) => s.trim() || undefined;
  return {
    type: fields.type, channel: fields.channel,
    customerName: optional(fields.customerName), customerPhone: optional(fields.customerPhone),
    address: fields.type === "DELIVERY" ? optional(fields.address) : undefined,
    notes: optional(fields.notes), couponCode: optional(fields.couponCode),
    forceCoupon: owner && !!fields.couponCode.trim() && fields.forceCoupon || undefined,
    discount: Number(fields.percent) > 0 ? { percent: Number(fields.percent), reason: fields.reason } : undefined,
    paymentMethod: fields.method || undefined, alreadyPaid: fields.paid || undefined,
    tipCents: fields.tip ? decimalCents(fields.tip) : undefined,
    changeForCents: fields.method === "DINHEIRO" && fields.change ? decimalCents(fields.change) : undefined,
    items: lines.map((line) => ({
      productId: line.product.id, quantity: line.quantity,
      additionalIds: line.additionalIds.length ? line.additionalIds : undefined, notes: optional(line.notes),
      ...(line.optionSelections?.length ? { optionSelections: line.optionSelections } : {}),
      expectedUnitPriceCents: unitPriceWithChoices(line.product, line),
    })),
  };
}

// Somente a chave opaca sobrevive a uma resposta perdida. Contato, endereço e itens ficam em memória.
export function openingKey(storeId: string) {
  const name = "panel.manual.pending." + storeId;
  let key: string | null = null;
  try { key = sessionStorage.getItem(name); } catch {}
  if (!key) key = Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, "0")).join("");
  try { sessionStorage.setItem(name, key); } catch {}
  return key;
}

export function clearOpening(storeId: string, key: string) {
  try {
    const name = "panel.manual.pending." + storeId;
    if (sessionStorage.getItem(name) === key) sessionStorage.removeItem(name);
  } catch {}
}
