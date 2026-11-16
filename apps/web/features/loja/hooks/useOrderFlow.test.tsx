import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PaymentStatusResponse } from "@/core/domain/storefront";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";
import type { HttpResult } from "@/core/http/HttpClient";
import { StorefrontServicesProvider } from "@/core/services/StorefrontServices";
import type { CheckoutForm } from "../checkoutForm";
import { PAYMENT_POLL_MS, useOrderFlow } from "./useOrderFlow";

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
      placeResult ?? ok({ orderId: "o1", code: "0042", payment: { pixQrCode: "000201...", pixQrCodeBase64: null } }),
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

  it("pedido inexistente (404) encerra o acompanhamento com aviso", async () => {
    const t = setup([{ ok: false, status: 404, error: "pedido não encontrado" }]);
    await placePixOrder(t);
    await tick();
    expect(t.result.current.placed?.paymentFailedMessage).toContain("Não encontramos");
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
