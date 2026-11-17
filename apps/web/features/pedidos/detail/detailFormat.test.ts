import { describe, expect, it } from "vitest";
import type { OrderDetail } from "@/core/domain/orderDetail";
import { actorText, canContact, mapsHref, paymentView, telHref, valueRows, whatsappHref } from "./detailFormat";

type PayArgs = Parameters<typeof paymentView>[0];
const pay = (over: Partial<PayArgs>): PayArgs => ({ paymentMethod: null, payment: null, totalCents: 9530, changeForCents: null, ...over });
const payment = (status: string, refundPending = false) => ({ status, amountCents: 9530, expiresAt: null, refundPending, reconcileRequired: false }) as PayArgs["payment"];

describe("telefone, WhatsApp e mapa (UI-D-05)", () => {
  it("tel: e wa.me levam o DDI 55 quando o número não o tem", () => {
    expect(telHref("(11) 91234-5678")).toBe("tel:+5511912345678");
    expect(whatsappHref("(11) 91234-5678", "0123")).toBe("https://wa.me/5511912345678?text=Pedido%20%230123");
  });

  it("número que já tem DDI não ganha outro", () => {
    expect(telHref("5511912345678")).toBe("tel:+5511912345678");
    expect(whatsappHref("+55 11 91234-5678", "0123")).toContain("wa.me/5511912345678");
  });

  it("o texto do WhatsApp é SÓ 'Pedido #código': sem nome, valor nem endereço", () => {
    const text = decodeURIComponent(whatsappHref("11912345678", "0123").split("text=")[1]);
    expect(text).toBe("Pedido #0123");
  });

  it("só há contato com telefone completo: mascarado ou ausente não vira link", () => {
    expect(canContact({ customerPhone: "11912345678", contactMasked: false })).toBe(true);
    expect(canContact({ customerPhone: "*******5678", contactMasked: true })).toBe(false);
    expect(canContact({ customerPhone: null, contactMasked: false })).toBe(false);
    // se o servidor errar a flag, telefone com máscara nunca vira link (parecer R2)
    expect(canContact({ customerPhone: "*******5678", contactMasked: false })).toBe(false);
    expect(canContact({ customerPhone: "••••••5678", contactMasked: false })).toBe(false);
  });

  it("o mapa codifica o endereço e abre só uma busca", () => {
    expect(mapsHref("Rua das Flores, 10 · apto 4")).toBe("https://www.google.com/maps/search/?api=1&query=Rua%20das%20Flores%2C%2010%20%C2%B7%20apto%204");
  });
});

describe("frase de pagamento (UI-D-03, CA-DET-09)", () => {
  it("dinheiro com troco: 'Troco para R$ 100,00 → levar R$ 4,70' em destaque", () => {
    const view = paymentView(pay({ paymentMethod: "DINHEIRO", changeForCents: 10000 }));
    expect(view.lines).toEqual(["Cobrar R$ 95,30 em dinheiro"]);
    expect(view.highlight).toMatch(/Troco para R\$\s?100,00 → levar R\$\s?4,70/);
  });

  it("dinheiro sem troco: só cobrar", () => {
    expect(paymentView(pay({ paymentMethod: "DINHEIRO" }))).toEqual({ lines: ["Cobrar R$ 95,30 em dinheiro"], highlight: null });
  });

  it("troco menor ou igual ao total não vira 'levar' negativo", () => {
    expect(paymentView(pay({ paymentMethod: "DINHEIRO", changeForCents: 9530 })).highlight).toBeNull();
  });

  it.each([
    ["CREDITO", "crédito"],
    ["DEBITO", "débito"],
    ["VR", "VR"],
    ["VA", "VA"],
  ])("cartão %s: 'Cobrar … no cartão (%s)'", (method, label) => {
    expect(paymentView(pay({ paymentMethod: method as never })).lines[0]).toBe(`Cobrar R$ 95,30 no cartão (${label})`);
  });

  it("PIX aprovado, aguardando, em estorno e estornado", () => {
    expect(paymentView(pay({ paymentMethod: "PIX", payment: payment("APROVADO") })).lines).toEqual(["Pago online (PIX)"]);
    expect(paymentView(pay({ paymentMethod: "PIX", payment: payment("PENDENTE") })).lines).toEqual(["Aguardando o pagamento"]);
    expect(paymentView(pay({ paymentMethod: "PIX", payment: payment("ESTORNO_PENDENTE", true) })).lines).toEqual(["Estorno em andamento"]);
    expect(paymentView(pay({ paymentMethod: "PIX", payment: payment("REEMBOLSADO") })).lines).toEqual(["Estornado"]);
  });

  it("PIX sem pagamento registrado: 'PIX (conferir na hora)'; sem forma: 'não informada'", () => {
    expect(paymentView(pay({ paymentMethod: "PIX" })).lines).toEqual(["PIX (conferir na hora)"]);
    expect(paymentView(pay({})).lines).toEqual(["Forma de pagamento não informada"]);
  });

  it("nunca devolve id do provedor, e-mail do pagador nem token (só frases fixas)", () => {
    const view = paymentView(pay({ paymentMethod: "PIX", payment: { ...payment("APROVADO")!, providerPaymentId: "mp_123", payerEmail: "x@y.z" } as never }));
    expect(JSON.stringify(view)).not.toMatch(/mp_123|x@y\.z|token/i);
  });
});

describe("valores na ordem do tíquete", () => {
  const base = { subtotalCents: 9700, discountCents: 970, deliveryFeeCents: 600, tipCents: 200, totalCents: 9530 } as Pick<OrderDetail, "subtotalCents" | "discountCents" | "deliveryFeeCents" | "tipCents" | "totalCents">;

  it("subtotal, desconto, taxa, gorjeta (fora do faturamento) e total", () => {
    expect(valueRows(base).map((row) => row.label)).toEqual(["Subtotal", "Desconto", "Taxa de entrega", "Gorjeta", "Total"]);
    expect(valueRows(base).find((row) => row.label === "Gorjeta")?.note).toBe("fora do faturamento");
    expect(valueRows(base).find((row) => row.label === "Desconto")?.sign).toBe("minus");
  });

  it("sem desconto, taxa nem gorjeta só há subtotal e total", () => {
    expect(valueRows({ ...base, discountCents: 0, deliveryFeeCents: 0, tipCents: 0 }).map((row) => row.label)).toEqual(["Subtotal", "Total"]);
  });
});

describe("quem fez, sempre como papel (CA-DET-11)", () => {
  it("papéis conhecidos e desconhecido (nunca e-mail)", () => {
    expect(actorText("OWNER")).toBe("pelo dono");
    expect(actorText("STAFF")).toBe("pela equipe");
    expect(actorText("CUSTOMER")).toBe("pelo cliente");
    expect(actorText("SYSTEM")).toBe("pelo sistema");
    expect(actorText("alguem@loja.com")).toBe("pelo sistema");
  });
});
