import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { createOrderSchema, quoteOrderSchema } from "@meucardapio/shared-types";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../lib/order-code";
import { publishToStore } from "../realtime/hub";
import { gatewayForStore } from "../modules/storePayments/gateway";
import { PixUnavailableError } from "../modules/storePayments/storePayments.service";
import { orderService } from "../modules/orders/orders.module";
import { enqueueOrderTicket } from "../modules/printJobs/printJobs.queue";
import { customerMessageFor, messageActorFor, moneyLineFor } from "../lib/cancelMessages";
import { DomainError, useDomainErrors } from "../shared/errors";
import { toOrderPaymentMethod } from "../lib/paymentMethod";
import { buildMenuView } from "../lib/menuView";
import { limited, tooMany } from "../lib/slidingLimit";
import { CAPTCHA_HEADER, captchaVerifier } from "../lib/captcha";
import { clientIpOf } from "../lib/clientIp";
import { clientKey } from "../lib/clientKey";
import { newOrderToken, orderTokenMatches, ORDER_TOKEN_HEADER } from "../lib/orderToken";
import { optionCopiesCreate, orderItemExtras } from "../lib/orderItems";
import { COUPON_EXHAUSTED_MESSAGE, priceItems, totalsFor } from "../lib/orderQuote";

class CouponExhaustedError extends Error {}

// Rotas públicas do cardápio (sem autenticação) — equivalente ao /online/{slug} do original.
// NG-08: tetos do pedido público (por loja e por telefone); ver o comentário no uso.
export const PUBLIC_ORDERS_PER_STORE_PER_MINUTE = 60;
export const PUBLIC_QUOTES_WITH_COUPON_PER_IP_PER_MINUTE = 20; // cotação COM cupom: teto mais apertado (não vira jeito barato de testar códigos de cupom)
export const PUBLIC_QUOTES_PER_IP_PER_MINUTE = 120; // PR-06: a cotação não grava nada, mas consulta o banco: teto por IP (a cada mudança do carrinho)
export const MAX_PENDING_PER_PHONE = 3;
export const CAPTCHA_AT_PENDING = 2; // com captcha ligado, a partir do 2º pedido pendente do telefone
const PENDING_WINDOW_MS = 30 * 60 * 1000;

const storefrontRoutes: FastifyPluginAsync = async (app) => {
  useDomainErrors(app);
  // PR-06 (b1): COTAÇÃO do cardápio. Mesma entrada do pedido (sem dados pessoais) e a MESMA conta da criação (`lib/orderQuote.ts`), SEM efeito: não grava, não reserva
  // cupom, não usa captcha. Preço esperado (`expected*`) é ignorado aqui: divergência só dá 409 na CRIAÇÃO. Item que não pode ser pedido vem marcado, não derruba a cotação.
  app.post("/stores/:slug/quote", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (limited(`public-quote:${clientKey(clientIpOf(request))}`, PUBLIC_QUOTES_PER_IP_PER_MINUTE)) return tooMany(reply);
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    const parsed = quoteOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "Corpo inválido.", code: "VALIDATION_ERROR", fields: parsed.error.flatten().fieldErrors });
    const input = parsed.data;
    if (input.couponCode && limited(`public-quote-coupon:${clientKey(clientIpOf(request))}`, PUBLIC_QUOTES_WITH_COUPON_PER_IP_PER_MINUTE)) return tooMany(reply);
    if (input.type === "MESA") return reply.code(400).send({ error: "Pedido de mesa só é feito pelo QR da mesa.", code: "TABLE_REQUIRED" });
    if (input.type === "DELIVERY" && !store.deliveryEnabled) return reply.code(409).send({ error: "Esta loja não está fazendo entregas no momento.", code: "DELIVERY_DISABLED" });
    if (input.type === "BALCAO" && !store.pickupEnabled) return reply.code(409).send({ error: "Esta loja não está aceitando retirada no momento.", code: "PICKUP_DISABLED" });

    const now = new Date();
    // Cada item é precificado SOZINHO: um item indisponível vem com `available:false` e o motivo, e fica fora do total (a tela mostra e o cliente decide).
    const items: Array<Record<string, unknown>> = [];
    const lines = [];
    for (const [index, item] of input.items.entries()) {
      const one = await priceItems(store, [{ ...item, expectedUnitPriceCents: undefined }], now);
      if (!one.ok) {
        items.push({ index, productId: item.productId, available: false, code: one.body.code ?? "ITEM_UNAVAILABLE", error: one.body.error });
        continue;
      }
      const line = one.lines[0];
      lines.push(line);
      items.push({ index, productId: line.productId, available: true, quantity: line.quantity, unitPriceCents: line.unitPriceCents, lineTotalCents: line.lineTotalCents, listPriceCents: line.listPriceCents, weightGrams: line.weightGrams });
    }
    if (lines.length === 0) return reply.send({ quote: { items, subtotalCents: 0, discountCents: 0, deliveryFeeCents: 0, tipCents: 0, totalCents: 0, couponApplied: false, hasUnavailable: items.length > 0 } });
    const totals = await totalsFor(store, lines, { ...input, expectedDeliveryFeeCents: undefined }, now);
    if (!totals.ok) return reply.code(totals.status).send(totals.body);
    return {
      quote: {
        items,
        subtotalCents: totals.subtotalCents,
        discountCents: totals.discountCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        tipCents: totals.tipCents,
        totalCents: totals.totalCents,
        couponApplied: totals.coupon !== null,
        hasUnavailable: items.some((i) => i.available === false),
      },
    };
  });

  app.get("/stores/:slug/menu", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });

    return buildMenuView(store);
  });

  app.post(
    "/stores/:slug/orders",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    if (store.platformSuspendedAt) {
      return reply.code(409).send({ error: "A loja não está aceitando pedidos no momento.", code: "STORE_SUSPENDED" });
    }
    if (!store.acceptingOrders) {
      return reply.code(409).send({ error: "A loja não está aceitando pedidos no momento.", code: "STORE_CLOSED" });
    }

    const parsed = createOrderSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;

    // NG-08 (B19): anti-abuso do pedido público. Cada pedido pode imprimir um tíquete (papel físico) assim que chega, então o limite por IP (acima) não basta:
    // quem troca de IP (rede móvel, VPN) inundaria a cozinha. Dois tetos a mais, ANTES de qualquer escrita: (1) por LOJA, somando todos os IPs; (2) por TELEFONE,
    // pedidos ainda PENDENTES (não aceitos) na última meia hora. Cliente real raramente tem 3 pedidos não aceitos de uma vez. A recusa é o 429 padrão (sem dizer qual teto).
    if (limited(`public-order-store:${store.id}`, PUBLIC_ORDERS_PER_STORE_PER_MINUTE)) return tooMany(reply);
    if (input.customerPhone) {
      const pendingOfPhone = await prisma.order.count({
        where: { storeId: store.id, customerPhone: input.customerPhone, status: "PENDENTE", source: "CLIENTE", createdAt: { gte: new Date(Date.now() - PENDING_WINDOW_MS) } },
      });
      if (pendingOfPhone >= MAX_PENDING_PER_PHONE) return tooMany(reply);
      // Captcha SÓ com risco (NG-08): o 2º pedido pendente do mesmo telefone já pede a prova; cliente normal nunca vê. Provedor desligado (`off`) = nada muda.
      const captcha = captchaVerifier();
      if (captcha.mode !== "off" && pendingOfPhone >= CAPTCHA_AT_PENDING) {
        const header = request.headers[CAPTCHA_HEADER];
        const token = typeof header === "string" && header.length <= 2000 ? header : undefined;
        const ok = await captcha.verify(token, clientKey(clientIpOf(request))).catch(() => false); // erro do provedor = recusa (fail-closed)
        if (!ok) return reply.code(403).send({ error: "Confirme que você não é um robô para continuar.", code: "CAPTCHA_REQUIRED" });
      }
    }

    // Mesa só entra por QR/comanda (API-22). Esta rota genérica não tem mesa: recusa até lá (API-60).
    // MESA não depende de pickupEnabled/deliveryEnabled (loja só de salão é válida).
    if (input.type === "MESA") {
      return reply.code(400).send({ error: "Pedido de mesa só é feito pelo QR da mesa.", code: "TABLE_REQUIRED" });
    }

    // Regras de modalidade no servidor (B09): a interface esconde, mas quem decide é a API.
    if (input.type === "DELIVERY") {
      if (!store.deliveryEnabled) {
        return reply.code(409).send({ error: "Esta loja não está fazendo entregas no momento.", code: "DELIVERY_DISABLED" });
      }
      if (!input.address?.trim()) {
        return reply.code(400).send({ error: "Informe o endereço de entrega.", code: "ADDRESS_REQUIRED" });
      }
      if (!input.customerPhone) {
        return reply.code(400).send({ error: "Informe um telefone para contato da entrega.", code: "PHONE_REQUIRED" });
      }
    }
    if (input.type === "BALCAO" && !store.pickupEnabled) {
      return reply.code(409).send({ error: "Esta loja não está aceitando retirada no momento.", code: "PICKUP_DISABLED" });
    }

    // PR-06: a conta do pedido (produtos, preço de cada linha, mínimo, cupom, taxa, gorjeta e total) é a MESMA da cotação (`POST /stores/:slug/quote`): `lib/orderQuote.ts`.
    const orderNow = new Date();
    const priced = await priceItems(store, input.items, orderNow);
    if (!priced.ok) return reply.code(priced.status).send(priced.body);
    const itemsData = priced.lines;
    const totals = await totalsFor(store, itemsData, input, orderNow);
    if (!totals.ok) return reply.code(totals.status).send(totals.body);
    const { subtotalCents, discountCents, deliveryFeeCents, tipCents, totalCents, coupon, zoneSnapshot } = totals;

    // Total ZERO (cupom cobriu todos os itens e não há taxa nem gorjeta): pedido normal, SEM cobrança. A forma de pagamento
    // informada (inclusive PIX e "troco para") é IGNORADA, não existe PIX de R$ 0,00 e o provedor nunca é chamado (RN-CP-10/11).
    const zeroTotal = totalCents === 0;
    const paymentMethod = zeroTotal ? null : toOrderPaymentMethod(input.paymentMethod);
    if (!zeroTotal && input.changeForCents !== undefined) {
      if (paymentMethod !== "DINHEIRO") {
        return reply.code(400).send({ error: "troco só se aplica a pagamento em dinheiro" });
      }
      if (input.changeForCents < totalCents) {
        return reply.code(400).send({ error: "o valor para troco deve cobrir o total do pedido" });
      }
    }
    const usePix = paymentMethod === "PIX";
    // NG-16: o cliente recebe este token UMA vez; só o hash vai ao banco.
    const accessToken = newOrderToken();

    // Código e pedido na MESMA transação: o contador da loja fica travado até o commit, então
    // pedidos simultâneos são serializados e nunca colidem (B01).
    let ticketQueued = false;
    let order;
    try {
      order = await prisma.$transaction(async (tx) => {
      // FUNC-01: o uso do cupom é RESERVADO aqui, na mesma transação do pedido, com UPDATE condicional (usedCount < maxUses).
      // Sem vaga ⇒ 0 linhas ⇒ recusa ANTES de gastar número de pedido; e se qualquer passo seguinte cair, o rollback desfaz
      // pedido e uso juntos (nunca desconto sem contar o uso). A linha do cupom fica travada até o commit: usos simultâneos
      // do mesmo cupom se enfileiram aqui, e só cabem `maxUses` deles.
      if (coupon) {
        const reserved = await tx.$executeRaw`
          UPDATE "Coupon" SET "usedCount" = "usedCount" + 1
           WHERE "id" = ${coupon.id} AND "storeId" = ${store.id} AND "active" = true
             AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
        if (reserved === 0) throw new CouponExhaustedError();
      }
      const code = await nextOrderCode(tx, store.id);
      const created = await tx.order.create({
      data: {
        storeId: store.id,
        code,
        type: input.type,
        customerName: input.customerName?.normalize("NFC"), // NFC na gravação: nome vindo de Apple (NFD) é achado pela busca (QA-28 H3)
        customerPhone: input.customerPhone,
        address: input.address,
        notes: input.notes,
        subtotalCents,
        discountCents,
        deliveryFeeCents,
        deliveryZoneName: zoneSnapshot?.name,
        deliveryEtaMinMinutes: zoneSnapshot?.etaMin,
        deliveryEtaMaxMinutes: zoneSnapshot?.etaMax,
        tipCents,
        totalCents,
        paymentMethod,
        changeForCents: zeroTotal ? undefined : input.changeForCents,
        couponId: coupon?.id,
        awaitingPayment: usePix,
        publicTokenHash: accessToken.hash,
        // PIX: o registro do pagamento nasce na MESMA transação do pedido, com a chave de idempotência, ANTES de
        // falar com o provedor — se algo cair no meio, a cobrança é encontrada (e a conciliação resolve), nunca órfã.
        ...(usePix ? { payment: { create: { amountCents: totalCents, idempotencyKey: randomUUID() } } } : {}),
        statusHistory: { create: { status: "PENDENTE" } },
        items: {
          create: itemsData.map((item) => ({
            productId: item.productId,
            productName: item.productName,
            quantity: item.quantity,
            unitPriceCents: item.unitPriceCents,
            notes: item.notes,
            additionals: {
              create: item.additionals.map((a) => ({ name: a.name, priceCents: a.priceCents })),
            },
            // Cópia da escolha no pedido (RN-B8-07): mudar o cardápio depois não altera pedido antigo. Na MESMA transação do pedido.
            ...optionCopiesCreate(item.optionCopies),
            ...orderItemExtras(item),
          })),
        },
      },
      });
      // Pedido que já entra no kanban (não aguarda PIX): o tíquete nasce NA MESMA transação — nunca pedido sem job.
      if (!usePix) ticketQueued = await enqueueOrderTicket(tx, { id: created.id, storeId: store.id });
      return created;
      }, ORDER_TX_OPTIONS);
    } catch (error) {
      if (error instanceof CouponExhaustedError) return reply.code(400).send({ error: COUPON_EXHAUSTED_MESSAGE, code: "COUPON_EXHAUSTED" });
      throw error;
    }

    if (!usePix) {
      publishToStore(store.id, { type: "order.created", orderId: order.id });
      if (ticketQueued) publishToStore(store.id, { type: "print.available" });
      return reply.code(201).send({ orderId: order.id, code: order.code, token: accessToken.token, totalCents, discountCents });
    }

    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    try {
      // PIX POR LOJA (ADR-0001, API-07): a cobrança sai na conta do Mercado Pago DA LOJA, nunca na da plataforma. O cliente não vê "reconecte".
      const gateway = await gatewayForStore(store.id);
      const pix = await gateway.createPixPayment({
        orderId: order.id,
        amountCents: totalCents,
        description: `Pedido #${order.code} — ${store.name}`,
        payerEmail: `cliente-${order.id}@checkout.meucardapio.local`,
        idempotencyKey: payment.idempotencyKey ?? undefined,
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          paymentAccountId: gateway.accountId,
          providerPaymentId: pix.providerPaymentId,
          pixQrCode: pix.pixQrCode,
          pixQrCodeBase64: pix.pixQrCodeBase64,
          expiresAt: pix.expiresAt,
        },
      });
      return reply.code(201).send({
        orderId: order.id,
        code: order.code,
        token: accessToken.token,
        totalCents,
        discountCents,
        payment: { pixQrCode: pix.pixQrCode, pixQrCodeBase64: pix.pixQrCodeBase64, expiresAt: pix.expiresAt },
      });
    } catch (error) {
      // Conta desconectada entre a conferência do portão e a cobrança: o PIX simplesmente não existe (409), sem pedido solto.
      const unavailable = error instanceof PixUnavailableError;
      app.log.error({ err: error }, "falha ao gerar o pagamento PIX do pedido");
      // O pedido NÃO é apagado (auditoria): vira CANCELADO com motivo e o cupom volta pelo fluxo de cancelamento.
      // Se o provedor chegou a criar a cobrança, o webhook/conciliação a encontra pela referência e estorna.
      await orderService.cancelBySystem(store.id, order.id, "PAGAMENTO_NAO_APROVADO", "SYSTEM").catch((cancelError) => app.log.error({ err: cancelError }, "falha ao cancelar o pedido após erro no PIX"));
      if (unavailable) return reply.code(409).send({ error: "O PIX não está disponível nesta loja no momento.", code: "PIX_UNAVAILABLE" });
      return reply.code(502).send({ error: "não foi possível gerar o pagamento PIX, tente novamente" });
    }
    },
  );

  // Consultado pela tela de checkout enquanto aguarda a confirmação do PIX.
  app.get("/stores/:slug/orders/:orderId/payment-status", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { slug, orderId } = request.params as { slug: string; orderId: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });

    const order = await prisma.order.findFirst({
      where: { id: orderId, storeId: store.id },
      include: { payment: true },
    });
    // NG-16: sem o token certo a resposta é IGUAL à de pedido inexistente (não confirma que o pedido existe).
    if (!order || !orderTokenMatches(request.headers[ORDER_TOKEN_HEADER], order.publicTokenHash)) {
      return reply.code(404).send({ error: "pedido não encontrado" });
    }

    // `terminal`: o polling do checkout para (pedido cancelado ou pagamento em estado final).
    const paymentStatus = order.payment?.status ?? null;
    const terminal =
      order.status === "CANCELADO" ||
      (paymentStatus !== null && ["APROVADO", "REJEITADO", "EXPIRADO", "CANCELADO", "REEMBOLSADO", "CONTESTADO"].includes(paymentStatus));
    const cancelRow =
      order.status === "CANCELADO"
        ? await prisma.orderStatusHistory.findFirst({ where: { orderId: order.id, kind: "CANCEL" }, orderBy: { seq: "desc" } })
        : null;
    return {
      awaitingPayment: order.awaitingPayment,
      paymentStatus,
      orderStatus: order.status,
      terminal,
      // Mesma fonte do painel: frase fixa por (motivo, ator) + linha de dinheiro calculada agora (sem prazo).
      cancelReason: cancelRow
        ? {
            customerMessage: customerMessageFor(cancelRow.reasonCode, messageActorFor(cancelRow.source)),
            moneyLine: moneyLineFor(order.payment, cancelRow.reasonCode),
          }
        : null,
    };
  });

  // API-19 — link público de ACOMPANHAMENTO do pedido (B13a). Sem login: quem tem o token do pedido (cabeçalho `x-order-token`, nunca na URL)
  // vê onde o pedido está. Resposta SÓ com o que o cliente já sabe e precisa: código, tipo, etapa atual, horários das etapas, nome da loja e,
  // se cancelado, a frase fixa e a linha do dinheiro. NUNCA telefone, endereço, e-mail, observações, ids internos nem dado de pagamento do provedor.
  // Sem token certo: o MESMO 404 de pedido inexistente (não revela que o pedido existe). Não indexável, sem Referer, sem cache.
  app.get("/stores/:slug/orders/:orderId/tracking", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request, reply) => {
    reply.header("Cache-Control", "no-store").header("X-Robots-Tag", "noindex, nofollow").header("Referrer-Policy", "no-referrer");
    const { slug, orderId } = request.params as { slug: string; orderId: string };
    const store = await prisma.store.findUnique({ where: { slug }, select: { id: true, name: true } });
    const order = store
      ? await prisma.order.findFirst({ where: { id: orderId, storeId: store.id }, include: { payment: { select: { status: true, amountCents: true, refundAbandonedAt: true } } } })
      : null;
    if (!store || !order || !orderTokenMatches(request.headers[ORDER_TOKEN_HEADER], order.publicTokenHash)) {
      return reply.code(404).send({ error: "pedido não encontrado" });
    }
    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id, kind: { in: ["ADVANCE", "CANCEL"] } },
      orderBy: { seq: "asc" },
      select: { status: true, createdAt: true, kind: true, reasonCode: true, source: true },
    });
    const cancelRow = order.status === "CANCELADO" ? [...history].reverse().find((h) => h.kind === "CANCEL") : undefined;
    return {
      store: { name: store.name },
      order: { code: order.code, type: order.type, status: order.status, createdAt: order.createdAt.toISOString(), awaitingPayment: order.awaitingPayment },
      timeline: history.map((h) => ({ status: h.status, at: h.createdAt.toISOString() })),
      cancelReason: cancelRow
        ? { customerMessage: customerMessageFor(cancelRow.reasonCode, messageActorFor(cancelRow.source)), moneyLine: moneyLineFor(order.payment, cancelRow.reasonCode) }
        : null,
    };
  });

  // Cliente só cancela enquanto a loja não aceitou (PENDENTE); vence quem chegar primeiro.
  // Com PIX já aprovado, o estorno roda automaticamente (ADR-0007 §5.3).
  app.post("/stores/:slug/orders/:orderId/cancel", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { slug, orderId } = request.params as { slug: string; orderId: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    // NG-16: o cliente só cancela o PRÓPRIO pedido (token do pedido); falha ⇒ mesmo 404 de pedido inexistente.
    const owned = await prisma.order.findFirst({ where: { id: orderId, storeId: store.id }, select: { publicTokenHash: true } });
    if (!owned || !orderTokenMatches(request.headers[ORDER_TOKEN_HEADER], owned.publicTokenHash)) {
      return reply.code(404).send({ error: "pedido não encontrado" });
    }
    try {
      return await orderService.cancelByCustomer(store.id, orderId);
    } catch (error) {
      if (error instanceof DomainError) {
        return reply.code(error.statusCode).send({ error: error.message, ...(error.code ? { code: error.code } : {}), ...error.extra });
      }
      throw error;
    }
  });
};

export default storefrontRoutes;
