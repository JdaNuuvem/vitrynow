import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import { createManualOrderSchema } from "@meucardapio/shared-types";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../lib/order-code";
import { toOrderPaymentMethod } from "../lib/paymentMethod";
import { newOrderToken } from "../lib/orderToken";
import { enqueueOrderTicket } from "../modules/printJobs/printJobs.queue";
import { publishToStore } from "../realtime/hub";
import { createHmac } from "node:crypto";
import { getJwtSecret } from "../lib/securityConfig";
import { logAudit } from "../lib/audit";
import { limited, tooMany } from "../lib/slidingLimit";
import { CodedError, useDomainErrors } from "../shared/errors";

// API-13 — pedido lançado no PAINEL (B2). O servidor decide TODO preço (RN-B2-01); o pedido nasce CONFIRMADO (o atendente já o aceitou), com tíquete na MESMA
// transação (nunca pedido sem job) e `source = PAINEL`. Ignora "loja fechada", horário, pedido mínimo e modalidade desligada: a loja decide (RN-B2-04).
// Não cria cobrança no provedor: PIX aqui é "presencial", confirmado à mão (RN-B2-08).
// Cada pedido imprime um tíquete (papel físico): limite por USUÁRIO, não só por IP.
const MANUAL_ORDERS_PER_MINUTE = 60;
// Impressão digital CANÔNICA do corpo (chaves em ordem): mesmo conteúdo = mesma impressão, qualquer que seja a ordem dos campos.
const canonical = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v) ?? "null";
// HMAC com chave derivada do segredo do servidor (LGPD, Nightingale): o corpo tem nome, telefone e endereço do cliente; um SHA-256 puro de telefone se
// reverte por força bruta com o banco na mão. Com o segredo, o valor gravado não é reversível e não liga o pedido a um telefone conhecido.
const bodyHash = (v: unknown) => createHmac("sha256", createHmac("sha256", getJwtSecret()).update("manual-order-body-v1").digest()).update(canonical(v)).digest("hex");
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,100}$/;

function replayOrConflict(reply: FastifyReply, existing: { id: string; code: string; manualBodyHash: string | null }, fingerprint: string) {
  if (existing.manualBodyHash === fingerprint) return reply.code(200).send({ orderId: existing.id, code: existing.code, replay: true });
  return reply.code(409).send({ error: "Este pedido já foi lançado.", code: "IDEMPOTENCY_KEY_REUSED", details: { orderId: existing.id, code: existing.code } });
}

const manualOrderRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);

  app.post("/api/orders", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const { storeId, userId, role } = request.user;
    if (limited(`manual-order:${userId}`, MANUAL_ORDERS_PER_MINUTE)) return tooMany(reply);
    const parsed = createManualOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;

    // RN-B2-10: cada abertura do formulário manda uma chave; duplo clique ou reenvio por rede lenta devolvem o MESMO pedido.
    // CONTRATO: a chave identifica a ABERTURA do formulário. Mesma chave + MESMO corpo = 200 replay (duplo clique); mesma chave + corpo DIFERENTE = 409
    // IDEMPOTENCY_KEY_REUSED com `details.orderId` (o atendente não pode achar que o pedido novo foi lançado quando a cozinha só recebeu o antigo).
    const fingerprint = bodyHash(input);
    const rawKey = request.headers["idempotency-key"];
    const manualKey = typeof rawKey === "string" ? rawKey : undefined;
    if (manualKey !== undefined && !IDEMPOTENCY_KEY.test(manualKey)) {
      return reply.code(400).send({ error: "Idempotency-Key inválida.", code: "IDEMPOTENCY_KEY_INVALID" });
    }
    if (manualKey) {
      const existing = await prisma.order.findUnique({ where: { storeId_manualKey: { storeId, manualKey } }, select: { id: true, code: true, manualBodyHash: true } });
      if (existing) return replayOrConflict(reply, existing, fingerprint);
    }

    if (input.type === "DELIVERY") {
      if (!input.address?.trim()) return reply.code(400).send({ error: "Informe o endereço de entrega.", code: "ADDRESS_REQUIRED" });
      if (!input.customerPhone) return reply.code(400).send({ error: "Informe um telefone para contato da entrega.", code: "PHONE_REQUIRED" });
    }
    if (input.alreadyPaid && !input.paymentMethod) {
      return reply.code(400).send({ error: "Informe a forma de pagamento de um pedido já pago.", code: "PAYMENT_METHOD_REQUIRED" });
    }

    const store = await prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { id: true, deliveryFeeCents: true, manualDiscountStaffLimitPercent: true } });

    // RN-B2-06: desconto manual do STAFF até o limite da loja; acima disso só o OWNER.
    if (input.discount && role !== "OWNER" && input.discount.percent > store.manualDiscountStaffLimitPercent) {
      return reply.code(403).send({ error: "Desconto acima do seu limite. Peça ao dono.", code: "DISCOUNT_ABOVE_LIMIT", limitPercent: store.manualDiscountStaffLimitPercent });
    }
    if (input.forceCoupon && role !== "OWNER") {
      return reply.code(403).send({ error: "Só o dono pode forçar um cupom esgotado.", code: "FORBIDDEN_ROLE" });
    }

    // Produtos SÓ desta loja (CA-B2-10); inativo não entra nem pelo painel (RN-B2-02).
    const products = await prisma.product.findMany({ where: { storeId, id: { in: input.items.map((i) => i.productId) } }, include: { additionals: true } });
    if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
      return reply.code(400).send({ error: "um ou mais produtos não existem nesta loja", code: "PRODUCT_NOT_FOUND" });
    }
    const unavailable = products.filter((p) => !p.active);
    if (unavailable.length > 0) {
      return reply.code(400).send({
        error: `Item indisponível no momento: ${unavailable.map((p) => p.name).join(", ")}.`,
        code: "ITEM_UNAVAILABLE",
        details: { items: unavailable.map((p) => ({ id: p.id, name: p.name })) },
      });
    }
    const productById = new Map(products.map((p) => [p.id, p]));
    let itemsData;
    try {
      itemsData = input.items.map((item) => {
        const product = productById.get(item.productId)!;
        const byId = new Map(product.additionals.map((a) => [a.id, a]));
        const chosen = (item.additionalIds ?? []).map((id) => {
          const additional = byId.get(id);
          if (!additional) throw new Error(`adicional ${id} não pertence ao produto ${product.id}`);
          return additional;
        });
        const extra = chosen.reduce((sum, a) => sum + a.priceCents, 0);
        return { productId: product.id, productName: product.name, quantity: item.quantity, unitPriceCents: product.priceCents, notes: item.notes, lineTotalCents: (product.priceCents + extra) * item.quantity, additionals: chosen };
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "pedido inválido", code: "ADDITIONAL_NOT_FOUND" });
    }
    const subtotalCents = itemsData.reduce((sum, i) => sum + i.lineTotalCents, 0);

    // Cupom: mesma validação do cardápio (validade, limite, mínimo); o OWNER pode forçar um cupom ESGOTADO (RN-B2-05), nunca um inativo ou vencido.
    let coupon = null;
    let couponDiscountCents = 0;
    if (input.couponCode) {
      coupon = await prisma.coupon.findUnique({ where: { storeId_code: { storeId, code: input.couponCode.trim().toUpperCase() } } });
      if (!coupon || !coupon.active) return reply.code(400).send({ error: "cupom inválido", code: "COUPON_INVALID" });
      if (coupon.expiresAt && coupon.expiresAt < new Date()) return reply.code(400).send({ error: "cupom expirado", code: "COUPON_EXPIRED" });
      if (coupon.minOrderCents !== null && subtotalCents < coupon.minOrderCents) {
        return reply.code(400).send({ error: `pedido mínimo para este cupom é R$ ${(coupon.minOrderCents / 100).toFixed(2)}`, code: "COUPON_MIN_ORDER" });
      }
      const exhausted = coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses;
      if (exhausted && !(input.forceCoupon && role === "OWNER")) return reply.code(400).send({ error: "Esse cupom acabou.", code: "COUPON_EXHAUSTED" });
      couponDiscountCents = Math.min(coupon.discountType === "PERCENT" ? Math.round((subtotalCents * coupon.discountValue) / 100) : coupon.discountValue, subtotalCents);
    }
    // Desconto manual em % sobre o que sobrou depois do cupom; o total de desconto nunca passa do subtotal (RN-B2-06).
    const manualDiscountCents = input.discount ? Math.round(((subtotalCents - couponDiscountCents) * input.discount.percent) / 100) : 0;
    const discountCents = Math.min(couponDiscountCents + manualDiscountCents, subtotalCents);

    const deliveryFeeCents = input.type === "DELIVERY" ? store.deliveryFeeCents : 0;
    const tipCents = input.tipCents ?? 0;
    const totalCents = subtotalCents - discountCents + deliveryFeeCents + tipCents;
    const zeroTotal = totalCents === 0;
    const paymentMethod = zeroTotal ? null : toOrderPaymentMethod(input.paymentMethod);
    if (!zeroTotal && input.changeForCents !== undefined) {
      if (paymentMethod !== "DINHEIRO") return reply.code(400).send({ error: "troco só se aplica a pagamento em dinheiro", code: "CHANGE_ONLY_CASH" });
      if (input.changeForCents < totalCents) return reply.code(400).send({ error: "o valor para troco deve cobrir o total do pedido", code: "CHANGE_TOO_LOW" });
    }
    const receivedNow = !!input.alreadyPaid && !zeroTotal;
    const accessToken = newOrderToken();

    let ticketQueued = false;
    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
        // RN-B2-07: dinheiro "já pago" só com caixa ABERTO. FOR SHARE: o fechamento (FOR UPDATE) espera este pedido terminar, e o dinheiro nunca cai num caixa já fechado.
        if (receivedNow && paymentMethod === "DINHEIRO") {
          const open = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "CashSession" WHERE "storeId" = ${storeId} AND "closedAt" IS NULL FOR SHARE`;
          if (open.length === 0) throw new CodedError(409, "CASH_REQUIRED", "Abra o caixa para registrar este pagamento em dinheiro.");
        }
        if (coupon) {
          const forced = input.forceCoupon && role === "OWNER";
          const reserved = forced
            ? await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE "id" = ${coupon.id} AND "storeId" = ${storeId} AND "active" = true`
            : await tx.$executeRaw`UPDATE "Coupon" SET "usedCount" = "usedCount" + 1 WHERE "id" = ${coupon.id} AND "storeId" = ${storeId} AND "active" = true AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
          if (reserved === 0) throw new CodedError(400, "COUPON_EXHAUSTED", "Esse cupom acabou.");
        }
        const code = await nextOrderCode(tx, storeId);
        const created = await tx.order.create({
          data: {
            storeId,
            code,
            type: input.type,
            status: "CONFIRMADO", // o atendente já aceitou ao lançar
            source: "PAINEL",
            channel: input.channel ?? null,
            createdByUserId: userId,
            manualKey: manualKey ?? null,
            manualBodyHash: manualKey ? fingerprint : null,
            customerName: (input.customerName ?? (input.type === "BALCAO" ? `Balcão #${code}` : undefined))?.normalize("NFC"),
            customerPhone: input.customerPhone,
            address: input.address,
            notes: input.notes,
            subtotalCents,
            discountCents,
            deliveryFeeCents,
            tipCents,
            totalCents,
            paymentMethod,
            changeForCents: zeroTotal ? undefined : input.changeForCents,
            couponId: coupon?.id,
            manualDiscountPercent: input.discount?.percent,
            manualDiscountReason: input.discount?.reason,
            awaitingPayment: false,
            paidAt: receivedNow ? new Date() : null, // RN-CX-02(a): "já pago" = recebido agora
            publicTokenHash: accessToken.hash,
            statusHistory: { create: { status: "CONFIRMADO", userId, source: "PANEL", kind: "ADVANCE" } },
            items: {
              create: itemsData.map((item) => ({
                productId: item.productId,
                productName: item.productName,
                quantity: item.quantity,
                unitPriceCents: item.unitPriceCents,
                notes: item.notes,
                additionals: { create: item.additionals.map((a) => ({ name: a.name, priceCents: a.priceCents })) },
              })),
            },
          },
        });
        ticketQueued = await enqueueOrderTicket(tx, { id: created.id, storeId });
        return created;
      }, ORDER_TX_OPTIONS);
    } catch (error) {
      // Duas aberturas com a MESMA chave que chegaram juntas: a unicidade do banco decide, o perdedor recebe o pedido do vencedor.
      if (manualKey && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await prisma.order.findUnique({ where: { storeId_manualKey: { storeId, manualKey } }, select: { id: true, code: true, manualBodyHash: true } });
        if (existing) return replayOrConflict(reply, existing, fingerprint);
      }
      throw error;
    }

    logAudit({
      storeId,
      userId,
      action: "order.manual_create",
      targetType: "Order",
      targetId: order.id,
      metadata: { channel: input.channel ?? null, type: input.type, totalCents, ...(input.discount ? { discountPercent: input.discount.percent, discountReason: input.discount.reason } : {}), ...(input.forceCoupon ? { couponForced: true } : {}), role },
    });
    publishToStore(storeId, { type: "order.created", orderId: order.id });
    if (ticketQueued) publishToStore(storeId, { type: "print.available" });
    return reply.code(201).send({ orderId: order.id, code: order.code, token: accessToken.token });
  });
};

export default manualOrderRoutes;
