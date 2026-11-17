import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { orderHistoryQuerySchema, orderInternalNoteSchema, orderStatusSchema } from "@meucardapio/shared-types";
import { prismaAuditLogger } from "../../shared/audit";
import { CodedError, useDomainErrors } from "../../shared/errors";
import { publishToStore } from "../../realtime/hub";
import { mfaProofAccepted, requireMfa } from "../../lib/mfaGate";
import { OrderService, type CancelReason, type PanelActor } from "./orders.service";
import { assertHistoryRate } from "./orders.history";

export const orderService = new OrderService(prisma, prismaAuditLogger, publishToStore);

const actorOf = (request: FastifyRequest): PanelActor => ({
  storeId: request.user.storeId,
  userId: request.user.userId,
  role: request.user.role,
});

// MFA só quando o cancelamento/estorno movimenta dinheiro (OWNER, MFA_ENFORCED). Retorna false se já respondeu.
async function guardRefund(request: FastifyRequest, reply: FastifyReply, orderId: string): Promise<boolean> {
  if (!(await orderService.needsRefund(request.user.storeId, orderId))) return true;
  if (request.user.role !== "OWNER") {
    reply.code(403).send({ error: "Só o dono da loja pode cancelar um pedido já pago.", code: "FORBIDDEN_ROLE" });
    return false;
  }
  if (!(await mfaProofAccepted(request, "refund"))) {
    reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose: "refund" });
    return false;
  }
  return true;
}

// Rotas do painel (kanban) — contrato em atlas/contratos/b3-estados-e-cancelamento.md.
const orderRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  const auth = { preHandler: app.requirePanelAuth };

  app.get("/api/orders", auth, async (request) => {
    const query = request.query as { cursor?: string; limit?: string };
    return orderService.list(actorOf(request), { cursor: query.cursor, limit: Number(query.limit) || undefined });
  });

  // Histórico (RN-HP): busca única + filtros + período (máx. 90 dias) + cursor. Rota estática: vence `/api/orders/:id`.
  app.get("/api/orders/history", auth, async (request, reply) => {
    const parsed = orderHistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "Filtro inválido.", code: "FILTER_INVALID" });
    assertHistoryRate(request.user.userId); // RN-HP-07: anti-abuso por usuário (429 RATE_LIMITED)
    const { refundPending, ...rest } = parsed.data;
    try {
      return await orderService.history(actorOf(request), { ...rest, refundPending: refundPending === "true" });
    } catch (error) {
      // Falha ao gravar o rastro da busca por telefone: o serviço não devolve dado; aqui o motivo vai ao log SEM o erro bruto.
      const cause = (error as { code?: string; cause?: unknown }).code === "AUDIT_UNAVAILABLE" ? (error as { cause?: unknown }).cause : undefined;
      if (cause) request.log.error({ err: cause }, "busca por telefone NÃO liberada: falha ao registrar o acesso");
      throw error;
    }
  });

  // Observação interna (API-54): a equipe anota; o cliente e o tíquete nunca a veem. `null` ou texto vazio apaga.
  app.post("/api/orders/:id/internal-note", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = orderInternalNoteSchema.safeParse(request.body);
    if (!parsed.success) {
      const tooLong = parsed.error.issues.some((i) => i.code === "too_big");
      return reply.code(400).send(tooLong ? { error: "A observação pode ter até 500 caracteres.", code: "NOTE_TOO_LONG" } : { error: "Observação inválida.", code: "VALIDATION_ERROR" });
    }
    return orderService.setInternalNote(actorOf(request), id, parsed.data.note);
  });

  app.get("/api/orders/:id", auth, async (request) => {
    const { id } = request.params as { id: string };
    return { order: await orderService.detail(actorOf(request), id) };
  });

  app.post("/api/orders/:id/transition", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const to = orderStatusSchema.safeParse((request.body as { to?: unknown })?.to);
    if (!to.success) return reply.code(400).send({ error: "status inválido", code: "INVALID_TRANSITION" });
    return { order: await orderService.transition(actorOf(request), id, to.data) };
  });

  app.post("/api/orders/:id/cancel", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body ?? {}) as { reason?: CancelReason };
    if (!(await guardRefund(request, reply, id))) return;
    const result = await orderService.cancelByPanel(actorOf(request), id, body.reason);
    return reply.code(result.refund === "PENDING" ? 202 : 200).send(result.refund === "NONE" ? { order: result.order } : result);
  });

  app.post("/api/orders/:id/refund/retry", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (request.user.role !== "OWNER") return reply.code(403).send({ error: "ação restrita ao dono da loja", code: "FORBIDDEN_ROLE" });
    if (!(await mfaProofAccepted(request, "refund"))) {
      return reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose: "refund" });
    }
    const result = await orderService.retryRefund(actorOf(request), id);
    return reply.code(result.refund === "PENDING" ? 202 : 200).send(result);
  });

  app.post("/api/orders/:id/undo", auth, async (request) => {
    const { id } = request.params as { id: string };
    return { order: await orderService.undo(actorOf(request), id) };
  });

  // ───────────── Legado (deprecated até WEB-05): mesmo serviço, resposta antiga { ok: true } ─────────────
  app.post("/api/orders/:id/status", auth, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = orderStatusSchema.safeParse((request.body as { status?: unknown })?.status);
    if (!parsed.success) return reply.code(400).send({ error: "status inválido" });
    if (parsed.data === "CANCELADO") {
      // Cancelar pedido pago exige o fluxo explícito (motivo + estorno): a rota legada não estorna por conta própria.
      if (await orderService.needsRefund(request.user.storeId, id)) {
        throw new CodedError(409, "REFUND_REQUIRED", "Pedido pago: cancele pelo fluxo com motivo, que estorna o PIX.");
      }
      await orderService.cancelByPanel(actorOf(request), id, { code: "OUTRO", text: "Cancelado pelo painel" });
    } else {
      await orderService.transition(actorOf(request), id, parsed.data);
    }
    return { ok: true };
  });

  // Estorno de PIX já aprovado — OWNER (+ MFA). Equivale a cancelar com motivo "Estorno pelo painel".
  app.post("/api/orders/:id/refund", { preHandler: [app.requirePanelAuth, app.requireOwner, requireMfa("refund")] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await orderService.needsRefund(request.user.storeId, id))) {
      return reply.code(409).send({ error: "pedido não tem pagamento aprovado para estornar" });
    }
    const result = await orderService.cancelByPanel(actorOf(request), id, { code: "OUTRO", text: "Estorno pelo painel" });
    if (result.refund === "PENDING") return reply.code(502).send({ error: "não foi possível estornar no Mercado Pago, tente novamente" });
    return { ok: true };
  });
};

export default orderRoutes;
