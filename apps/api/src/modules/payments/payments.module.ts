import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { publishToStore } from "../../realtime/hub";
import { verifyWebhookSignature } from "../../lib/mercadopago";
import { orderService } from "../orders/orders.module";
import { PaymentService } from "./payments.service";

export const paymentService = new PaymentService(prisma, orderService, prismaAuditLogger, publishToStore);

// Webhook do Mercado Pago. Assinatura (x-signature + MP_WEBHOOK_SECRET, com janela de `ts`) é a única porta:
// sem ela nada muda. Resposta 200 sempre que a assinatura vale e o evento foi processado OU conscientemente
// ignorado; 5xx só para falha transitória nossa/do provedor (para o provedor reenviar).
const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.post("/api/payments/webhook", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = (request.body ?? {}) as { type?: string; action?: string; data?: { id?: string | number } };
    const providerPaymentId = body.data?.id;
    if (!providerPaymentId || (body.type && body.type !== "payment")) {
      return reply.code(200).send({ ok: true });
    }

    const valid = verifyWebhookSignature({
      signatureHeader: request.headers["x-signature"] as string | undefined,
      requestId: request.headers["x-request-id"] as string | undefined,
      dataId: String(providerPaymentId),
    });
    if (!valid) {
      app.log.warn("webhook do mercado pago rejeitado: assinatura inválida, fora da janela ou MP_WEBHOOK_SECRET ausente");
      return reply.code(401).send({ error: "assinatura inválida" });
    }

    try {
      // `?store=` é só a dica da nossa notification_url (a assinatura acima é a autorização). Formato estranho = sem dica.
      const hint = (request.query as { store?: unknown } | undefined)?.store;
      await paymentService.handleNotification(String(providerPaymentId), typeof hint === "string" && /^[a-z0-9]{10,40}$/i.test(hint) ? hint : undefined);
    } catch (error) {
      app.log.error({ err: error }, "falha ao processar webhook do mercado pago");
      return reply.code(503).send({ error: "falha transitória" });
    }
    return reply.code(200).send({ ok: true });
  });
};

export default paymentRoutes;
