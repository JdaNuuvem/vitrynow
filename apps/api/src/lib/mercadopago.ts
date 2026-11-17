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

export async function getPayment(providerPaymentId: string) {
  const payment = new MpPayment(client());
  const result = await payment.get({ id: providerPaymentId });
  return { providerPaymentId: String(result.id), status: result.status };
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
export function verifyWebhookSignature(input: {
  signatureHeader: string | undefined;
  requestId: string | undefined;
  dataId: string;
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

  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId ?? ""};ts:${ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(v1, "hex");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export function mapMpStatus(mpStatus: string | null | undefined): "PENDENTE" | "APROVADO" | "REJEITADO" | "EXPIRADO" {
  switch (mpStatus) {
    case "approved":
      return "APROVADO";
    case "rejected":
    case "cancelled":
      return "REJEITADO";
    case "expired":
      return "EXPIRADO";
    default:
      return "PENDENTE";
  }
}
