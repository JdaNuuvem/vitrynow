import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { prismaAuditLogger } from "../../shared/audit";
import { publishToStore } from "../../realtime/hub";
import { verifyWebhookSignature } from "../../lib/mercadopago";
import { orderService } from "../orders/orders.module";
import { limited, tooMany } from "../../lib/slidingLimit";
import { providerErrorCode } from "../orders/orders.service";
import { PaymentService } from "./payments.service";

export const paymentService = new PaymentService(prisma, orderService, prismaAuditLogger, publishToStore);

// Webhook do Mercado Pago. Assinatura (x-signature + MP_WEBHOOK_SECRET, com janela de `ts`) é a única porta:
// sem ela nada muda. Resposta 200 sempre que a assinatura vale e o evento foi processado OU conscientemente
// ignorado; 5xx só para falha transitória nossa/do provedor (para o provedor reenviar).
const paymentRoutes: FastifyPluginAsync = async (app) => {
  // API-55 (RN-PP-01/02): PIX aguardando pagamento, lista SOMENTE LEITURA (OWNER e STAFF). Esses pedidos não entram no kanban nem na impressão.
  // Sem dado de pagamento do provedor (QR, id, chave): só código, cliente, valor, hora e tempo restante.
  app.get("/api/orders/awaiting-payment", { preHandler: app.requirePanelAuth }, async (request) => {
    const storeId = request.user.storeId;
    const now = Date.now();
    const rows = await prisma.order.findMany({
      where: { storeId, awaitingPayment: true, status: "PENDENTE", payment: { is: { status: "PENDENTE" } } },
      select: { id: true, code: true, customerName: true, totalCents: true, createdAt: true, payment: { select: { expiresAt: true } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 200,
    });
    return {
      count: rows.length,
      orders: rows.map((o) => ({
        id: o.id,
        code: o.code,
        customerName: o.customerName,
        totalCents: o.totalCents,
        createdAt: o.createdAt.toISOString(),
        expiresAt: o.payment?.expiresAt?.toISOString() ?? null,
        secondsLeft: o.payment?.expiresAt ? Math.max(0, Math.floor((o.payment.expiresAt.getTime() - now) / 1000)) : null,
      })),
    };
  });

  // API-55 (RN-PP-03): "Conferir pagamento" = UMA consulta ao provedor da loja, pela MESMA função do webhook (valor, moeda e referência conferidos;
  // nunca aprova sem bater). Não cria, não altera por conta própria e não estorna. 1 por minuto por pedido. Resultado em 3 palavras fixas.
  app.post("/api/orders/:id/payment/check", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, storeId: request.user.storeId }, select: { id: true, payment: { select: { id: true, status: true, providerPaymentId: true } } } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado", code: "ORDER_NOT_FOUND" });
    const payment = order.payment;
    if (!payment) return reply.code(409).send({ error: "Este pedido não tem pagamento online.", code: "NOT_AWAITING_PAYMENT" });
    if (payment.status === "APROVADO") return { result: "PAID" as const };
    if (payment.status !== "PENDENTE") return reply.code(409).send({ error: "Este pedido não está aguardando pagamento.", code: "NOT_AWAITING_PAYMENT" });
    if (limited(`payment-check:${order.id}`, 1)) return tooMany(reply);
    if (!payment.providerPaymentId) return { result: "UNVERIFIED" as const };
    try {
      await paymentService.handleNotification(payment.providerPaymentId);
    } catch (error) {
      request.log.warn(`conferência de pagamento falhou: ${providerErrorCode(error)}`); // só status/código; nunca a mensagem do provedor
      return { result: "UNVERIFIED" as const };
    }
    const after = await prisma.payment.findUnique({ where: { id: payment.id }, select: { status: true } });
    return { result: after?.status === "APROVADO" ? ("PAID" as const) : ("NOT_PAID" as const) };
  });

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
