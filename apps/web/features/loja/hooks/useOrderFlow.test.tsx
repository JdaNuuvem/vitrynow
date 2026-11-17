import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentStatusResponse } from "@/core/domain/storefront";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { StorefrontServicesProvider } from "@/core/services/StorefrontServices";
import type { CheckoutForm } from "../checkoutForm";
import { CANCEL_UNAVAILABLE_MESSAGE, PAYMENT_POLL_MS, useOrderFlow } from "./useOrderFlow";

const form: CheckoutForm = {
  deliveryType: "BALCAO",
  customerName: "Maria",
  customerPhone: "21999999999",
  address: "",
  couponCode: "",
  paymentMethod: "PIX",
  changeFor: "",
  tipCents: 0,
};
const cart = [{ productId: "p1", quantity: 1, additionalIds: [] }];
const TOKEN = "mco_token-de-teste-do-pedido";

function ok<T>(data: T): HttpResult<T> {
  return { ok: true, data };
}

function setup(statuses: Array<HttpResult<PaymentStatusResponse>>, placeResult?: Awaited<ReturnType<StorefrontGateway["placeOrder"]>>) {
  const getPaymentStatus = vi.fn();
  statuses.forEach((s) => getPaymentStatus.mockResolvedValueOnce(s));
  // depois da lista, mantém o último (como um servidor estável)
  getPaymentStatus.mockResolvedValue(statuses[statuses.length - 1]);
  const storefront = {
    getMenu: vi.fn(),
    cancelOrder: vi.fn().mockResolvedValue(ok({})),
    getPaymentStatus,
    placeOrder: vi.fn().mockResolvedValue(
      placeResult ?? ok({ orderId: "o1", code: "0042", token: TOKEN, payment: { pixQrCode: "000201...", pixQrCodeBase64: null } }),
    ),
  } as unknown as StorefrontGateway;
  const onPlaced = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorefrontServicesProvider services={{ storefront }}>{children}</StorefrontServicesProvider>
  );
  const hook = renderHook(() => useOrderFlow("loja", onPlaced), { wrapper });
  return { ...hook, storefront, getPaymentStatus, onPlaced };
}

async function placePixOrder(result: ReturnType<typeof setup>) {
  await act(async () => {
    await result.result.current.submit(form, cart, 3000);
  });
}

async function tick(ms = PAYMENT_POLL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useOrderFlow: acompanhamento do PIX (B15)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("PIX aprovado: confirma e para de consultar", async () => {
    const t = setup([ok({ awaitingPayment: false, orderStatus: "PENDENTE", paymentStatus: "APROVADO" })]);
    await placePixOrder(t);
    await tick();
    expect(t.result.current.placed?.paymentConfirmed).toBe(true);
    const calls = t.getPaymentStatus.mock.calls.length;
    await tick(PAYMENT_POLL_MS * 5);
    expect(t.getPaymentStatus.mock.calls.length).toBe(calls);
  });

  it("PIX expirado: mostra falha, NÃO confirma e para de consultar", async () => {
    const t = setup([ok({ awaitingPayment: false, orderStatus: "PENDENTE", paymentStatus: "EXPIRADO" })]);
    await placePixOrder(t);
    await tick();
    expect(t.result.current.placed?.paymentConfirmed).toBe(false);
    expect(t.result.current.placed?.paymentFailedMessage).toContain("PIX");
    const calls = t.getPaymentStatus.mock.calls.length;
    await tick(PAYMENT_POLL_MS * 5);
    expect(t.getPaymentStatus.mock.calls.length).toBe(calls);
  });

  it("pedido cancelado pela loja durante o PIX: falha com a mensagem do servidor", async () => {
    const t = setup([
      ok({ awaitingPayment: true, orderStatus: "PENDENTE", paymentStatus: "PENDENTE" }),
      ok({ awaitingPayment: false, orderStatus: "CANCELADO", paymentStatus: "PENDENTE", terminal: true, cancelReason: { customerMessage: "Item indisponível" } }),
    ]);
    await placePixOrder(t);
    await tick();
    expect(t.result.current.placed?.paymentFailedMessage).toBeNull();
    await tick();
    expect(t.result.current.placed?.paymentFailedMessage).toBe("Item indisponível");
    expect(t.result.current.placed?.paymentConfirmed).toBe(false);
  });

  it("continua consultando enquanto pendente e se recupera de uma falha de rede", async () => {
    const t = setup([
      ok({ awaitingPayment: true, orderStatus: "PENDENTE", paymentStatus: "PENDENTE" }),
      { ok: false, status: 0, error: "sem rede" },
      ok({ awaitingPayment: false, orderStatus: "PENDENTE", paymentStatus: "APROVADO" }),
    ]);
    await placePixOrder(t);
    await tick();
    await tick();
    expect(t.result.current.placed?.paymentConfirmed).toBe(false);
    await tick();
    expect(t.result.current.placed?.paymentConfirmed).toBe(true);
    expect(t.getPaymentStatus).toHaveBeenCalledTimes(3);
  });

  it("404 (NG-16: igual para pedido inexistente e token recusado): para de consultar, sem dizer que o pedido não existe nem que o pagamento falhou", async () => {
    const t = setup([{ ok: false, status: 404, error: "pedido não encontrado" }]);
    await placePixOrder(t);
    await tick();
    expect(t.result.current.placed?.trackingUnavailable).toBe(true);
    expect(t.result.current.placed?.paymentFailedMessage).toBeNull();
    expect(JSON.stringify(t.result.current.placed)).not.toMatch(/não encontr|não existe/i);
    await tick(PAYMENT_POLL_MS * 3);
    expect(t.getPaymentStatus).toHaveBeenCalledTimes(1);
  });

  it("não consulta nada para pagamento presencial (sem PIX)", async () => {
    const t = setup([ok({ awaitingPayment: false, paymentStatus: "APROVADO" })], ok({ orderId: "o2", code: "0043" }));
    await placePixOrder(t);
    await tick(PAYMENT_POLL_MS * 3);
    expect(t.getPaymentStatus).not.toHaveBeenCalled();
    expect(t.result.current.placed?.pixData).toBeNull();
  });

  it("ao desmontar, para de consultar", async () => {
    const t = setup([ok({ awaitingPayment: true, orderStatus: "PENDENTE", paymentStatus: "PENDENTE" })]);
    await placePixOrder(t);
    await tick();
    const calls = t.getPaymentStatus.mock.calls.length;
    t.unmount();
    await tick(PAYMENT_POLL_MS * 5);
    expect(t.getPaymentStatus.mock.calls.length).toBe(calls);
  });

  it("consulta lenta não empilha chamadas (uma por vez)", async () => {
    let resolveFirst: (value: HttpResult<PaymentStatusResponse>) => void = () => {};
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })]);
    t.getPaymentStatus.mockReset();
    t.getPaymentStatus.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));
    t.getPaymentStatus.mockResolvedValue(ok({ awaitingPayment: true, paymentStatus: "PENDENTE" }));
    await placePixOrder(t);
    await tick();
    await tick(PAYMENT_POLL_MS * 4); // primeira consulta ainda "no ar"
    expect(t.getPaymentStatus).toHaveBeenCalledTimes(1);
    await act(async () => resolveFirst(ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })));
    await tick();
    expect(t.getPaymentStatus).toHaveBeenCalledTimes(2);
  });
});


describe("useOrderFlow: token do pedido (NG-16)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("consulta o pagamento com o token que a API devolveu na criação", async () => {
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })]);
    await placePixOrder(t);
    await tick();
    expect(t.getPaymentStatus).toHaveBeenCalledWith("loja", "o1", TOKEN);
  });

  it("cancela com o token", async () => {
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })]);
    await placePixOrder(t);
    await act(async () => {
      await t.result.current.cancel();
    });
    expect(t.storefront.cancelOrder).toHaveBeenCalledWith("loja", "o1", TOKEN);
    expect(t.result.current.placed?.cancelled).toBe(true);
  });

  it("o token fica só em memória: não aparece no estado da tela, no histórico, nem em localStorage/sessionStorage", async () => {
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })]);
    await placePixOrder(t);
    expect(JSON.stringify(t.result.current.placed)).not.toContain(TOKEN);
    expect(JSON.stringify(t.onPlaced.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
  });

  it("sem token na resposta (API antiga ou outro aparelho): não consulta, não cancela e avisa para falar com a loja", async () => {
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })], ok({ orderId: "o9", code: "0099", payment: { pixQrCode: "000201...", pixQrCodeBase64: null } }));
    await placePixOrder(t);
    expect(t.result.current.placed?.trackingUnavailable).toBe(true);
    await tick(PAYMENT_POLL_MS * 3);
    expect(t.getPaymentStatus).not.toHaveBeenCalled();
    await act(async () => {
      await t.result.current.cancel();
    });
    expect(t.storefront.cancelOrder).not.toHaveBeenCalled();
    expect(t.result.current.placed?.cancelled).toBe(false);
    expect(t.result.current.placed?.cancelError).toBe(CANCEL_UNAVAILABLE_MESSAGE);
  });

  it("cancelar com 404 não vira 'pedido não encontrado': pede para falar com a loja", async () => {
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })]);
    (t.storefront.cancelOrder as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404, error: "pedido não encontrado" });
    await placePixOrder(t);
    await act(async () => {
      await t.result.current.cancel();
    });
    expect(t.result.current.placed?.cancelError).toBe(CANCEL_UNAVAILABLE_MESSAGE);
    expect(t.result.current.placed?.cancelled).toBe(false);
  });

  it("cancelar recusado por outro motivo (loja já aceitou) mantém a mensagem do servidor", async () => {
    const t = setup([ok({ awaitingPayment: true, paymentStatus: "PENDENTE" })]);
    (t.storefront.cancelOrder as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 409, error: "A loja já aceitou o pedido." });
    await placePixOrder(t);
    await act(async () => {
      await t.result.current.cancel();
    });
    expect(t.result.current.placed?.cancelError).toBe("A loja já aceitou o pedido.");
  });
});
