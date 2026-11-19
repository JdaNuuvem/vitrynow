import type { CartLine, DeliveryType, PaymentMethod, PlaceOrderInput, Product } from "@/core/domain/storefront";
import { digitsToCents } from "@/shared/format/money";
import { choiceLabels } from "./productOptions";

export type CheckoutForm = {
  deliveryType: DeliveryType;
  neighborhoodId?: string;
  expectedDeliveryFeeCents?: number;
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

// Spec 09 §10.2: pagamento em dois blocos, com rótulos curtos (o bloco já diz "na entrega ou retirada").
export const PAYMENT_GROUPS: { legend: string; online: boolean; options: { value: PaymentMethod; label: string }[] }[] = [
  {
    legend: "Pagar na entrega ou retirada",
    online: false,
    options: [
      { value: "DINHEIRO", label: "Dinheiro" },
      { value: "CREDITO", label: "Cartão de crédito" },
      { value: "DEBITO", label: "Cartão de débito" },
      { value: "VR", label: "Vale-refeição (VR)" },
      { value: "VA", label: "Vale-alimentação (VA)" },
    ],
  },
  { legend: "Pagar agora", online: true, options: [{ value: "PIX", label: "PIX" }] },
];

export const TIP_OPTIONS_CENTS = [0, 200, 500, 1000];

export const CHANGE_TOO_LOW_MESSAGE = "o valor do troco precisa cobrir o total";
// Texto oficial T-09 (ogilvypy-textos-verdadeiros.md; spec 09 §2.4). Sem ponto final aqui: quem mostra acrescenta.
export const STORE_CLOSED_MESSAGE = "Esta loja não está recebendo pedidos agora";

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

export function toPlaceOrderInput(form: CheckoutForm, cart: PlaceOrderInput["cart"]): PlaceOrderInput {
  return {
    type: form.deliveryType,
    ...(form.deliveryType === "DELIVERY" ? { neighborhoodId: form.neighborhoodId, expectedDeliveryFeeCents: form.expectedDeliveryFeeCents } : {}),
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

// ---------- validação por campo (espelha o que o servidor já recusa: createOrderSchema) ----------
export type CheckoutField = "customerName" | "customerPhone" | "address" | "changeFor";
export type CheckoutErrors = Partial<Record<CheckoutField, string>>;

// Ordem em que os campos aparecem na tela: o foco vai ao primeiro com erro.
export const CHECKOUT_FIELD_ORDER: readonly CheckoutField[] = ["customerName", "customerPhone", "address", "changeFor"];

export const NAME_REQUIRED_MESSAGE = "Informe seu nome.";
export const PHONE_INVALID_MESSAGE = "Informe um telefone com DDD.";
export const ADDRESS_REQUIRED_MESSAGE = "Informe o endereço de entrega.";

// Servidor: nome 1–150 caracteres; telefone 8–20 com só dígitos, +, (, ), espaço e hífen; endereço
// obrigatório para entrega (a página já exigia). Mais rígido que isso aqui seria inventar regra.
export function validateCheckout(form: CheckoutForm, totalCents: number): CheckoutErrors {
  const errors: CheckoutErrors = {};
  const name = form.customerName.trim();
  if (name.length === 0 || name.length > 150) errors.customerName = NAME_REQUIRED_MESSAGE;
  const phone = form.customerPhone.trim();
  if (phone.length < 8 || phone.length > 20 || !/^[0-9+()\s-]+$/.test(phone)) errors.customerPhone = PHONE_INVALID_MESSAGE;
  if (form.deliveryType === "DELIVERY" && form.address.trim().length === 0) errors.address = ADDRESS_REQUIRED_MESSAGE;
  const change = validateChange(form, totalCents);
  if (change) errors.changeFor = change;
  return errors;
}

export function firstInvalidField(errors: CheckoutErrors): CheckoutField | null {
  return CHECKOUT_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? null;
}

// ---------- resumo mostrado na tela de resultado (spec 09 §10.2) ----------
export type OrderSummary = {
  lines: string[];
  totalCents: number | null;
  discountCents?: number;
  paymentLabel: string;
  deliveryLabel: string;
  address: string | null;
};

export function paymentLabel(method: PaymentMethod): string {
  for (const group of PAYMENT_GROUPS) {
    const found = group.options.find((option) => option.value === method);
    if (found) return found.label;
  }
  return method;
}

// "2× Pizza + Bacon, Queijo" por linha do carrinho. Produto que sumiu do menu aparece como item genérico.
export function buildOrderSummary(form: CheckoutForm, cart: CartLine[], products: Map<string, Product>, totalCents: number): OrderSummary {
  const lines = cart.map((line) => {
    const product = products.get(line.productId);
    const extras = product ? choiceLabels(product, line) : [];
    return `${line.quantity}× ${product?.name ?? "Item"}${extras.length > 0 ? ` + ${extras.join(", ")}` : ""}`;
  });
  const delivery = form.deliveryType === "DELIVERY";
  return {
    lines,
    totalCents,
    paymentLabel: paymentLabel(form.paymentMethod),
    deliveryLabel: delivery ? "Entrega" : "Retirada no local",
    address: delivery && form.address.trim() ? form.address.trim() : null,
  };
}
