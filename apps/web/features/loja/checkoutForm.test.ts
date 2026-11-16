import { describe, expect, it } from "vitest";
import {
  CHANGE_TOO_LOW_MESSAGE,
  changeForCents,
  checkoutTotals,
  toPlaceOrderInput,
  validateChange,
  type CheckoutForm,
} from "./checkoutForm";

const base: CheckoutForm = {
  deliveryType: "DELIVERY",
  customerName: "Maria",
  customerPhone: "21999999999",
  address: "Rua A, 1",
  couponCode: "",
  paymentMethod: "DINHEIRO",
  changeFor: "",
  tipCents: 0,
};

describe("checkoutTotals", () => {
  it("taxa de entrega só em DELIVERY", () => {
    expect(checkoutTotals({ subtotalCents: 5000, deliveryType: "DELIVERY", deliveryFeeCents: 700, tipCents: 0 }).totalCents).toBe(5700);
    expect(checkoutTotals({ subtotalCents: 5000, deliveryType: "BALCAO", deliveryFeeCents: 700, tipCents: 0 })).toEqual({
      subtotalCents: 5000,
      deliveryFeeCents: 0,
      tipCents: 0,
      totalCents: 5000,
    });
  });

  it("soma a gorjeta", () => {
    expect(checkoutTotals({ subtotalCents: 5000, deliveryType: "BALCAO", deliveryFeeCents: 0, tipCents: 500 }).totalCents).toBe(5500);
  });
});

describe("troco", () => {
  it("só vale com DINHEIRO e valor positivo", () => {
    expect(changeForCents({ ...base, changeFor: "50,00" })).toBe(5000);
    expect(changeForCents({ ...base, changeFor: "" })).toBeUndefined();
    expect(changeForCents({ ...base, changeFor: "0,00" })).toBeUndefined();
    expect(changeForCents({ ...base, paymentMethod: "PIX", changeFor: "50,00" })).toBeUndefined();
  });

  it("troco menor que o total é recusado; igual ou maior passa", () => {
    expect(validateChange({ ...base, changeFor: "30,00" }, 5000)).toBe(CHANGE_TOO_LOW_MESSAGE);
    expect(validateChange({ ...base, changeFor: "50,00" }, 5000)).toBeNull();
    expect(validateChange({ ...base, changeFor: "100,00" }, 5000)).toBeNull();
  });

  it("sem troco informado não há o que validar", () => {
    expect(validateChange(base, 5000)).toBeNull();
  });

  it("com cupom o servidor decide (o total final é dele)", () => {
    expect(validateChange({ ...base, changeFor: "30,00", couponCode: "PROMO10" }, 5000)).toBeNull();
  });
});

describe("toPlaceOrderInput", () => {
  const cart = [{ productId: "p1", quantity: 2, additionalIds: [] }];

  it("monta o payload com troco e gorjeta", () => {
    const input = toPlaceOrderInput({ ...base, changeFor: "100,00", tipCents: 200 }, cart);
    expect(input).toMatchObject({ type: "DELIVERY", paymentMethod: "DINHEIRO", changeForCents: 10000, tipCents: 200, cart });
  });

  it("gorjeta zero vira undefined e troco some fora de DINHEIRO", () => {
    const input = toPlaceOrderInput({ ...base, paymentMethod: "CREDITO", changeFor: "100,00" }, cart);
    expect(input.tipCents).toBeUndefined();
    expect(input.changeForCents).toBeUndefined();
  });
});
