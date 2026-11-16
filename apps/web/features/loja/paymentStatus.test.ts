import { describe, expect, it } from "vitest";
import { interpretPaymentStatus } from "./paymentStatus";

describe("interpretPaymentStatus (B15)", () => {
  it("PIX aprovado = pago", () => {
    expect(interpretPaymentStatus({ awaitingPayment: false, orderStatus: "PENDENTE", paymentStatus: "APROVADO" })).toEqual({ kind: "PAID" });
  });

  it("ainda aguardando = continua perguntando", () => {
    expect(interpretPaymentStatus({ awaitingPayment: true, orderStatus: "PENDENTE", paymentStatus: "PENDENTE" })).toEqual({ kind: "PENDING" });
  });

  it("PIX expirado NÃO é pago, mesmo com awaitingPayment=false (o defeito do B15)", () => {
    const outcome = interpretPaymentStatus({ awaitingPayment: false, orderStatus: "PENDENTE", paymentStatus: "EXPIRADO" });
    expect(outcome.kind).toBe("FAILED");
  });

  it.each(["EXPIRADO", "REJEITADO", "CANCELADO", "CONTESTADO", "REEMBOLSADO"])("pagamento %s é falha com mensagem", (paymentStatus) => {
    const outcome = interpretPaymentStatus({ awaitingPayment: true, orderStatus: "PENDENTE", paymentStatus });
    expect(outcome.kind).toBe("FAILED");
    if (outcome.kind === "FAILED") expect(outcome.message.length).toBeGreaterThan(10);
  });

  it("pedido cancelado pela loja é falha e nunca pago", () => {
    const outcome = interpretPaymentStatus({ awaitingPayment: false, orderStatus: "CANCELADO", paymentStatus: "PENDENTE" });
    expect(outcome).toEqual({ kind: "FAILED", message: "A loja cancelou este pedido." });
  });

  it("usa a mensagem do cliente enviada pelo servidor quando existe", () => {
    const outcome = interpretPaymentStatus({
      awaitingPayment: false,
      orderStatus: "CANCELADO",
      paymentStatus: "EXPIRADO",
      terminal: true,
      cancelReason: { customerMessage: "Pagamento não aprovado" },
    });
    expect(outcome).toEqual({ kind: "FAILED", message: "Pagamento não aprovado" });
  });

  it("mensagem do servidor em branco cai no texto padrão", () => {
    const outcome = interpretPaymentStatus({ awaitingPayment: false, paymentStatus: "EXPIRADO", cancelReason: { customerMessage: "  " } });
    expect(outcome.kind === "FAILED" && outcome.message).toContain("PIX");
  });

  it("API antiga (sem paymentStatus) e awaitingPayment=false segue como pago", () => {
    expect(interpretPaymentStatus({ awaitingPayment: false })).toEqual({ kind: "PAID" });
  });

  it("terminal sem estado conhecido nunca afirma pagamento", () => {
    const outcome = interpretPaymentStatus({ awaitingPayment: true, paymentStatus: "PENDENTE", terminal: true });
    expect(outcome.kind).toBe("FAILED");
  });
});
