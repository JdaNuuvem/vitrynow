import { type Prisma, type prisma as prismaClient, type Order, type OrderStatus, type Payment } from "@meucardapio/db";
import type { WsServerMessage } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import type { AuditLogger } from "../../shared/audit";
import { cancelPayment, getPayment, refundPayment } from "../../lib/mercadopago";
import { ORDER_TX_OPTIONS } from "../../lib/order-code";
import { cancelPendingTickets, enqueueCancelNoticeIfPrinted, lockPrintMode } from "../printJobs/printJobs.queue";
import { customerMessageFor, messageActorFor, moneyLineFor } from "../../lib/cancelMessages";
import {
  FINAL_STATUSES,
  HUMAN_REASON_CODES,
  SYSTEM_REASON_CODES,
  UNDO_WINDOW_MS,
  allowedTransitions,
  blockedTransitions,
  type BlockedTransition,
  canCancel,
  holdsMoney,
  isAdvanceAllowed,
  type Actor as ActorKind,
  type Role,
} from "../../lib/orderStateMachine";
import { toPanelOrder, type ContactAccess } from "./orders.view";
import { authorizeContactView } from "./contactAccess";
import { assertPhoneSearchRate, HISTORY_STAFF_FULL_PHONE_DIGITS, OPEN_ORDER_STATUSES, parseSearch, recordPhoneRefusal, searchOrderHistory, type HistoryQuery } from "./orders.history";
import { closedTodayIds, KANBAN_OLD_OPEN_CAP, KANBAN_TODAY_OPEN_HARD_CAP } from "./orders.kanban";
import { safeTimeZone, startOfStoreDay } from "../../lib/storeTime";

type Db = typeof prismaClient;
type Tx = Prisma.TransactionClient;

// Kanban (RN-KB-01): pedidos em andamento; teto de segurança para não devolver a loja inteira se algo ficar preso.
const OPEN_STATUSES: OrderStatus[] = [...OPEN_ORDER_STATUSES];
export const INTERNAL_NOTE_MAX = 500;

export type PanelActor = { storeId: string; userId: string; role: Role };
// Sem campo editável ao cliente (GRW-15): o texto que o cliente vê é derivado de (código, ator) em lib/cancelMessages.
export type CancelReason = { code: string; text?: string };
export type RefundOutcome = "NONE" | "DONE" | "PENDING";
export const ABANDON_CODES = ["MP_RECUSA", "PAGAMENTO_ANTIGO", "CONTA_DESCONECTADA", "ACERTADO_COM_CLIENTE", "OUTRO"] as const;
export type AbandonCode = (typeof ABANDON_CODES)[number];

// Quem origina o cancelamento (persistido em Payment.refundContext para concluir depois do estorno).
type CancelOrigin = {
  source: "PANEL" | "CUSTOMER" | "SYSTEM" | "WEBHOOK";
  userId: string | null;
  actor: ActorKind;
  reason: CancelReason;
  // Preenchido quando o PROVEDOR já devolveu o dinheiro mas a Tx 2 (cancelar o pedido) ainda não concluiu: a retentativa
  // não chama o provedor de novo, só refaz a Tx 2 (estorno chamado UMA só vez).
  providerRefundedAt?: string;
  // Expiração do PIX (API-06): se o pagamento aparecer APROVADO (webhook que chegou no meio), NÃO cancela nem estorna: o pedido segue pago.
  skipIfPaid?: boolean;
};

// Teto de tentativas AUTOMÁTICAS de estorno (o job de conciliação da API-06 para aqui; o "Tentar estorno" manual do dono segue valendo).
// Ao atingir o teto o alerta é emitido UMA vez (auditoria + log), para a loja e a operação resolverem com o Mercado Pago.
export const MAX_REFUND_AUTO_ATTEMPTS = 5;
export const refundAutoRetryable = (payment: { refundAttempts: number }) => payment.refundAttempts < MAX_REFUND_AUTO_ATTEMPTS;

// Código do erro do provedor para o log (diagnóstico do CL-13 e da conciliação): SÓ status HTTP e código de causa, em lista
// restrita de caracteres. Nunca a mensagem, a descrição nem o corpo (podem trazer dado do pagador ou do pedido).
export function providerErrorCode(error: unknown): string {
  const safe = (v: unknown) => (typeof v === "string" || typeof v === "number") && /^[A-Za-z0-9_.-]{1,30}$/.test(String(v)) ? String(v) : "?";
  const e = (error ?? {}) as { status?: unknown; statusCode?: unknown; cause?: unknown };
  const cause = Array.isArray(e.cause) ? (e.cause[0] as { code?: unknown } | undefined) : (e.cause as { code?: unknown } | undefined);
  return `status=${safe(e.status ?? e.statusCode)} code=${safe(cause?.code)}`;
}

type OrderWithPayment = Order & { payment: Payment | null };
type PanelOrderSource = import("./orders.view").PanelOrderSource;
type HistoryRow = {
  status: OrderStatus;
  kind: string;
  source: string;
  userId: string | null;
  createdAt: Date;
  reasonCode: string | null;
  reasonText: string | null;
  customerMessage: string | null;
};

const err = (status: number, code: string, message: string) => new CodedError(status, code, message);
const STATE_CHANGED = () => err(409, "ORDER_STATE_CHANGED", "O pedido mudou enquanto você agia. Atualize a tela.");

// Regras do pedido (ADR-0007 + contrato b3). O servidor é a única fonte das transições: toda
// mudança é um UPDATE condicional (`WHERE status = :esperado`); contagem 0 ⇒ outro agente
// (cliente, outro usuário, webhook) chegou antes. Efeitos colaterais só depois de a transição vencer.
export class OrderService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLogger,
    private readonly publish: (storeId: string, message: WsServerMessage) => void,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // Toda transação do pedido usa as mesmas opções (espera e duração folgadas): a fila por lock conta no relógio da
  // transação e, com o padrão de 5 s, estourava sob carga virando 500 em fluxo de dinheiro.
  private runTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(fn, ORDER_TX_OPTIONS);
  }

  // ───────────── Leitura (kanban) ─────────────
  // RN-KB-01..05: pedidos em aberto, de qualquer data, mais os concluídos/cancelados DO DIA (fuso da loja). Todo aberto de HOJE
  // entra sempre; os abertos de dias anteriores têm teto (KANBAN_OLD_OPEN_CAP, os mais antigos primeiro) e o que passar dele
  // vem em `openHidden` com `openCapped` (o painel avisa e leva ao Histórico › Em aberto). Só os encerrados do dia são
  // paginados, por cursor (instante do encerramento, mais recente primeiro). PIX ainda não pago fica de fora (RN-KB-07).
  async list(actor: PanelActor, query: { cursor?: string; limit?: number }) {
    const limit = Math.min(Math.max(query.limit || 100, 1), 200);
    const store = await this.db.store.findUnique({ where: { id: actor.storeId }, select: { timezone: true } });
    const timezone = safeTimeZone(store?.timezone);
    const now = this.now();
    const todayStart = startOfStoreDay(now, timezone, 0);
    const include = { items: true, deliverer: true, payment: true, statusHistory: { orderBy: { seq: "desc" as const }, take: 3 } };
    const openWhere = { storeId: actor.storeId, awaitingPayment: false, status: { in: OPEN_STATUSES } };

    const [older, today] = await Promise.all([
      query.cursor ? [] : this.db.order.findMany({ where: { ...openWhere, createdAt: { lt: todayStart } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include, take: KANBAN_OLD_OPEN_CAP }),
      query.cursor ? [] : this.db.order.findMany({ where: { ...openWhere, createdAt: { gte: todayStart } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include, take: KANBAN_TODAY_OPEN_HARD_CAP }),
    ]);
    // Só conta no banco quando bateu no teto (o caso comum não paga a consulta extra).
    let openHidden = 0;
    if (older.length >= KANBAN_OLD_OPEN_CAP) openHidden += Math.max(0, (await this.db.order.count({ where: { ...openWhere, createdAt: { lt: todayStart } } })) - older.length);
    if (today.length >= KANBAN_TODAY_OPEN_HARD_CAP) openHidden += Math.max(0, (await this.db.order.count({ where: { ...openWhere, createdAt: { gte: todayStart } } })) - today.length);
    const open = [...older, ...today];

    const page = await closedTodayIds(this.db, actor.storeId, todayStart, limit, query.cursor);
    const found = page.ids.length ? await this.db.order.findMany({ where: { id: { in: page.ids }, storeId: actor.storeId }, include }) : [];
    const byId = new Map(found.map((o) => [o.id, o]));
    const closed = page.ids.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);

    const orders = [...open, ...closed];
    const roles = await this.rolesOf(orders.flatMap((o) => o.statusHistory.map((h) => h.userId)));
    const decorate = ({ statusHistory, ...order }: (typeof orders)[number]) => this.decorate(order, statusHistory, actor.role, roles);
    const decoratedOpen = open.map(decorate);
    // Dentro de cada coluna, quem espera há mais tempo no estado fica no topo (RN-KB-04); a tela agrupa por status.
    decoratedOpen.sort((a, b) => a.statusChangedAt.getTime() - b.statusChangedAt.getTime());
    return {
      orders: [...decoratedOpen, ...closed.map(decorate)],
      nextCursor: page.nextCursor,
      serverNow: now,
      timezone,
      // Início do "hoje" da loja: pedido aberto criado ANTES disto leva o selo "de ontem" (RN-KB-03).
      todayStartsAt: todayStart,
      openCount: open.length,
      staleOpenCount: open.filter((o) => o.createdAt < todayStart).length,
      openCapped: openHidden > 0,
      openHidden,
    };
  }

  // Histórico (RN-HP): busca e filtros por período; só linhas de lista (telefone mascarado, sem endereço).
  async history(actor: PanelActor, query: HistoryQuery) {
    const store = await this.db.store.findUnique({ where: { id: actor.storeId }, select: { timezone: true } });
    // Busca por telefone do STAFF é um "este número é cliente?": 10 por hora e rastro ESTRITO (gravado antes de responder; se
    // não gravar, não responde: falha fechada como o contato completo). Nunca os dígitos, só o tamanho do termo.
    const search = parseSearch(query.q, actor.role);
    let skipPhone = false;
    if (search?.phone && actor.role !== "OWNER") {
      try {
        assertPhoneSearchRate(actor.userId, this.now().getTime());
      } catch (error) {
        // A recusa deixa rastro (só contagem, nunca os dígitos), mas só a 1ª da hora e nas marcas 10/100/1000: o dono vê o padrão sem ruído.
        const refusals = recordPhoneRefusal(actor.userId, this.now().getTime());
        if (refusals !== null) this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "order.history_phone_search_blocked", targetType: "Store", targetId: actor.storeId, metadata: { termLength: search.phone.length, refusals } });
        // Termo só de dígitos que cabe num CÓDIGO de pedido (< 10 dígitos): não leva 429, cai para código e nome (sem o telefone, sem oráculo).
        if (search.code !== null && search.phone.length < HISTORY_STAFF_FULL_PHONE_DIGITS) skipPhone = true;
        else throw error;
      }
      if (!skipPhone) {
        try {
          await this.audit.logStrict({ storeId: actor.storeId, userId: actor.userId, action: "order.history_phone_search", targetType: "Store", targetId: actor.storeId, metadata: { termLength: search.phone.length } });
        } catch (error) {
          // A causa vai em `cause` e a rota a registra pelo serializador seguro do log (nunca console.error com o erro bruto).
          throw Object.assign(err(503, "AUDIT_UNAVAILABLE", "Busca por telefone indisponível agora. Busque pelo código ou pelo nome, ou tente de novo em instantes."), { cause: error });
        }
      }
    }
    return searchOrderHistory(this.db, actor.storeId, store?.timezone ?? "America/Sao_Paulo", this.now(), query, actor.role, { skipPhone });
  }

  // Observação interna do pedido (API-54): texto livre da equipe, nunca ao cliente nem ao tíquete. A auditoria registra
  // QUE mudou e o tamanho, nunca o texto (pode ter dado pessoal). SQL direto de propósito: anotar não é atividade do pedido e
  // não pode mexer em `updatedAt` (que o kanban e os relatórios leem; QA-28 H1).
  async setInternalNote(actor: PanelActor, orderId: string, note: string | null) {
    const text = note === null ? null : note.trim() || null;
    if (text && text.length > INTERNAL_NOTE_MAX) throw err(400, "NOTE_TOO_LONG", `A observação pode ter até ${INTERNAL_NOTE_MAX} caracteres.`);
    const updated = await this.db.$executeRaw`UPDATE "Order" SET "internalNote" = ${text} WHERE "id" = ${orderId} AND "storeId" = ${actor.storeId}`;
    if (updated !== 1) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "order.internal_note", targetType: "Order", targetId: orderId, metadata: { length: text?.length ?? 0 } });
    return { internalNote: text };
  }

  async get(actor: PanelActor, orderId: string) {
    const order = await this.db.order.findFirst({
      where: { id: orderId, storeId: actor.storeId },
      include: { items: true, deliverer: true, payment: true, statusHistory: { orderBy: { seq: "desc" }, take: 3 } },
    });
    if (!order) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    const { statusHistory, ...rest } = order;
    const roles = await this.rolesOf(statusHistory.map((h) => h.userId));
    return this.decorate(rest, statusHistory, actor.role, roles);
  }

  // Detalhe do pedido (PRD-15): contato completo conforme papel e idade; a abertura com dado completo é auditada
  // (`order.view_contact`, sem o dado na linha), uma vez por usuário+pedido a cada 10 min.
  async detail(actor: PanelActor, orderId: string) {
    const order = await this.db.order.findFirst({
      where: { id: orderId, storeId: actor.storeId },
      include: { items: true, deliverer: true, payment: true, statusHistory: { orderBy: { seq: "desc" }, take: 3 } },
    });
    if (!order) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    const { statusHistory, ...rest } = order;
    const roles = await this.rolesOf(statusHistory.map((h) => h.userId));
    const closedAt = statusHistory[0]?.createdAt ?? null;
    // Contato completo só depois de o rastro estar gravado (falha fechada; ver contactAccess.ts).
    const decision = await authorizeContactView({ db: this.db, audit: this.audit, now: this.now }, actor, order, closedAt);
    return this.decorate(rest, statusHistory, actor.role, roles, { detail: true, access: decision.access, contactUnavailable: decision.unavailable });
  }

  private async rolesOf(userIds: (string | null)[]) {
    const ids = [...new Set(userIds.filter((u): u is string => !!u))];
    if (ids.length === 0) return new Map<string, string>();
    const users = await this.db.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } });
    return new Map(users.map((u) => [u.id, u.role as string]));
  }

  // Monta a resposta do painel por ALLOWLIST (orders.view.ts): nunca espalha a linha do Prisma.
  private decorate(
    order: PanelOrderSource,
    history: HistoryRow[],
    role: Role,
    roles: Map<string, string>,
    opts: { detail: boolean; access: ContactAccess; contactUnavailable?: "AUDIT_UNAVAILABLE" | null } = { detail: false, access: "MASKED" },
  ) {
    const last = history[0];
    const undo = this.undoInfo(order, history, role);
    const cancelRow = order.status === "CANCELADO" && last?.kind === "CANCEL" ? last : null;
    return toPanelOrder(
      order,
      {
        statusChangedAt: last?.createdAt ?? order.createdAt,
        serverNow: this.now(),
        allowedTransitions: allowedTransitions(order, role),
        blocked: [...blockedTransitions(order, role), ...this.undoBlocked(order, history, role)],
        canUndo: undo.canUndo,
        undoUntil: undo.until?.toISOString() ?? null,
        cancel: cancelRow && {
          reasonCode: cancelRow.reasonCode,
          reasonText: cancelRow.reasonText,
          // Frase fixa por (motivo, ator): texto livre nunca chega ao cliente. A linha de dinheiro é calculada agora.
          customerMessage: customerMessageFor(cancelRow.reasonCode, messageActorFor(cancelRow.source as "PANEL" | "CUSTOMER" | "SYSTEM" | "WEBHOOK")),
          moneyLine: moneyLineFor(order.payment, cancelRow.reasonCode),
          at: cancelRow.createdAt.toISOString(),
          by: cancelRow.source === "CUSTOMER" ? "CUSTOMER" : cancelRow.source === "PANEL" ? (roles.get(cancelRow.userId ?? "") ?? "OWNER") : "SYSTEM",
        },
      },
      opts,
    );
  }

  // Desfazer só vale para a última ação "para frente" (kind ADVANCE) e nunca depois de um desfazer.
  private undoInfo(order: OrderWithPayment, history: HistoryRow[], role: Role): { canUndo: boolean; until: Date | null } {
    const [last, prev] = history;
    if (!last || !prev || FINAL_STATUSES.includes(order.status) || last.kind !== "ADVANCE" || last.status !== order.status) {
      return { canUndo: false, until: null };
    }
    if (order.payment?.status === "ESTORNO_PENDENTE") return { canUndo: false, until: null };
    if (role === "OWNER") return { canUndo: true, until: null };
    const deadline = new Date(last.createdAt.getTime() + UNDO_WINDOW_MS);
    const open = this.now() <= deadline;
    return { canUndo: open, until: open ? deadline : null };
  }

  // Desfazer existe (última ação "para frente") mas não está disponível para este usuário.
  private undoBlocked(order: OrderWithPayment, history: HistoryRow[], role: Role): BlockedTransition[] {
    const [last, prev] = history;
    if (!last || !prev || FINAL_STATUSES.includes(order.status) || last.kind !== "ADVANCE" || last.status !== order.status) return [];
    if (order.payment?.status === "ESTORNO_PENDENTE") return [{ to: prev.status, kind: "UNDO", reason: "REFUND_PENDING" }];
    if (role !== "OWNER" && this.now().getTime() - last.createdAt.getTime() > UNDO_WINDOW_MS) {
      return [{ to: prev.status, kind: "UNDO", reason: "UNDO_WINDOW_EXPIRED" }];
    }
    return [];
  }

  // ───────────── Avançar ─────────────
  async transition(actor: PanelActor, orderId: string, to: OrderStatus) {
    const order = await this.load(actor.storeId, orderId);
    if (order.payment?.status === "ESTORNO_PENDENTE") throw err(409, "REFUND_PENDING", "Há um estorno em andamento neste pedido.");
    if (!isAdvanceAllowed(order, to)) throw err(409, "INVALID_TRANSITION", "Esta mudança de status não é permitida.");

    await this.runTx(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: order.id, storeId: actor.storeId, status: order.status, refundLockedAt: null },
        // RN-CX-02(b): pedido pago na entrega/retirada em DINHEIRO só vira dinheiro recebido ao ser CONCLUIDO (quem vence a corrida grava `paidAt`)
        data: { status: to, ...(to === "CONCLUIDO" && order.paymentMethod === "DINHEIRO" && !order.paidAt && order.totalCents > 0 ? { paidAt: this.now() } : {}) },
      });
      if (moved.count !== 1) throw STATE_CHANGED();
      await tx.orderStatusHistory.create({ data: { orderId: order.id, status: to, userId: actor.userId, source: "PANEL", kind: "ADVANCE" } });
    });
    this.publish(actor.storeId, { type: "order.updated", orderId: order.id });
    return this.get(actor, order.id);
  }

  // ───────────── Desfazer ─────────────
  async undo(actor: PanelActor, orderId: string) {
    const order = await this.db.order.findFirst({
      where: { id: orderId, storeId: actor.storeId },
      include: { payment: true, statusHistory: { orderBy: { seq: "desc" }, take: 2 } },
    });
    if (!order) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    if (order.status === "CANCELADO" || order.status === "CONCLUIDO") throw err(409, "INVALID_TRANSITION", "Este pedido não pode ser desfeito.");
    if (order.payment?.status === "ESTORNO_PENDENTE") throw err(409, "REFUND_PENDING", "Há um estorno em andamento neste pedido.");

    const [last, prev] = order.statusHistory;
    if (!last || !prev || last.kind !== "ADVANCE" || last.status !== order.status) throw err(409, "NOTHING_TO_UNDO", "Não há ação para desfazer.");
    if (actor.role !== "OWNER" && this.now().getTime() - last.createdAt.getTime() > UNDO_WINDOW_MS) {
      throw err(409, "UNDO_WINDOW_EXPIRED", "O prazo para desfazer acabou.");
    }

    await this.runTx(async (tx) => {
      const moved = await tx.order.updateMany({
        where: { id: order.id, storeId: actor.storeId, status: order.status, refundLockedAt: null },
        data: { status: prev.status },
      });
      if (moved.count !== 1) throw STATE_CHANGED();
      await tx.orderStatusHistory.create({ data: { orderId: order.id, status: prev.status, userId: actor.userId, source: "PANEL", kind: "UNDO" } });
    });
    this.publish(actor.storeId, { type: "order.updated", orderId: order.id });
    this.audit.log({ storeId: actor.storeId, userId: actor.userId, action: "order.undo", targetType: "Order", targetId: order.id, metadata: { from: order.status, to: prev.status } });
    return this.get(actor, order.id);
  }

  // ───────────── Cancelar ─────────────
  // "Esse cancelamento vai precisar de estorno?" — a rota usa para exigir MFA.
  async needsRefund(storeId: string, orderId: string): Promise<boolean> {
    const order = await this.db.order.findFirst({ where: { id: orderId, storeId }, include: { payment: true } });
    return !!order && holdsMoney(order.payment);
  }

  validateReason(reason: CancelReason | undefined): CancelReason {
    if (!reason?.code) throw err(400, "REASON_REQUIRED", "Informe o motivo do cancelamento.");
    if (!(HUMAN_REASON_CODES as readonly string[]).includes(reason.code)) throw err(400, "REASON_INVALID", "Motivo de cancelamento inválido.");
    const text = reason.text?.trim();
    if (reason.code === "OUTRO" && !text) throw err(400, "REASON_REQUIRED", "Descreva o motivo do cancelamento.");
    // `customerMessage` enviado pelo painel é IGNORADO de propósito: o cliente só vê a frase fixa do motivo.
    return { code: reason.code, text: text || undefined };
  }

  async cancelByPanel(actor: PanelActor, orderId: string, reason: CancelReason | undefined) {
    const valid = this.validateReason(reason);
    const order = await this.load(actor.storeId, orderId);
    if (FINAL_STATUSES.includes(order.status)) throw err(409, "INVALID_TRANSITION", "Este pedido já foi finalizado ou cancelado.");
    if (order.payment?.status === "ESTORNO_PENDENTE") throw err(409, "REFUND_PENDING", "Há um estorno em andamento neste pedido.");
    if (!canCancel(order, actor.role)) throw err(403, "FORBIDDEN_ROLE", "Só o dono da loja pode cancelar este pedido.");
    const refund = await this.cancelOrder(order, { source: "PANEL", userId: actor.userId, actor: actor.role, reason: valid });
    return { order: await this.get(actor, orderId), refund };
  }

  // Cliente (cardápio público): só PENDENTE; vence quem chegar primeiro (RN-B3-03).
  async cancelByCustomer(storeId: string, orderId: string): Promise<{ status: OrderStatus; refund: RefundOutcome }> {
    const order = await this.load(storeId, orderId);
    if (order.status === "CANCELADO") return { status: "CANCELADO", refund: this.refundState(order.payment) };
    if (!canCancel(order, "CUSTOMER")) throw err(409, "ORDER_ALREADY_ACCEPTED", "A loja já aceitou o pedido. Fale com ela.");
    const refund = await this.cancelOrder(order, {
      source: "CUSTOMER",
      userId: null,
      actor: "CUSTOMER",
      reason: { code: "CLIENTE_DESISTIU" },
    });
    return { status: "CANCELADO", refund };
  }

  // Sistema (webhook, expiração): pagamento não aprovado, ou aprovado depois do cancelamento.
  async cancelBySystem(storeId: string, orderId: string, code: (typeof SYSTEM_REASON_CODES)[number], source: "SYSTEM" | "WEBHOOK" = "SYSTEM"): Promise<RefundOutcome> {
    const order = await this.load(storeId, orderId);
    if (FINAL_STATUSES.includes(order.status)) return "NONE";
    return this.cancelOrder(order, {
      source,
      userId: null,
      actor: "SYSTEM",
      reason: { code },
    });
  }

  // Expiração do PIX (job payment.expire): cancela pelo SISTEMA só se o pagamento ainda NÃO foi aprovado; pago dentro do prazo nunca perde o pedido.
  async cancelExpiredPix(storeId: string, orderId: string): Promise<RefundOutcome> {
    const order = await this.load(storeId, orderId);
    if (FINAL_STATUSES.includes(order.status)) return "NONE";
    return this.cancelOrder(order, { source: "SYSTEM", userId: null, actor: "SYSTEM", reason: { code: "PAGAMENTO_NAO_APROVADO" }, skipIfPaid: true });
  }

  private refundState(payment: Payment | null): RefundOutcome {
    if (payment?.status === "REEMBOLSADO") return "DONE";
    if (payment?.status === "ESTORNO_PENDENTE") return "PENDING";
    return "NONE";
  }

  private async cancelOrder(order: OrderWithPayment, origin: CancelOrigin): Promise<RefundOutcome> {
    if (holdsMoney(order.payment)) return origin.skipIfPaid ? "NONE" : this.refundSaga(order, origin);

    const sink = { noticeQueued: false };
    const completed = await this.runTx(async (tx) => {
      await lockPrintMode(tx, order.storeId); // ANTES de qualquer linha de pedido (ordem única de travas: loja → pedido → pagamento)
      return this.applyCancel(tx, order, origin, { expected: order.status, noMoney: true, sink });
    });
    if (!completed) {
      // Perdeu a corrida: ou o pagamento foi aprovado agora (vira saga) ou o status mudou (outro chegou antes).
      const fresh = await this.load(order.storeId, order.id);
      if (fresh.status === "CANCELADO") return this.refundState(fresh.payment);
      if (holdsMoney(fresh.payment) && origin.skipIfPaid) return "NONE"; // a decisão foi tomada no banco (UPDATE condicional), não numa leitura
      if (holdsMoney(fresh.payment) && canCancel(fresh, origin.actor)) return this.refundSaga(fresh, origin);
      if (origin.actor === "CUSTOMER") throw err(409, "ORDER_ALREADY_ACCEPTED", "A loja já aceitou o pedido. Fale com ela.");
      throw STATE_CHANGED();
    }
    await this.afterCancelCommitted(order, origin, sink.noticeQueued);

    // Cobrança que nunca chegou a existir no provedor (falha ao criar o PIX): só fechar o registro local.
    if (order.payment?.status === "PENDENTE" && !order.payment.providerPaymentId) {
      await this.db.payment.updateMany({ where: { id: order.payment.id, status: "PENDENTE", providerPaymentId: null }, data: { status: "CANCELADO" } });
    }
    // Fora da transação: cobrança aberta no MP (melhor esforço; o pedido já está cancelado — RN-B3-02).
    if (order.payment?.status === "PENDENTE" && order.payment.providerPaymentId) {
      try {
        await cancelPayment(order.payment.providerPaymentId);
        await this.db.payment.updateMany({ where: { id: order.payment.id, status: "PENDENTE" }, data: { status: "CANCELADO" } });
      } catch {
        await this.db.payment.updateMany({ where: { id: order.payment.id }, data: { lastRawStatus: "cancel_failed" } });
      }
    }
    return "NONE";
  }

  // UPDATE condicional + histórico + devolução do cupom + libera entregador (ADR-0007 §5.1).
  // Retorna false se outro agente mudou o pedido antes.
  private async applyCancel(
    tx: Tx,
    order: Pick<Order, "id" | "storeId" | "couponId">,
    origin: CancelOrigin,
    // `sink.noticeQueued` avisa quem chamou que um aviso de cancelamento foi criado (publicar print.available DEPOIS do commit).
    opts: { expected: OrderStatus | "ANY_ACTIVE"; noMoney?: boolean; sink?: { noticeQueued: boolean } },
  ): Promise<boolean> {
    const now = this.now();
    const moved = await tx.order.updateMany({
      where: {
        id: order.id,
        storeId: order.storeId,
        status: opts.expected === "ANY_ACTIVE" ? { notIn: [...FINAL_STATUSES] } : opts.expected,
        ...(opts.noMoney ? { refundLockedAt: null, NOT: { payment: { is: { status: { in: ["APROVADO", "ESTORNO_PENDENTE"] } } } } } : {}),
      },
      data: { status: "CANCELADO", canceledAt: now, delivererId: null },
    });
    if (moved.count !== 1) return false;
    await tx.orderStatusHistory.create({
      data: {
        orderId: order.id,
        status: "CANCELADO",
        userId: origin.userId,
        source: origin.source,
        kind: "CANCEL",
        reasonCode: origin.reason.code,
        reasonText: origin.reason.text,
        customerMessage: customerMessageFor(origin.reason.code, messageActorFor(origin.source)),
      },
    });
    // Tíquete que ainda não começou a imprimir não deve sair: a cozinha não recebe pedido cancelado.
    await cancelPendingTickets(tx, { id: order.id, storeId: order.storeId });
    // Se algum tíquete já saiu (ou está saindo), a cozinha precisa do AVISO de cancelamento: criado NA MESMA transação,
    // de modo que ou o pedido cancela COM o aviso ou nada muda (antes ele era criado depois do commit com erro engolido:
    // pedido cancelado, papel na cozinha e nenhum aviso — achado C1 do Deming).
    if (await enqueueCancelNoticeIfPrinted(tx, { id: order.id, storeId: order.storeId }) && opts.sink) opts.sink.noticeQueued = true;
    if (order.couponId) {
      const released = await tx.order.updateMany({ where: { id: order.id, couponReleasedAt: null }, data: { couponReleasedAt: now } });
      if (released.count === 1) {
        await tx.coupon.updateMany({ where: { id: order.couponId, usedCount: { gt: 0 } }, data: { usedCount: { decrement: 1 } } });
      }
    }
    return true;
  }

  private async afterCancelCommitted(order: Pick<Order, "id" | "storeId" | "printedAt">, origin: CancelOrigin, noticeQueued = false) {
    this.publish(order.storeId, { type: "order.updated", orderId: order.id });
    if (noticeQueued) this.publish(order.storeId, { type: "print.available" }); // o aviso já está gravado (mesma transação)
    if (order.printedAt) this.publish(order.storeId, { type: "order.cancel_notice", orderId: order.id });
    this.audit.log({
      storeId: order.storeId,
      userId: origin.userId,
      action: "order.cancel",
      targetType: "Order",
      targetId: order.id,
      metadata: { source: origin.source, reason: origin.reason.code },
    });
  }

  // ───────────── Saga de estorno (ADR-0007 §5.2) ─────────────
  private async refundSaga(order: OrderWithPayment, origin: CancelOrigin): Promise<RefundOutcome> {
    const payment = order.payment;
    if (!payment || !payment.providerPaymentId) throw err(409, "INVALID_TRANSITION", "Pagamento sem identificador no provedor; não é possível estornar.");

    // Tx 1: trava o PEDIDO (na própria linha) + APROVADO → ESTORNO_PENDENTE, na mesma transação.
    // O guard vale para TODOS os atores (C5): se o pedido já é final, nada é tocado (409). Cliente: só PENDENTE.
    // A única exceção é o estorno de pagamento tardio de pedido já CANCELADO (nada a proteger no pedido).
    const context = JSON.parse(JSON.stringify(origin)) as Prisma.InputJsonValue;
    const lateRefund = origin.reason.code === "PAGAMENTO_APOS_CANCELAMENTO";
    await this.runTx(async (tx) => {
      const guard = await tx.order.updateMany({
        where: {
          id: order.id,
          storeId: order.storeId,
          ...(origin.actor === "CUSTOMER" ? { status: "PENDENTE" } : lateRefund ? {} : { status: { notIn: [...FINAL_STATUSES] } }),
        },
        data: { refundLockedAt: this.now() },
      });
      if (guard.count !== 1) {
        if (origin.actor === "CUSTOMER") throw err(409, "ORDER_ALREADY_ACCEPTED", "A loja já aceitou o pedido. Fale com ela.");
        throw err(409, "INVALID_TRANSITION", "Este pedido já foi finalizado ou cancelado.");
      }
      const flipped = await tx.payment.updateMany({
        where: { id: payment.id, status: "APROVADO" },
        data: { status: "ESTORNO_PENDENTE", refundRequestedAt: this.now(), refundContext: context },
      });
      if (flipped.count !== 1) {
        // Já estava em ESTORNO_PENDENTE (nova tentativa): só atualiza o contexto.
        const again = await tx.payment.updateMany({ where: { id: payment.id, status: "ESTORNO_PENDENTE" }, data: { refundContext: context } });
        if (again.count !== 1) throw STATE_CHANGED();
      }
    });
    return this.attemptRefund(payment.id);
  }

  // Tenta (ou retenta) o estorno no MP e, se der certo, conclui o cancelamento. Idempotente.
  async attemptRefund(paymentId: string): Promise<RefundOutcome> {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment) return "NONE";
    if (payment.status !== "ESTORNO_PENDENTE" || !payment.providerPaymentId) return payment.status === "REEMBOLSADO" ? "DONE" : "NONE";
    if (payment.refundAbandonedAt) return "NONE"; // API-61: o dono encerrou o estorno; nada de chamar o provedor de novo
    const order = payment.order;
    const origin = payment.refundContext as unknown as CancelOrigin | null;
    if (!origin) throw err(409, "NOT_REFUND_PENDING", "Estorno sem contexto de cancelamento.");

    if (!origin.providerRefundedAt) {
      if (!(await this.providerRefund(payment.id, payment.providerPaymentId))) {
        await this.noteRefundFailure(payment.id, order, origin, "Não foi possível estornar no Mercado Pago. Tentaremos novamente.");
        this.publish(order.storeId, { type: "payment.refund_pending", orderId: order.id });
        return "PENDING";
      }
      // O dinheiro JÁ voltou: anota antes da Tx 2. Se a anotação falhar, a retentativa chama o provedor de novo com a MESMA
      // chave de idempotência (devolve o mesmo resultado, não estorna duas vezes).
      origin.providerRefundedAt = this.now().toISOString();
      await this.db.payment
        .updateMany({ where: { id: payment.id, status: "ESTORNO_PENDENTE" }, data: { refundContext: JSON.parse(JSON.stringify(origin)) as Prisma.InputJsonValue } })
        .catch((error) => console.error("[estorno] não consegui anotar que o provedor já devolveu:", error));
    }

    // Tx 2: ESTORNO_PENDENTE → REEMBOLSADO + cancelar o pedido (qualquer estado ativo: o dinheiro já voltou).
    // Só quem vence a troca de estado do pagamento conclui (e emite os efeitos): chamadas simultâneas
    // (retry manual + job) terminam todas em "DONE", mas os efeitos rodam uma única vez.
    // Se o pedido NÃO pôde ser cancelado e não está cancelado (ex.: já concluído), o dinheiro voltou mesmo assim:
    // fica marcado para conciliação manual, com alerta — nunca REEMBOLSADO em silêncio.
    const sink = { noticeQueued: false };
    let concluded: { orderCancelled: boolean; reconcile: boolean } | null;
    try {
      concluded = await this.runTx(async (tx) => {
      // Ordem de locks ÚNICA no sistema: loja (modo de impressão) → Pedido → Pagamento (a Tx 1 da saga também começa pelo pedido).
      // Travar o pagamento primeiro aqui criava a ordem inversa e permitia deadlock quando duas tentativas se sobrepõem; e o lock da
      // loja vem ANTES do pedido porque a troca de modo o segura exclusivo e atualiza pedidos/jobs (ciclo ⇒ 40P01).
      await lockPrintMode(tx, order.storeId);
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
      const flipped = await tx.payment.updateMany({
        where: { id: payment.id, status: "ESTORNO_PENDENTE" },
        data: { status: "REEMBOLSADO", refundLastError: null },
      });
      if (flipped.count !== 1) return null;
      const orderCancelled = await this.applyCancel(tx, order, origin, { expected: "ANY_ACTIVE", sink });
      let reconcile = false;
      if (!orderCancelled) {
        const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
        if (current.status !== "CANCELADO") {
          reconcile = true;
          await tx.payment.update({
            where: { id: payment.id },
            data: { reconcileNote: `Estorno feito, mas o pedido já estava ${current.status}. Conferir com o cliente.` },
          });
        }
      }
      return { orderCancelled, reconcile };
      });
    } catch (error) {
      // O dinheiro JÁ voltou no provedor mas a conclusão (cancelar o pedido, aviso de cancelamento...) falhou e foi desfeita
      // por inteiro: o pagamento continua ESTORNO_PENDENTE e o pedido intacto. NUNCA 500 mudo: fica pendente e visível, e o
      // "Tentar estorno" (ou o job de conciliação) refaz SÓ a Tx 2.
      console.error("[estorno] provedor devolveu, mas a conclusão do cancelamento falhou:", error);
      await this.noteRefundFailure(payment.id, order, origin, "O estorno foi feito, mas falta concluir o cancelamento. Tentaremos novamente.");
      this.publish(order.storeId, { type: "payment.refund_pending", orderId: order.id });
      return "PENDING";
    }
    if (concluded) {
      if (concluded.orderCancelled) await this.afterCancelCommitted(order, origin, sink.noticeQueued);
      this.publish(order.storeId, { type: "payment.refund_done", orderId: order.id });
      if (concluded.reconcile) {
        this.publish(order.storeId, { type: "payment.reconcile_needed", orderId: order.id });
        this.audit.log({ storeId: order.storeId, userId: origin.userId, action: "order.refund_reconcile", targetType: "Order", targetId: order.id });
      }
      this.audit.log({ storeId: order.storeId, userId: origin.userId, action: "order.refund", targetType: "Order", targetId: order.id });
    }
    return "DONE";
  }

  // Pede o estorno ao provedor com chave idempotente. Se der erro, consulta o pagamento: "refunded" no
  // provedor significa que o dinheiro JÁ voltou (queda entre o aceite e a nossa gravação) ⇒ sucesso.
  // Conta a tentativa que falhou e grava o texto curto (fixo, sem dado sensível). O UPDATE devolve o valor EXATO do contador,
  // então só UMA tentativa vê "cruzou o teto" (duas simultâneas recebem valores diferentes): o alerta sai uma vez.
  private async noteRefundFailure(paymentId: string, order: { id: string; storeId: string }, origin: CancelOrigin, message: string) {
    const rows = await this.db.$queryRaw<{ refundAttempts: number }[]>`
      UPDATE "Payment" SET "refundAttempts" = "refundAttempts" + 1, "refundLastError" = ${message}
       WHERE "id" = ${paymentId} AND "status" = 'ESTORNO_PENDENTE'
   RETURNING "refundAttempts"`;
    if (rows[0]?.refundAttempts === MAX_REFUND_AUTO_ATTEMPTS) {
      console.error(`[estorno] pagamento ${paymentId} atingiu ${MAX_REFUND_AUTO_ATTEMPTS} tentativas sem concluir: precisa de atenção`);
      this.audit.log({
        storeId: order.storeId,
        userId: origin.userId,
        action: "order.refund_stuck",
        targetType: "Order",
        targetId: order.id,
        metadata: { attempts: MAX_REFUND_AUTO_ATTEMPTS },
      });
    }
  }

  private async providerRefund(paymentId: string, providerPaymentId: string): Promise<boolean> {
    try {
      await refundPayment(providerPaymentId, `refund-${paymentId}`);
      return true;
    } catch (refundError) {
      console.error(`[estorno] provedor recusou o estorno do pagamento ${paymentId}: ${providerErrorCode(refundError)}`);
      try {
        return (await getPayment(providerPaymentId)).status === "refunded";
      } catch (lookupError) {
        console.error(`[estorno] não consegui consultar o pagamento ${paymentId} no provedor: ${providerErrorCode(lookupError)}`);
        return false;
      }
    }
  }

  // Pagamento aprovado DEPOIS de o pedido ter sido cancelado (RN-B3-04): estorno automático, sem anunciar
  // o pedido e sem reabri-lo. Idempotente: só começa se o pagamento ainda está APROVADO.
  async refundAfterCancel(paymentId: string): Promise<RefundOutcome> {
    const payment = await this.db.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.status !== "APROVADO") return payment ? this.refundState(payment) : "NONE";
    const origin: CancelOrigin = {
      source: "WEBHOOK",
      userId: null,
      actor: "SYSTEM",
      reason: { code: "PAGAMENTO_APOS_CANCELAMENTO" },
    };
    return this.refundSaga({ ...payment.order, payment }, origin);
  }

  async retryRefund(actor: PanelActor, orderId: string) {
    const order = await this.load(actor.storeId, orderId);
    if (actor.role !== "OWNER") throw err(403, "FORBIDDEN_ROLE", "Só o dono da loja pode estornar.");
    if (order.payment?.status !== "ESTORNO_PENDENTE") throw err(409, "NOT_REFUND_PENDING", "Este pedido não tem estorno pendente.");
    const refund = await this.attemptRefund(order.payment.id);
    return { order: await this.get(actor, orderId), refund };
  }

  // API-61 (RN-ABD): "Encerrar sem estorno". Só OWNER, só com estorno preso (>= teto de tentativas automáticas). Cancela o pedido e
  // marca o pagamento como encerrado SEM virar REEMBOLSADO (o dinheiro continua como recebido). Auditoria na MESMA transação.
  // Ordem de locks: loja -> pedido -> pagamento. Sem chamada ao provedor. Idempotente (2ª chamada = 200 sem novo registro).
  async abandonRefund(actor: PanelActor, orderId: string, code: AbandonCode, note?: string) {
    if (actor.role !== "OWNER") throw err(403, "FORBIDDEN_ROLE", "Só o dono da loja pode encerrar o estorno.");
    const first = await this.load(actor.storeId, orderId);
    if (!first.payment || (first.payment.status !== "ESTORNO_PENDENTE")) throw err(409, "NOT_REFUND_PENDING", "Este pedido não tem estorno pendente.");
    if (!first.payment.refundAbandonedAt && refundAutoRetryable(first.payment)) {
      throw err(409, "REFUND_STILL_POSSIBLE", "O estorno ainda pode ser concluído. Tente de novo.");
    }
    const origin: CancelOrigin = { source: "PANEL", userId: actor.userId, actor: "OWNER", reason: { code: "ESTORNO_NAO_CONCLUIDO", text: note } };
    const sink = { noticeQueued: false };
    const done = await this.runTx(async (tx) => {
      await lockPrintMode(tx, actor.storeId);
      await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} AND "storeId" = ${actor.storeId} FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { orderId } });
      if (!payment || payment.status !== "ESTORNO_PENDENTE") throw err(409, "NOT_REFUND_PENDING", "Este pedido não tem estorno pendente.");
      if (payment.refundAbandonedAt) return false; // já encerrado: inofensivo
      if (refundAutoRetryable(payment)) throw err(409, "REFUND_STILL_POSSIBLE", "O estorno ainda pode ser concluído. Tente de novo.");
      const closed = await tx.payment.updateMany({
        where: { id: payment.id, status: "ESTORNO_PENDENTE", refundAbandonedAt: null },
        data: { refundAbandonedAt: this.now(), refundAbandonCode: code },
      });
      if (closed.count !== 1) throw STATE_CHANGED();
      const cancelled = await this.applyCancel(tx, first, origin, { expected: "ANY_ACTIVE", sink });
      if (!cancelled) {
        const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
        if (current.status !== "CANCELADO") throw STATE_CHANGED(); // pedido já finalizado de outro jeito: desfaz tudo
      }
      await tx.order.update({ where: { id: orderId }, data: { refundLockedAt: null } });
      await tx.auditLog.create({
        data: {
          storeId: actor.storeId,
          userId: actor.userId,
          action: "order.refund_abandoned",
          targetType: "Order",
          targetId: orderId,
          metadata: { code, amountCents: payment.amountCents },
        },
      });
      return cancelled;
    });
    if (done) await this.afterCancelCommitted(first, origin, sink.noticeQueued);
    return { order: await this.get(actor, orderId) };
  }

  private async load(storeId: string, orderId: string): Promise<OrderWithPayment> {
    const order = await this.db.order.findFirst({ where: { id: orderId, storeId }, include: { payment: true } });
    if (!order) throw err(404, "ORDER_NOT_FOUND", "pedido não encontrado");
    return order;
  }
}
