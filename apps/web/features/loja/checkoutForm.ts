import type { CartLine, DeliveryType, PaymentMethod, PlaceOrderInput } from "@/core/domain/storefront";
import { digitsToCents } from "@/shared/format/money";

export type CheckoutForm = {
  deliveryType: DeliveryType;
  customerName: string;
  customerPhone: string;
  address: string;
  couponCode: string;
  paymentMethod: PaymentMethod;
  // Texto mascarado do campo "Troco para" (ex.: "50,00"); só vale com DINHEIRO.
  changeFor: string;
  tipCents: number;
};

export const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "DINHEIRO", label: "Pagar na entrega/retirada — dinheiro" },
  { value: "CREDITO", label: "Pagar na entrega/retirada — crédito" },
  { value: "DEBITO", label: "Pagar na entrega/retirada — débito" },
  { value: "VR", label: "Pagar na entrega/retirada — vale-refeição (VR)" },
  { value: "VA", label: "Pagar na entrega/retirada — vale-alimentação (VA)" },
  { value: "PIX", label: "Pagar agora — PIX" },
];

export const TIP_OPTIONS_CENTS = [0, 200, 500, 1000];

export const CHANGE_TOO_LOW_MESSAGE = "o valor do troco precisa cobrir o total";
export const STORE_CLOSED_MESSAGE = "Loja fechada para pedidos no momento";

export type CheckoutTotals = {
  subtotalCents: number;
  deliveryFeeCents: number;
  tipCents: number;
  totalCents: number;
};

// Mesma conta do servidor, menos o cupom (que só ele conhece): taxa de entrega só em DELIVERY.
export function checkoutTotals(input: {
  subtotalCents: number;
  deliveryType: DeliveryType;
  deliveryFeeCents: number;
  tipCents: number;
}): CheckoutTotals {
  const deliveryFeeCents = input.deliveryType === "DELIVERY" ? input.deliveryFeeCents : 0;
  return {
    subtotalCents: input.subtotalCents,
    deliveryFeeCents,
    tipCents: input.tipCents,
    totalCents: input.subtotalCents + deliveryFeeCents + input.tipCents,
  };
}

export function changeForCents(form: CheckoutForm): number | undefined {
  if (form.paymentMethod !== "DINHEIRO") return undefined;
  const cents = digitsToCents(form.changeFor);
  return cents > 0 ? cents : undefined;
}

// Com cupom o total final só o servidor sabe; nesse caso não bloqueamos aqui pra não recusar
// um troco que na verdade cobre o total com desconto — o servidor valida de qualquer jeito.
export function validateChange(form: CheckoutForm, totalCents: number): string | null {
  const cents = changeForCents(form);
  if (cents === undefined || form.couponCode.trim()) return null;
  return cents < totalCents ? CHANGE_TOO_LOW_MESSAGE : null;
}

export function toPlaceOrderInput(form: CheckoutForm, cart: CartLine[]): PlaceOrderInput {
  return {
    type: form.deliveryType,
    customerName: form.customerName,
    customerPhone: form.customerPhone,
    address: form.address,
    couponCode: form.couponCode,
    paymentMethod: form.paymentMethod,
    changeForCents: changeForCents(form),
    tipCents: form.tipCents > 0 ? form.tipCents : undefined,
    cart,
  };
}
