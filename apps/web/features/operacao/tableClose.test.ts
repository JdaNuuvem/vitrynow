import { describe, expect, it } from "vitest";
import { buildReceiveBody, closeTotals, parseMoney, remainingCents, type PaymentPart } from "./tableClose";

const part = (method: PaymentPart["method"], amount = "", changeFor = ""): PaymentPart => ({ key: Math.random(), method, amount, changeFor });

describe("fechamento da mesa — mesma conta do servidor", () => {
  it("dinheiro digitado", () => {
    expect([parseMoney("12,34"), parseMoney("12.34"), parseMoney("1.234,50"), parseMoney(""), parseMoney("abc"), parseMoney("1,234")]).toEqual([1234, 1234, 123450, 0, null, null]);
  });

  it("taxa arredondada como na API; total = conta + taxa − desconto", () => {
    expect(closeTotals(6500, 10, true, 150)).toEqual({ serviceFeeCents: 650, totalCents: 7000 });
    expect(closeTotals(4000, 12, true, 400)).toEqual({ serviceFeeCents: 480, totalCents: 4080 });
    expect(closeTotals(3333, 10, true, 0)).toEqual({ serviceFeeCents: 333, totalCents: 3666 });
    expect(closeTotals(6500, 10, false, 0)).toEqual({ serviceFeeCents: 0, totalCents: 6500 });
  });

  it("pagamento único: manda só a forma (ela leva o total), taxa e desconto quando houver, e confere o troco", () => {
    const one = buildReceiveBody({ subtotalCents: 6500, serviceFeePercent: 10, includeFee: true, discount: "1,50", parts: [part("PIX")] });
    expect(one).toEqual({ ok: true, totalCents: 7000, body: { paymentMethod: "PIX", includeServiceFee: true, discountCents: 150, expectedTotalCents: 6500 } });
    expect(buildReceiveBody({ subtotalCents: 4000, serviceFeePercent: 10, includeFee: false, discount: "", parts: [part("DINHEIRO", "", "30,00")] })).toEqual({ ok: false, error: "O valor para troco precisa cobrir o total." });
    expect(buildReceiveBody({ subtotalCents: 4000, serviceFeePercent: 10, includeFee: false, discount: "", parts: [part("PIX", "", "50,00")] })).toEqual({ ok: false, error: "Troco só se aplica a pagamento em dinheiro." });
    expect(buildReceiveBody({ subtotalCents: 4000, serviceFeePercent: 10, includeFee: false, discount: "40,00", parts: [part("PIX")] })).toEqual({ ok: false, error: "O desconto não pode zerar a conta." });
  });

  it("divisão: as partes precisam somar o total exato; troco por parte em dinheiro", () => {
    const parts = [part("PIX", "40,00"), part("DINHEIRO", "31,50", "50,00")];
    const ok = buildReceiveBody({ subtotalCents: 6500, serviceFeePercent: 10, includeFee: true, discount: "", parts });
    expect(ok).toEqual({ ok: true, totalCents: 7150, body: { payments: [{ method: "PIX", amountCents: 4000 }, { method: "DINHEIRO", amountCents: 3150, changeForCents: 5000 }], includeServiceFee: true, expectedTotalCents: 6500 } });
    expect(remainingCents(7150, parts)).toBe(0);
    const short = [part("PIX", "40,00"), part("DEBITO", "30,00")];
    expect(remainingCents(7150, short)).toBe(150);
    expect(buildReceiveBody({ subtotalCents: 6500, serviceFeePercent: 10, includeFee: true, discount: "", parts: short })).toEqual({ ok: false, error: "A soma das formas de pagamento é menor que o total." });
    expect(buildReceiveBody({ subtotalCents: 6500, serviceFeePercent: 10, includeFee: false, discount: "", parts: [part("PIX", "40,00"), part("DEBITO")] })).toEqual({ ok: false, error: "Informe o valor de cada forma de pagamento." });
  });
});
