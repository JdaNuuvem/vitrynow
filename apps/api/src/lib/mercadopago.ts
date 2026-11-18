import { createHmac, timingSafeEqual } from "node:crypto";
import { MercadoPagoConfig, Payment as MpPayment, PaymentRefund } from "mercadopago";

// Integração PIX via Mercado Pago. `mercadoPagoGateway(token)` é a ÚNICA porta para o SDK: o token da PLATAFORMA
// (MP_ACCESS_TOKEN) só serve à cobrança da assinatura SaaS (`createPixPayment` e demais abaixo); o PIX dos pedidos usa o
// token DA LOJA, obtido por `modules/storePayments/gateway.ts` (ADR-0001: nada do dinheiro das lojas passa pela plataforma).

// Prazo do PIX (decisão do Atlas): CONSTANTE ÚNICA no servidor. Tela, provedor e o job que cancela pedido aguardando pagamento
// usam ESTE número (nunca um valor solto). Pagamento aprovado depois do prazo continua valendo (o dinheiro entrou).
export const PIX_EXPIRATION_MINUTES = 30;

/** Menor entre o prazo pedido e o que o provedor devolveu; `null` só se nenhum dos dois existe (a tela não inventa hora). */
export function effectiveExpiry(requested: Date, fromProvider: Date | null): Date {
  return fromProvider && !Number.isNaN(fromProvider.getTime()) && fromProvider < requested ? fromProvider : requested;
}

export type PixChargeInput = {
  orderId: string;
  amountCents: number;
  description: string;
  payerEmail: string;
  // Repetir a chamada com a mesma chave não cria segunda cobrança (queda entre o aceite e a gravação).
  idempotencyKey?: string;
};

export type PixCharge = {
  providerPaymentId: string;
  status: string | null | undefined; // "pending" | "approved" | "rejected" | ...
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
  /** SEMPRE presente em cobrança nova: o menor entre os 30 min fixados aqui e o prazo que o provedor devolver. */
  expiresAt: Date;
};

// Visão do pagamento no provedor — única fonte da verdade (a notificação só traz o id).
// Conferir valor, moeda e referência é obrigatório antes de aprovar qualquer coisa (ADR-0001 §3.6).
export type ProviderPayment = {
  providerPaymentId: string;
  status: string | null | undefined;
  externalReference?: string | null;
  amountCents?: number | null;
  currency?: string | null;
};

/** O provedor respondeu 404: o pagamento não existe para ESTA conta (não é de quem consultou, ou nunca existiu). Erro TIPADO: o webhook decide por ele, não por texto. */
export class PaymentNotFoundError extends Error {
  constructor() {
    super("payment not found");
    this.name = "PaymentNotFoundError";
  }
}

const isProviderNotFound = (error: unknown): boolean => {
  const e = error as { status?: number; statusCode?: number; cause?: { status?: number } } | null;
  return e?.status === 404 || e?.statusCode === 404 || e?.cause?.status === 404;
};

export interface PixGateway {
  createPixPayment(input: PixChargeInput): Promise<PixCharge>;
  getPayment(providerPaymentId: string): Promise<ProviderPayment>;
  /**
   * SOMENTE LEITURA (SEC-17): pagamentos que o provedor tem para esta `external_reference` (= id do pedido). Reencontra a cobrança "órfã" sem criar nada
   * e sem depender da janela de validade da chave de idempotência.
   */
  findByExternalReference(externalReference: string): Promise<ProviderPayment[]>;
  /** Cancela um pagamento PIX ainda pendente (cliente cancelou o pedido antes de pagar). */
  cancelPayment(providerPaymentId: string): Promise<void>;
  /**
   * Estorna um pagamento já aprovado (reembolso total); o MP devolve o PIX ao pagador quando aceita. `idempotencyKey`
   * determinística (ex. "refund-<payment.id>"): repetir depois de uma queda devolve o mesmo resultado em vez de falhar.
   */
  refundPayment(providerPaymentId: string, idempotencyKey?: string): Promise<void>;
}

export function mercadoPagoGateway(accessToken: string): PixGateway {
  if (!accessToken) throw new Error("token do Mercado Pago ausente");
  const client = () => new MercadoPagoConfig({ accessToken });
  return {
    async createPixPayment(input) {
      const payment = new MpPayment(client());
      const requested = new Date(Date.now() + PIX_EXPIRATION_MINUTES * 60_000);
      const result = await payment.create({
        body: {
          transaction_amount: input.amountCents / 100,
          description: input.description,
          payment_method_id: "pix",
          payer: { email: input.payerEmail },
          external_reference: input.orderId,
          // NÃO VERIFICADO no sandbox (CL-13): formato e aceitação de date_of_expiration; o prazo efetivo abaixo vale de qualquer jeito.
          date_of_expiration: requested.toISOString(),
        },
        ...(input.idempotencyKey ? { requestOptions: { idempotencyKey: input.idempotencyKey } } : {}),
      });
      const txData = result.point_of_interaction?.transaction_data;
      return {
        providerPaymentId: String(result.id),
        status: result.status,
        pixQrCode: txData?.qr_code ?? null,
        pixQrCodeBase64: txData?.qr_code_base64 ?? null,
        expiresAt: effectiveExpiry(requested, result.date_of_expiration ? new Date(result.date_of_expiration) : null),
      };
    },
    async getPayment(providerPaymentId) {
      const payment = new MpPayment(client());
      const result = await payment.get({ id: providerPaymentId }).catch((error: unknown) => {
        throw isProviderNotFound(error) ? new PaymentNotFoundError() : error;
      });
      return {
        providerPaymentId: String(result.id),
        status: result.status,
        externalReference: result.external_reference ?? null,
        amountCents: typeof result.transaction_amount === "number" ? Math.round(result.transaction_amount * 100) : null,
        currency: result.currency_id ?? null,
      };
    },
    async findByExternalReference(externalReference) {
      // NÃO VERIFICADO no sandbox (CL-13): filtro `external_reference` do search e formato de `results`.
      const found = await new MpPayment(client()).search({ options: { external_reference: externalReference, sort: "date_created", criteria: "desc" } });
      return (found.results ?? []).map((r) => ({
        providerPaymentId: String(r.id),
        status: r.status,
        externalReference: r.external_reference ?? null,
        amountCents: typeof r.transaction_amount === "number" ? Math.round(r.transaction_amount * 100) : null,
        currency: r.currency_id ?? null,
      }));
    },
    async cancelPayment(providerPaymentId) {
      const payment = new MpPayment(client());
      await payment.cancel({ id: providerPaymentId });
    },
    async refundPayment(providerPaymentId, idempotencyKey) {
      const refund = new PaymentRefund(client());
      await refund.total({ payment_id: providerPaymentId, ...(idempotencyKey ? { requestOptions: { idempotencyKey } } : {}) });
    },
  };
}

// Conta da PLATAFORMA (assinatura SaaS). Não usar para o PIX dos pedidos das lojas.
function platformGateway(): PixGateway {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN não configurado");
  return mercadoPagoGateway(accessToken);
}

export const createPixPayment = async (input: PixChargeInput) => platformGateway().createPixPayment(input);
export const getPayment = async (providerPaymentId: string) => platformGateway().getPayment(providerPaymentId);
export const cancelPayment = async (providerPaymentId: string) => platformGateway().cancelPayment(providerPaymentId);
export const refundPayment = async (providerPaymentId: string, idempotencyKey?: string) => platformGateway().refundPayment(providerPaymentId, idempotencyKey);

// Confere o header x-signature do webhook (ts=...,v1=<hmac>) contra MP_WEBHOOK_SECRET.
// Sem isso, qualquer POST externo com um data.id válido conseguiria "confirmar" pagamento
// de pedidos — ver https://www.mercadopago.com.br/developers/pt/docs/checkout-api/webhooks
// Janela em que um `ts` ainda vale (replay de notificação antiga é recusado). Configurável porque o
// comportamento de reenvio do provedor deve ser confirmado no sandbox (CL-13); o estado nunca depende
// só da notificação — sempre consultamos o provedor —, então o replay não altera nada de qualquer forma.
function tsToleranceMs(): number {
  const seconds = Number(process.env.MP_WEBHOOK_TS_TOLERANCE_SEC);
  // Padrão 900 s; teto de 3600 s (uma janela maior vira convite a replay).
  return Math.min(Number.isFinite(seconds) && seconds > 0 ? seconds : 900, 3600) * 1000;
}

export function verifyWebhookSignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string;
  now?: number;
}): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false; // sem segredo configurado = não aceita nenhum webhook

  const header = input.signatureHeader;
  if (!header) return false;

  const parts = new Map(
    header
      .split(",")
      .map((part) => part.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2)
      .map(([k, v]) => [k, v] as [string, string]),
  );
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !v1) return false;

  // ts em ms (13 dígitos) ou em s (10 dígitos); fora da janela = replay ou relógio quebrado.
  const tsNumber = Number(ts);
  if (!Number.isFinite(tsNumber) || tsNumber <= 0) return false;
  const tsMs = tsNumber < 1e12 ? tsNumber * 1000 : tsNumber;
  if (Math.abs((input.now ?? Date.now()) - tsMs) > tsToleranceMs()) return false;

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(v1, "hex");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

// Status do provedor → status interno (ADR-0007 §4). Status desconhecido devolve null: quem chama mantém o
// estado atual, grava `lastRawStatus` e alerta — nunca vira PENDENTE "por padrão".
export type InternalPaymentStatus =
  | "PENDENTE"
  | "EM_ANALISE"
  | "APROVADO"
  | "REJEITADO"
  | "CANCELADO"
  | "EXPIRADO"
  | "REEMBOLSADO"
  | "CONTESTADO";

export function mapMpStatus(mpStatus: string | null | undefined): InternalPaymentStatus | null {
  switch (mpStatus) {
    case "pending":
      return "PENDENTE";
    case "in_process":
    case "authorized":
    case "in_mediation":
      return "EM_ANALISE";
    case "approved":
      return "APROVADO";
    case "rejected":
      return "REJEITADO";
    case "cancelled":
      return "CANCELADO";
    case "expired":
      return "EXPIRADO";
    case "refunded":
      return "REEMBOLSADO";
    case "charged_back":
      return "CONTESTADO";
    default:
      return null;
  }
}
