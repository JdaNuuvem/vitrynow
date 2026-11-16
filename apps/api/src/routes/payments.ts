import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { getPayment, mapMpStatus, verifyWebhookSignature } from "../lib/mercadopago";
import { publishToStore } from "../realtime/hub";
import { activateSubscription } from "../lib/subscription";

// Webhook do Mercado Pago. Eles notificam só com o id do pagamento — a gente busca o
// status real na API deles antes de confiar em qualquer coisa do corpo da notificação,
// e só processa se a assinatura (x-signature/MP_WEBHOOK_SECRET) for válida.
// Pagamento de assinatura (PIX da plataforma): aprovado → ativa/renova o período de 30 dias.
// Só ativa na transição para APROVADO, então notificação repetida do MP não renova de novo.
async function handleSubscriptionPayment(providerPaymentId: string) {
  const payment = await prisma.subscriptionPayment.findUnique({ where: { providerPaymentId } });
  if (!payment) return;

  const status = mapMpStatus((await getPayment(providerPaymentId)).status);
  if (payment.status === status) return;

  await prisma.subscriptionPayment.update({ where: { id: payment.id }, data: { status } });
  if (status === "APROVADO") {
    await activateSubscription({ subscriptionId: payment.subscriptionId, planCode: payment.planCode });
  }
}

const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    "/api/payments/webhook",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const body = request.body as { type?: string; action?: string; data?: { id?: string } };
    const providerPaymentId = body.data?.id;
    if (!providerPaymentId || (body.type && body.type !== "payment")) {
      return reply.code(200).send({ ok: true });
    }

    const signatureValid = verifyWebhookSignature({
      signatureHeader: request.headers["x-signature"] as string | undefined,
      requestId: request.headers["x-request-id"] as string | undefined,
      dataId: String(providerPaymentId),
    });
    if (!signatureValid) {
      app.log.warn("webhook do mercado pago rejeitado: assinatura inválida ou MP_WEBHOOK_SECRET ausente");
      return reply.code(401).send({ error: "assinatura inválida" });
    }

    const payment = await prisma.payment.findUnique({ where: { providerPaymentId: String(providerPaymentId) } });
    if (!payment) {
      await handleSubscriptionPayment(String(providerPaymentId));
      return reply.code(200).send({ ok: true });
    }

    const remote = await getPayment(String(providerPaymentId));
    const status = mapMpStatus(remote.status);

    await prisma.payment.update({ where: { id: payment.id }, data: { status } });

    if (status === "APROVADO") {
      const order = await prisma.order.update({
        where: { id: payment.orderId },
        data: { awaitingPayment: false },
      });
      publishToStore(order.storeId, { type: "order.created", orderId: order.id });
    } else if (status === "REJEITADO" || status === "EXPIRADO") {
      await prisma.order.update({ where: { id: payment.orderId }, data: { status: "CANCELADO" } });
    }

    return reply.code(200).send({ ok: true });
    },
  );
};

export default paymentRoutes;
