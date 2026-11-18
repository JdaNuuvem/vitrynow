import { isSoldOutNow } from "../lib/soldOut";
import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { createOrderSchema } from "@meucardapio/shared-types";
import { applyFreeShipping } from "../lib/deliveryZones";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../lib/order-code";
import { publishToStore } from "../realtime/hub";
import { gatewayForStore } from "../modules/storePayments/gateway";
import { PixUnavailableError } from "../modules/storePayments/storePayments.service";
import { orderService } from "../modules/orders/orders.module";
import { enqueueOrderTicket } from "../modules/printJobs/printJobs.queue";
import { customerMessageFor, messageActorFor, moneyLineFor } from "../lib/cancelMessages";
import { DomainError } from "../shared/errors";
import { toOrderPaymentMethod } from "../lib/paymentMethod";
import { buildMenuView } from "../lib/menuView";
import { newOrderToken, orderTokenMatches, ORDER_TOKEN_HEADER } from "../lib/orderToken";

const COUPON_EXHAUSTED_MESSAGE = "Esse cupom acabou.";
class CouponExhaustedError extends Error {}

// Rotas públicas do cardápio (sem autenticação) — equivalente ao /online/{slug} do original.
const storefrontRoutes: FastifyPluginAsync = async (app) => {
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

    const products = await prisma.product.findMany({
      where: { storeId: store.id, id: { in: input.items.map((i) => i.productId) } },
      include: { additionals: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));
    if (products.length !== new Set(input.items.map((i) => i.productId)).size) {
      return reply.code(400).send({ error: "um ou mais produtos não existem nesta loja" });
    }
    // Produto pausado some do cardápio e não pode ser pedido por chamada direta (B08).
    // API-17: esgotado hoje também é recusado (RN-B11-04), mesmo se escondido ou enviado direto à API.
    const orderNow = new Date();
    const unavailable = products.filter((p) => !p.active || isSoldOutNow(p, orderNow));
    if (unavailable.length > 0) {
      // Mesmo código/forma para B11, QR de mesa e pedido manual (contrato B3 §8, item 3).
      return reply.code(400).send({
        error: `Item indisponível no momento: ${unavailable.map((p) => p.name).join(", ")}.`,
        code: "ITEM_UNAVAILABLE",
        details: { items: unavailable.map((p) => ({ id: p.id, name: p.name })) },
      });
    }

    let itemsData;
    try {
      itemsData = input.items.map((item) => {
        const product = productById.get(item.productId)!;
        const additionalsByProduct = new Map(product.additionals.map((a) => [a.id, a]));
        const chosenAdditionals = (item.additionalIds ?? []).map((id) => {
          const additional = additionalsByProduct.get(id);
          if (!additional) throw new Error(`adicional ${id} não pertence ao produto ${product.id}`);
          return additional;
        });
        const additionalsCents = chosenAdditionals.reduce((sum, a) => sum + a.priceCents, 0);
        return {
          productId: item.productId,
          productName: product.name,
          quantity: item.quantity,
          unitPriceCents: product.priceCents,
          notes: item.notes,
          lineTotalCents: (product.priceCents + additionalsCents) * item.quantity,
          additionals: chosenAdditionals,
        };
      });
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "pedido inválido" });
    }

    const subtotalCents = itemsData.reduce((sum, item) => sum + item.lineTotalCents, 0);

    if (store.minOrderCents !== null && subtotalCents < store.minOrderCents) {
      return reply.code(400).send({ error: `pedido mínimo é R$ ${(store.minOrderCents / 100).toFixed(2)}` });
    }

    let coupon = null;
    let discountCents = 0;
    if (input.couponCode) {
      coupon = await prisma.coupon.findUnique({
        where: { storeId_code: { storeId: store.id, code: input.couponCode.trim().toUpperCase() } },
      });
      if (!coupon || !coupon.active) {
        return reply.code(400).send({ error: "cupom inválido" });
      }
      if (coupon.expiresAt && coupon.expiresAt < new Date()) {
        return reply.code(400).send({ error: "cupom expirado" });
      }
      if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
        return reply.code(400).send({ error: COUPON_EXHAUSTED_MESSAGE, code: "COUPON_EXHAUSTED" });
      }
      if (coupon.minOrderCents !== null && subtotalCents < coupon.minOrderCents) {
        return reply.code(400).send({ error: `pedido mínimo para este cupom é R$ ${(coupon.minOrderCents / 100).toFixed(2)}` });
      }
      discountCents =
        coupon.discountType === "PERCENT"
          ? Math.round((subtotalCents * coupon.discountValue) / 100)
          : coupon.discountValue;
      discountCents = Math.min(discountCents, subtotalCents);
    }

    // API-16 (B9): taxa por bairro, recalculada AQUI (o cliente só informa o bairro e a taxa que viu). Retirada nunca tem taxa.
    let deliveryFeeCents = 0;
    let zoneSnapshot: { name: string; etaMin: number | null; etaMax: number | null } | null = null;
    if (input.type === "DELIVERY") {
      const zoneCount = await prisma.deliveryZone.count({ where: { storeId: store.id } });
      let baseFee = store.deliveryFeeCents; // sem bairros cadastrados: taxa única, como sempre (CA-B9-09)
      let zoneFreeFrom: number | null = null;
      if (zoneCount > 0) {
        const activeZones = () => prisma.deliveryZone.findMany({ where: { storeId: store.id, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, feeCents: true } });
        if (input.neighborhoodId) {
          const zone = await prisma.deliveryZone.findFirst({ where: { id: input.neighborhoodId, storeId: store.id } });
          if (!zone) return reply.code(400).send({ error: "Bairro não atendido por esta loja.", code: "NEIGHBORHOOD_NOT_FOUND" });
          if (!zone.active) {
            // bairro desativado enquanto o cliente montava o pedido: recusa com a lista atual, carrinho mantido
            return reply.code(400).send({ error: "Este bairro não está mais disponível para entrega.", code: "NEIGHBORHOOD_UNAVAILABLE", details: { zones: await activeZones() } });
          }
          baseFee = zone.feeCents;
          zoneFreeFrom = zone.freeFromCents;
          zoneSnapshot = { name: zone.name, etaMin: zone.etaMinMinutes, etaMax: zone.etaMaxMinutes };
        } else if (store.deliveryOutsideMode !== "DEFAULT_FEE") {
          return reply.code(400).send({ error: "Escolha o bairro da entrega.", code: "NEIGHBORHOOD_REQUIRED", details: { zones: await activeZones() } });
        }
      }
      // Frete grátis sobre o subtotal LÍQUIDO (itens menos desconto), RN-B9-05.
      deliveryFeeCents = applyFreeShipping(baseFee, subtotalCents - discountCents, zoneFreeFrom, store.freeShippingFromCents);
    }
    const tipCents = input.tipCents ?? 0;
    const totalCents = subtotalCents - discountCents + deliveryFeeCents + tipCents;
    // RN-B9-03: a taxa mudou desde que o cliente viu (ou é outra): 409 com o novo valor; a tela pede confirmação.
    if (input.expectedDeliveryFeeCents !== undefined && input.expectedDeliveryFeeCents !== deliveryFeeCents) {
      return reply.code(409).send({ error: "A taxa de entrega mudou. Confira o novo total.", code: "DELIVERY_FEE_CHANGED", details: { deliveryFeeCents, totalCents } });
    }

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
      return reply.code(201).send({ orderId: order.id, code: order.code, token: accessToken.token });
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
