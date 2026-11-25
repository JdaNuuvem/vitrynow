import { describe, expect, it } from "vitest";
import {
  brPhoneDigits,
  createManualOrderSchema,
  createOrderSchema,
  createTableOrderSchema,
  createCouponSchema,
  createIngredientSchema,
  maskPhoneInput,
  phoneSchema,
} from "@meucardapio/shared-types";

const item = { productId: "p1", quantity: 1 };

describe("telefone do Brasil (SSOT D9): uma regra para API e web", () => {
  it.each([
    "11987654321",
    "(11) 98765-4321",
    "+55 11 98765-4321",
    "5511987654321",
    "1134567890",
    "(11) 3456-7890",
    "21 99999.0001",
  ])("aceita %s", (v) => expect(phoneSchema.safeParse(v).success).toBe(true));

  it.each([
    ["20 dígitos (o caso do print)", "11948539593503953242"],
    ["sem DDD", "987654321"],
    ["DDD com zero", "01987654321"],
    ["celular sem 9", "11887654321"],
    ["12 dígitos sem DDI", "119876543210"],
    ["letras", "11 9876-ABCD"],
    ["+ no meio", "11+987654321"],
    ["HTML", "<script>"],
  ])("recusa %s", (_, v) => expect(phoneSchema.safeParse(v).success).toBe(false));

  it("devolve os dígitos nacionais sem o DDI", () => {
    expect(brPhoneDigits("+55 (11) 98765-4321")).toBe("11987654321");
    expect(brPhoneDigits("lixo")).toBeNull();
  });

  it("máscara de digitação: formata, corta em 11 dígitos e tira o DDI colado", () => {
    expect(maskPhoneInput("11948539593503953242")).toBe("(11) 94853-9593");
    expect(maskPhoneInput("1134567890")).toBe("(11) 3456-7890");
    expect(maskPhoneInput("+55 11 98765-4321")).toBe("(11) 98765-4321");
    expect(maskPhoneInput("119")).toBe("(11) 9");
    expect(maskPhoneInput("1")).toBe("(1");
    expect(maskPhoneInput("abc")).toBe("");
  });

  it("os dois pedidos (loja e painel) usam a regra", () => {
    expect(createOrderSchema.safeParse({ type: "BALCAO", items: [item], customerPhone: "11948539593503953242" }).success).toBe(false);
    expect(createManualOrderSchema.safeParse({ type: "DELIVERY", items: [item], customerPhone: "11948539593503953242" }).success).toBe(false);
  });
});

describe("textos livres limpos e limitados", () => {
  it("pedido do painel: endereço e observação perdem controles invisíveis e respeitam 500", () => {
    const parsed = createManualOrderSchema.parse({ type: "BALCAO", items: [item], notes: "sem‮cebola\u0000 ", address: "Rua A‏, 1" });
    expect(parsed.notes).toBe("semcebola");
    expect(parsed.address).toBe("Rua A, 1");
    expect(createManualOrderSchema.safeParse({ type: "BALCAO", items: [item], notes: "x".repeat(501) }).success).toBe(false);
  });

  it("pedido da mesa: nome e observação limpos", () => {
    const parsed = createTableOrderSchema.parse({ customerName: " Ana\u0007 ", notes: "ok⁦", items: [item] });
    expect(parsed).toMatchObject({ customerName: "Ana", notes: "ok" });
  });

  it("cupom do pedido sem espaços nas pontas", () => {
    expect(createOrderSchema.parse({ type: "BALCAO", items: [item], couponCode: "  BEMVINDO " }).couponCode).toBe("BEMVINDO");
    expect(createOrderSchema.safeParse({ type: "BALCAO", items: [item], couponCode: "   " }).success).toBe(false);
  });

  it("ids do item têm teto", () => {
    expect(createOrderSchema.safeParse({ type: "BALCAO", items: [{ productId: "x".repeat(101), quantity: 1 }] }).success).toBe(false);
  });

  it("limite de usos do cupom tem teto", () => {
    const base = { code: "ABC", discountType: "FIXED", discountValue: 100 };
    expect(createCouponSchema.safeParse({ ...base, maxUses: 1_000_001 }).success).toBe(false);
    expect(createCouponSchema.safeParse({ ...base, maxUses: 1_000_000 }).success).toBe(true);
  });

  it("nome do insumo limpo", () => {
    expect(createIngredientSchema.parse({ name: " Farinha‎ ", unit: "G" }).name).toBe("Farinha");
  });
});
