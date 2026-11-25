import type { prisma as prismaClient, Payment, PaymentStatus, SubscriptionPayment } from "@meucardapio/db";
import type { WsServerMessage } from "@meucardapio/shared-types";
import type { AuditLogger } from "../../shared/audit";
import { PaymentNotFoundError, getPayment as platformGetPayment, mapMpStatus, type ProviderPayment } from "../../lib/mercadopago";
import { PixUnavailableError } from "../storePayments/storePayments.service";
import { gatewayForStore, gatewayOfPayment } from "../storePayments/gateway";
import { canMovePayment, originsFor } from "../../lib/paymentStateMachine";
import { activateSubscription } from "../../lib/subscription";
import type { OrderService } from "../orders/orders.service";
import { enqueueOrderTicket } from "../printJobs/printJobs.queue";

type Db = typeof prismaClient;

// O que o webhook fez — devolvido só para teste e log (a resposta HTTP é sempre 200 quando a assinatura é válida).
export type WebhookOutcome =
  | "UNKNOWN_PAYMENT"
  | "MISMATCH"
  | "UNKNOWN_STATUS"
  | "NOOP"
  | "REGRESSION_IGNORED"
  | { applied: PaymentStatus; announced?: boolean; refunded?: boolean };

// Webhook do Mercado Pago (ADR-0007 §6.1). A notificação só traz o id: o estado vem SEMPRE da consulta ao
// provedor, conferido contra o que gravamos (valor, moeda, referência). Cada transição é um UPDATE
// condicional; só quem vence (contagem 1) produz efeitos — entrega duplicada ou fora de ordem não faz nada.
export class PaymentService {
  constructor(
    private readonly db: Db,
    private readonly orders: OrderService,
    private readonly audit: AuditLogger,
    private readonly publish: (storeId: string, message: WsServerMessage) => void,
  ) {}

  /**
   * `storeHint` é a loja que a NOSSA `notification_url` carrega (`?store=`): uma DICA, nunca autorização (a assinatura já foi conferida antes).
   * Qual token consulta o provedor: 1) o `Payment` local achado por `providerPaymentId` usa a conta DELE; 2) sem ele (notificação antes de
   * gravarmos o id), a conta da loja da dica; 3) sem nenhum dos dois, a plataforma (assinatura SaaS). Depois da consulta, o pagamento de
   * PEDIDO só vale se a referência apontar para um pedido DA MESMA loja usada na consulta; senão é ignorado sem efeito.
   */
  async handleNotification(providerPaymentId: string, storeHint?: string): Promise<WebhookOutcome> {
    const known = await this.db.payment.findUnique({ where: { providerPaymentId }, include: { order: { select: { storeId: true } } } });
    // Falha de rede/provedor aqui propaga ⇒ 5xx ⇒ o provedor reenvia (§6.1 item 6).
    let remote: ProviderPayment;
    let queriedStore: string | null = null;
    if (known) {
      queriedStore = known.order.storeId;
      remote = await (await gatewayOfPayment(known, known.order.storeId)).getPayment(providerPaymentId);
    } else if (storeHint) {
      const store = await this.db.store.findUnique({ where: { id: storeHint }, select: { id: true } });
      if (!store) return "UNKNOWN_PAYMENT"; // dica inexistente: 200 sem efeito, nunca 4xx que vire oráculo
      queriedStore = store.id;
      try {
        remote = await (await gatewayForStore(store.id)).getPayment(providerPaymentId);
      } catch (error) {
        // Erro TIPADO (nunca regex sobre texto): conta da dica sem PIX ou pagamento que não é dela ⇒ 200 sem efeito, nunca 5xx (o MP repetiria).
        if (error instanceof PaymentNotFoundError || error instanceof PixUnavailableError) return "UNKNOWN_PAYMENT";
        throw error;
      }
    } else {
      // Sem dica e sem pagamento conhecido: conta da plataforma (assinatura SaaS). 404 do provedor = não é nosso: 200, nunca 5xx.
      try {
        remote = await platformGetPayment(providerPaymentId);
      } catch (error) {
        if (error instanceof PaymentNotFoundError) return "UNKNOWN_PAYMENT";
        throw error;
      }
    }

    const orderPayment = await this.findOrderPayment(providerPaymentId, remote);
    if (orderPayment) {
      // Consultamos com o token de UMA loja: o pedido tem que ser dessa mesma loja (sem cruzar lojas por uma dica forjada).
      if (queriedStore) {
        const owner = await this.db.order.findUnique({ where: { id: orderPayment.orderId }, select: { storeId: true } });
        if (!owner || owner.storeId !== queriedStore) return "UNKNOWN_PAYMENT";
      }
      return this.applyOrderPayment(orderPayment, remote);
    }

    const subscriptionPayment = await this.findSubscriptionPayment(providerPaymentId, remote);
    if (subscriptionPayment) return this.applySubscriptionPayment(subscriptionPayment, remote);

    return "UNKNOWN_PAYMENT";
  }

  // ───────────── Localizar o pagamento local ─────────────
  // A notificação pode chegar ANTES de gravarmos o id do provedor (ou a gravação pode ter caído depois do
  // aceite — cobrança "órfã", SEC-17). Nesse caso a referência externa (= id do pedido) liga os dois lados.
  private async findOrderPayment(providerPaymentId: string, remote: ProviderPayment): Promise<Payment | null> {
    const known = await this.db.payment.findUnique({ where: { providerPaymentId } });
    if (known) return known;
    const reference = remote.externalReference;
    if (!reference) return null;
    const pending = await this.db.payment.findFirst({ where: { orderId: reference, providerPaymentId: null } });
    if (!pending || !this.matchesLocal(remote, pending.amountCents, pending.orderId)) return null;
    const attached = await this.db.payment.updateMany({ where: { id: pending.id, providerPaymentId: null }, data: { providerPaymentId } });
    return attached.count === 1 ? this.db.payment.findUnique({ where: { id: pending.id } }) : this.db.payment.findUnique({ where: { providerPaymentId } });
  }

  private async findSubscriptionPayment(providerPaymentId: string, remote: ProviderPayment): Promise<SubscriptionPayment | null> {
    const known = await this.db.subscriptionPayment.findUnique({ where: { providerPaymentId } });
    if (known) return known;
    const reference = remote.externalReference;
    if (!reference) return null;
    const pending = await this.db.subscriptionPayment.findFirst({ where: { id: reference, providerPaymentId: null } });
    if (!pending || !this.matchesLocal(remote, pending.amountCents, pending.id)) return null;
    const attached = await this.db.subscriptionPayment.updateMany({ where: { id: pending.id, providerPaymentId: null }, data: { providerPaymentId } });
    return attached.count === 1
      ? this.db.subscriptionPayment.findUnique({ where: { id: pending.id } })
      : this.db.subscriptionPayment.findUnique({ where: { providerPaymentId } });
  }

  // Valor, moeda e referência têm que bater com o que gravamos; ausência = não verificável = não aprova.
  private matchesLocal(remote: ProviderPayment, amountCents: number, reference: string): boolean {
    return remote.externalReference === reference && remote.amountCents === amountCents && remote.currency === "BRL";
  }

  // ───────────── Pedido ─────────────
  private async applyOrderPayment(payment: Payment, remote: ProviderPayment): Promise<WebhookOutcome> {
    const order = await this.db.order.findUniqueOrThrow({ where: { id: payment.orderId }, select: { id: true, storeId: true, status: true } });
    const audit = (action: string, metadata: Record<string, unknown> = {}) =>
      this.audit.log({ storeId: order.storeId, action, targetType: "Payment", targetId: payment.id, metadata });

    if (!this.matchesLocal(remote, payment.amountCents, payment.orderId)) {
      await this.db.payment.update({ where: { id: payment.id }, data: { lastRawStatus: remote.status ?? null, lastCheckedAt: new Date() } });
      audit("payment.mismatch", { remoteStatus: remote.status ?? null });
      return "MISMATCH";
    }

    const mapped = mapMpStatus(remote.status);
    await this.db.payment.update({ where: { id: payment.id }, data: { lastRawStatus: remote.status ?? null, lastCheckedAt: new Date() } });
    if (!mapped) {
      audit("payment.unknown_status", { remoteStatus: remote.status ?? null });
      return "UNKNOWN_STATUS";
    }
    if (mapped === payment.status) return "NOOP";

    // Estorno nosso em andamento e o provedor já mostra "refunded": quem conclui é a saga (cancela o pedido
    // junto). Trocar o status aqui deixaria o pedido ativo com o dinheiro devolvido.
    if (payment.status === "ESTORNO_PENDENTE" && mapped === "REEMBOLSADO") {
      await this.orders.attemptRefund(payment.id);
      return { applied: "REEMBOLSADO", refunded: true };
    }

    if (!canMovePayment(payment.status, mapped)) {
      audit("payment.regression_ignored", { from: payment.status, remote: mapped });
      return "REGRESSION_IGNORED";
    }

    // Transição condicional: contagem 0 = outra entrega (ou o job de conciliação) já aplicou ⇒ nada a fazer.
    const moved = await this.db.payment.updateMany({ where: { id: payment.id, status: { in: originsFor(mapped) } }, data: { status: mapped } });
    if (moved.count !== 1) return "NOOP";

    return this.orderEffects(order, payment, mapped);
  }

  // Efeitos de negócio — só para quem venceu a transição.
  private async orderEffects(order: { id: string; storeId: string }, payment: Payment, mapped: PaymentStatus): Promise<WebhookOutcome> {
    switch (mapped) {
      case "APROVADO": {
        // Conditional: se o pedido foi cancelado no meio do caminho a contagem é 0 e vira estorno automático.
        // O tíquete entra na MESMA transação: ou o pedido vai para o kanban COM job, ou nada muda.
        const announced = await this.db.$transaction(async (tx) => {
          const moved = await tx.order.updateMany({
            where: { id: order.id, awaitingPayment: true, status: { not: "CANCELADO" } },
            data: { awaitingPayment: false, paidAt: new Date() }, // o dinheiro (PIX) foi RECEBIDO agora (RN-CX-01)
          });
          if (moved.count !== 1) return null;
          // API-40: agendado ainda retido fica pago mas fora da cozinha; o job schedule.release anuncia e imprime no horário.
          const { held } = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { held: true } });
          if (held) return { deferred: true as const };
          return { queued: await enqueueOrderTicket(tx, { id: order.id, storeId: order.storeId }) };
        });
        if (announced && "deferred" in announced) return { applied: mapped };
        if (announced) {
          this.publish(order.storeId, { type: "order.created", orderId: order.id });
          if (announced.queued) this.publish(order.storeId, { type: "print.available" });
          return { applied: mapped, announced: true };
        }
        const current = await this.db.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
        if (current.status === "CANCELADO") {
          // Pagou depois de cancelado (RN-B3-04): estorna e NÃO anuncia o pedido.
          await this.orders.refundAfterCancel(payment.id);
          return { applied: mapped, refunded: true };
        }
        return { applied: mapped };
      }
      case "REJEITADO":
      case "EXPIRADO":
      case "CANCELADO":
        await this.orders.cancelBySystem(order.storeId, order.id, "PAGAMENTO_NAO_APROVADO", "WEBHOOK");
        return { applied: mapped };
      case "REEMBOLSADO": {
        // Estorno feito por fora (painel do provedor): o dinheiro já voltou, o pedido ativo não faz mais sentido.
        await this.orders.cancelBySystem(order.storeId, order.id, "PAGAMENTO_ESTORNADO_NO_PROVEDOR", "WEBHOOK");
        // Pedido já finalizado (ex.: concluído): não dá para cancelar, mas o dinheiro voltou ⇒ conciliação visível (C5).
        await this.reconcileIfNotCancelled(order, payment.id, "O pagamento foi estornado fora do sistema");
        return { applied: mapped };
      }
      case "CONTESTADO":
        // Sem automação de dinheiro (ADR-0007 §6.1), mas NUNCA em silêncio: o dinheiro foi retirado pelo banco/MP.
        this.audit.log({ storeId: order.storeId, action: "payment.chargeback", targetType: "Payment", targetId: payment.id });
        await this.markReconcile(order, payment.id, "Contestação (chargeback) aberta: o valor foi retirado. Conferir com o cliente.");
        return { applied: mapped };
      default:
        return { applied: mapped };
    }
  }

  // Dinheiro saiu por fora e o pedido não ficou CANCELADO: marca para conciliação manual, com alerta (nunca silencioso).
  private async reconcileIfNotCancelled(order: { id: string; storeId: string }, paymentId: string, what: string) {
    const current = await this.db.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    if (current.status === "CANCELADO") return;
    await this.markReconcile(order, paymentId, `${what}, mas o pedido está ${current.status}. Conferir com o cliente.`);
  }

  private async markReconcile(order: { id: string; storeId: string }, paymentId: string, note: string) {
    // Condicional: só a primeira entrega grava e alerta; reentrega do mesmo webhook não repete o alerta.
    const marked = await this.db.payment.updateMany({ where: { id: paymentId, reconcileNote: null }, data: { reconcileNote: note } });
    if (marked.count !== 1) return;
    this.publish(order.storeId, { type: "payment.reconcile_needed", orderId: order.id });
    this.audit.log({ storeId: order.storeId, action: "order.refund_reconcile", targetType: "Order", targetId: order.id, metadata: { note } });
  }

  // ───────────── Assinatura da plataforma ─────────────
  // Aprovação + ativação do plano na MESMA transação e condicionadas à troca de estado: duas entregas
  // simultâneas ativam uma vez só (SEC-12 d) e uma queda no meio não deixa "pago sem plano".
  private async applySubscriptionPayment(payment: SubscriptionPayment, remote: ProviderPayment): Promise<WebhookOutcome> {
    if (!this.matchesLocal(remote, payment.amountCents, payment.id)) {
      return "MISMATCH";
    }
    const mapped = mapMpStatus(remote.status);
    if (!mapped) return "UNKNOWN_STATUS";
    if (mapped === payment.status) return "NOOP";
    if (!canMovePayment(payment.status, mapped)) return "REGRESSION_IGNORED";

    const activated = await this.db.$transaction(async (tx) => {
      const moved = await tx.subscriptionPayment.updateMany({ where: { id: payment.id, status: { in: originsFor(mapped) } }, data: { status: mapped } });
      if (moved.count !== 1) return null;
      if (mapped === "APROVADO") {
        // Serializa ativações da mesma assinatura (dois pagamentos distintos em paralelo): cada uma lê o período já renovado.
        await tx.$queryRaw`SELECT "id" FROM "Subscription" WHERE "id" = ${payment.subscriptionId} FOR UPDATE`;
        await activateSubscription({ subscriptionId: payment.subscriptionId, planCode: payment.planCode }, tx);
      }
      return mapped;
    });
    return activated ? { applied: activated } : "NOOP";
  }
}
