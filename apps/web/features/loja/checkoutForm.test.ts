import { describe, expect, it } from "vitest";
import type { Product } from "@/core/domain/storefront";
import {
  ADDRESS_REQUIRED_MESSAGE,
  CHANGE_TOO_LOW_MESSAGE,
  NAME_REQUIRED_MESSAGE,
  NAME_TOO_LONG_MESSAGE,
  PAYMENT_GROUPS,
  PHONE_INVALID_MESSAGE,
  buildOrderSummary,
  paymentLabel,
  changeForCents,
  checkoutTotals,
  firstInvalidField,
  toPlaceOrderInput,
  validateChange,
  validateCheckout,
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

describe("validateCheckout (espelha o servidor)", () => {
  const ok: CheckoutForm = { ...base, customerName: "Maria", customerPhone: "(21) 99999-9999", address: "Rua A, 1" };

  it("formulário completo não tem erro", () => {
    expect(validateCheckout(ok, 5000)).toEqual({});
  });

  it("nome vazio ou só espaços é erro", () => {
    expect(validateCheckout({ ...ok, customerName: "" }, 5000).customerName).toBe(NAME_REQUIRED_MESSAGE);
    expect(validateCheckout({ ...ok, customerName: "   " }, 5000).customerName).toBe(NAME_REQUIRED_MESSAGE);
  });

  it("nome passa do limite do servidor (80) → erro de tamanho, não some em silêncio", () => {
    expect(validateCheckout({ ...ok, customerName: "x".repeat(80) }, 5000).customerName).toBeUndefined();
    expect(validateCheckout({ ...ok, customerName: "x".repeat(81) }, 5000).customerName).toBe(NAME_TOO_LONG_MESSAGE);
  });

  it("telefone: regra única do Brasil (DDD + 10/11 dígitos), a mesma da API", () => {
    for (const bad of ["", "1234567", "12345678", "abcdefghij", "21 99999-9999 ramal 2", "1".repeat(21), "11948539593503953242", "21899999999"]) {
      expect(validateCheckout({ ...ok, customerPhone: bad }, 5000).customerPhone).toBe(PHONE_INVALID_MESSAGE);
    }
    for (const good of ["+55 (21) 99999-9999", "21999999999", "(21) 99999-9999", "(21) 3456-7890"]) {
      expect(validateCheckout({ ...ok, customerPhone: good }, 5000).customerPhone).toBeUndefined();
    }
  });

  it("endereço só é obrigatório na entrega", () => {
    expect(validateCheckout({ ...ok, address: "" }, 5000).address).toBe(ADDRESS_REQUIRED_MESSAGE);
    expect(validateCheckout({ ...ok, deliveryType: "BALCAO", address: "" }, 5000).address).toBeUndefined();
  });

  it("troco insuficiente vira erro do campo troco", () => {
    expect(validateCheckout({ ...ok, changeFor: "30,00" }, 5000).changeFor).toBe(CHANGE_TOO_LOW_MESSAGE);
  });

  it("vários erros de uma vez, e o primeiro campo é o primeiro da tela", () => {
    const errors = validateCheckout({ ...ok, customerName: "", customerPhone: "1", address: "" }, 5000);
    expect(Object.keys(errors)).toHaveLength(3);
    expect(firstInvalidField(errors)).toBe("customerName");
    expect(firstInvalidField(validateCheckout({ ...ok, address: "" }, 5000))).toBe("address");
    expect(firstInvalidField({})).toBeNull();
  });
});

describe("PAYMENT_GROUPS", () => {
  it("PIX é o único método do bloco 'Pagar agora'; os demais ficam em 'na entrega ou retirada'", () => {
    const online = PAYMENT_GROUPS.find((g) => g.online);
    expect(online?.options.map((o) => o.value)).toEqual(["PIX"]);
    const offline = PAYMENT_GROUPS.find((g) => !g.online);
    expect(offline?.options.map((o) => o.value)).toEqual(["DINHEIRO", "CREDITO", "DEBITO", "VR", "VA"]);
  });
});

describe("buildOrderSummary", () => {
  const burger = {
    id: "p1",
    name: "Cheeseburguer",
    priceCents: 1500,
    additionals: [{ id: "a1", name: "Bacon extra", priceCents: 400 }],
  } as unknown as Product;
  const products = new Map([["p1", burger]]);

  it("monta as linhas com adicionais, o total, o pagamento e o endereço", () => {
    const summary = buildOrderSummary(
      { ...base, address: " Rua A, 1 " },
      [{ productId: "p1", quantity: 2, additionalIds: ["a1"] }],
      products,
      3800,
    );
    expect(summary.lines).toEqual(["2× Cheeseburguer + Bacon extra"]);
    expect(summary).toMatchObject({ totalCents: 3800, paymentLabel: "Dinheiro", deliveryLabel: "Entrega", address: "Rua A, 1" });
  });

  it("retirada não leva endereço", () => {
    const summary = buildOrderSummary({ ...base, deliveryType: "BALCAO", address: "Rua A" }, [], products, 0);
    expect(summary.deliveryLabel).toBe("Retirada no local");
    expect(summary.address).toBeNull();
  });

  it("produto que saiu do cardápio vira 'Item' e adicional desconhecido é ignorado", () => {
    const summary = buildOrderSummary(
      base,
      [
        { productId: "x", quantity: 1, additionalIds: ["zz"] },
        { productId: "p1", quantity: 1, additionalIds: ["zz"] },
      ],
      products,
      0,
    );
    expect(summary.lines).toEqual(["1× Item", "1× Cheeseburguer"]);
  });

  it("rótulo de pagamento por método", () => {
    expect(paymentLabel("PIX")).toBe("PIX");
    expect(paymentLabel("VR")).toBe("Vale-refeição (VR)");
  });
});
