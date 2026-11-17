import { createHmac, timingSafeEqual } from "node:crypto";
import { MercadoPagoConfig, Payment as MpPayment, PaymentRefund } from "mercadopago";

// Integração PIX via Mercado Pago. Token vem de MP_ACCESS_TOKEN (conta da plataforma,
// não da loja — simplificação da Fase 3: todo recebimento passa por uma conta só).
function client() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) throw new Error("MP_ACCESS_TOKEN não configurado");
  return new MercadoPagoConfig({ accessToken });
}

export async function createPixPayment(input: {
  orderId: string;
  amountCents: number;
  description: string;
  payerEmail: string;
  // Repetir a chamada com a mesma chave não cria segunda cobrança (queda entre o aceite e a gravação).
  idempotencyKey?: string;
}) {
  const payment = new MpPayment(client());
  const result = await payment.create({
    body: {
      transaction_amount: input.amountCents / 100,
      description: input.description,
      payment_method_id: "pix",
      payer: { email: input.payerEmail },
      external_reference: input.orderId,
    },
    ...(input.idempotencyKey ? { requestOptions: { idempotencyKey: input.idempotencyKey } } : {}),
  });

  const txData = result.point_of_interaction?.transaction_data;
  return {
    providerPaymentId: String(result.id),
    status: result.status, // "pending" | "approved" | "rejected" | ...
    pixQrCode: txData?.qr_code ?? null,
    pixQrCodeBase64: txData?.qr_code_base64 ?? null,
    expiresAt: result.date_of_expiration ? new Date(result.date_of_expiration) : null,
  };
}

// Visão do pagamento no provedor — única fonte da verdade (a notificação só traz o id).
// Conferir valor, moeda e referência é obrigatório antes de aprovar qualquer coisa (ADR-0001 §3.6).
export type ProviderPayment = {
  providerPaymentId: string;
  status: string | null | undefined;
  externalReference?: string | null;
  amountCents?: number | null;
  currency?: string | null;
};

export async function getPayment(providerPaymentId: string): Promise<ProviderPayment> {
  const payment = new MpPayment(client());
  const result = await payment.get({ id: providerPaymentId });
  return {
    providerPaymentId: String(result.id),
    status: result.status,
    externalReference: result.external_reference ?? null,
    amountCents: typeof result.transaction_amount === "number" ? Math.round(result.transaction_amount * 100) : null,
    currency: result.currency_id ?? null,
  };
}

// Cancela um pagamento PIX ainda pendente (cliente cancelou o pedido antes de pagar).
export async function cancelPayment(providerPaymentId: string) {
  const payment = new MpPayment(client());
  await payment.cancel({ id: providerPaymentId });
}

// Estorna um pagamento já aprovado (reembolso total). Mercado Pago devolve o PIX pro
// pagador automaticamente quando o estorno é aceito.
// idempotencyKey deterministica (ex. "refund-<payment.id>"): repetir a chamada depois de uma queda
// devolve o mesmo resultado em vez de falhar com "ja estornado".
export async function refundPayment(providerPaymentId: string, idempotencyKey?: string) {
  const refund = new PaymentRefund(client());
  await refund.total({ payment_id: providerPaymentId, ...(idempotencyKey ? { requestOptions: { idempotencyKey } } : {}) });
}

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
