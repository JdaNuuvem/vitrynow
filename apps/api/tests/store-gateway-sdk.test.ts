import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// API-07: o SDK do Mercado Pago recebe o token CERTO. Arquivo próprio porque simula o módulo `mercadopago` inteiro.

const configs: string[] = [];
const created: unknown[] = [];

vi.mock("mercadopago", () => ({
  MercadoPagoConfig: class {
    constructor(public options: { accessToken: string }) {
      configs.push(options.accessToken);
    }
  },
  Payment: class {
    constructor(private config: { options: { accessToken: string } }) {}
    async create(input: unknown) {
      created.push({ token: this.config.options.accessToken, input });
      return { id: 777, status: "pending", point_of_interaction: { transaction_data: { qr_code: "000201x", qr_code_base64: "eA==" } }, date_of_expiration: "2026-11-17T12:30:00.000Z" };
    }
    async get() {
      return { id: 777, status: "approved", external_reference: "pedido-1", transaction_amount: 45.5, currency_id: "BRL" };
    }
    async cancel() {}
  },
  PaymentRefund: class {
    constructor(private config: { options: { accessToken: string } }) {}
    async total(input: unknown) {
      created.push({ token: this.config.options.accessToken, refund: input });
    }
  },
}));

import { cancelPayment, createPixPayment, getPayment, mercadoPagoGateway, refundPayment } from "../src/lib/mercadopago";

describe("lib/mercadopago — token por gateway", () => {
  beforeEach(() => {
    configs.length = 0;
    created.length = 0;
    process.env.MP_ACCESS_TOKEN = "TOKEN-DA-PLATAFORMA";
  });
  afterEach(() => {
    delete process.env.MP_ACCESS_TOKEN;
  });

  it("mercadoPagoGateway(token) usa SÓ o token recebido, mesmo com MP_ACCESS_TOKEN configurado", async () => {
    const gateway = mercadoPagoGateway("TOKEN-DA-LOJA");
    const pix = await gateway.createPixPayment({ orderId: "pedido-1", amountCents: 4550, description: "x", payerEmail: "a@b.c", idempotencyKey: "k1" });
    expect(pix).toMatchObject({ providerPaymentId: "777", status: "pending", pixQrCode: "000201x", pixQrCodeBase64: "eA==" });
    expect(await gateway.getPayment("777")).toEqual({ providerPaymentId: "777", status: "approved", externalReference: "pedido-1", amountCents: 4550, currency: "BRL" });
    await gateway.cancelPayment("777");
    await gateway.refundPayment("777", "refund-1");
    expect(configs.length).toBeGreaterThan(0);
    expect(new Set(configs)).toEqual(new Set(["TOKEN-DA-LOJA"]));
    expect(created[0]).toMatchObject({ token: "TOKEN-DA-LOJA", input: { body: { transaction_amount: 45.5, external_reference: "pedido-1", payment_method_id: "pix" }, requestOptions: { idempotencyKey: "k1" } } });
    expect(created[1]).toMatchObject({ token: "TOKEN-DA-LOJA", refund: { payment_id: "777", requestOptions: { idempotencyKey: "refund-1" } } });
  });

  it("as funções antigas (assinatura SaaS) seguem na conta da PLATAFORMA e mantêm as assinaturas e os retornos", async () => {
    expect(await createPixPayment({ orderId: "sub-1", amountCents: 4990, description: "x", payerEmail: "a@b.c" })).toMatchObject({ providerPaymentId: "777" });
    expect((await getPayment("777")).amountCents).toBe(4550);
    await cancelPayment("777");
    await refundPayment("777");
    expect(new Set(configs)).toEqual(new Set(["TOKEN-DA-PLATAFORMA"]));
  });

  it("sem token: gateway não é criado; função da plataforma rejeita (promessa), não lança de forma síncrona", async () => {
    expect(() => mercadoPagoGateway("")).toThrow(/token do Mercado Pago ausente/);
    delete process.env.MP_ACCESS_TOKEN;
    await expect(createPixPayment({ orderId: "x", amountCents: 1, description: "x", payerEmail: "a@b.c" })).rejects.toThrow(/MP_ACCESS_TOKEN/);
    await expect(getPayment("1")).rejects.toThrow(/MP_ACCESS_TOKEN/);
  });
});
