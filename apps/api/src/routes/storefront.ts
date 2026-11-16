import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { createOrderSchema } from "@meucardapio/shared-types";
import { nextOrderCode, ORDER_TX_OPTIONS } from "../lib/order-code";
import { publishToStore } from "../realtime/hub";
import { createPixPayment } from "../lib/mercadopago";
import { orderService } from "../modules/orders/orders.module";
import { DomainError } from "../shared/errors";
import { toOrderPaymentMethod } from "../lib/paymentMethod";

// Rotas públicas do cardápio (sem autenticação) — equivalente ao /online/{slug} do original.
const storefrontRoutes: FastifyPluginAsync = async (app) => {
  app.get("/stores/:slug/menu", async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });

    const categories = await prisma.category.findMany({
      where: { storeId: store.id },
      orderBy: { position: "asc" },
      include: {
        products: {
          // SEC-11: nunca confiar só na categoria — o produto precisa ser DESTA loja.
          where: { active: true, storeId: store.id },
          orderBy: { position: "asc" },
          include: { additionals: true },
        },
      },
    });

    return {
      store: {
        name: store.name,
        slug: store.slug,
        logoUrl: store.logoUrl,
        coverImageUrl: store.coverImageUrl,
        primaryColor: store.primaryColor,
        address: store.address,
        whatsapp: store.whatsapp,
        openingHours: store.openingHours,
        minOrderCents: store.minOrderCents,
        deliveryEnabled: store.deliveryEnabled,
        pickupEnabled: store.pickupEnabled,
        acceptingOrders: store.acceptingOrders,
        deliveryFeeCents: store.deliveryFeeCents,
      },
      categories,
    };
  });

  app.post(
    "/stores/:slug/orders",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
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
    const unavailable = products.filter((p) => !p.active);
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
        return reply.code(400).send({ error: "cupom esgotado" });
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

    const deliveryFeeCents = input.type === "DELIVERY" ? store.deliveryFeeCents : 0;
    const tipCents = input.tipCents ?? 0;
    const totalCents = subtotalCents - discountCents + deliveryFeeCents + tipCents;

    const paymentMethod = toOrderPaymentMethod(input.paymentMethod);
    if (input.changeForCents !== undefined) {
      if (paymentMethod !== "DINHEIRO") {
        return reply.code(400).send({ error: "troco só se aplica a pagamento em dinheiro" });
      }
      if (input.changeForCents < totalCents) {
        return reply.code(400).send({ error: "o valor para troco deve cobrir o total do pedido" });
      }
    }
    const usePix = paymentMethod === "PIX";

    // Código e pedido na MESMA transação: o contador da loja fica travado até o commit, então
    // pedidos simultâneos são serializados e nunca colidem (B01).
    const order = await prisma.$transaction(async (tx) => {
      const code = await nextOrderCode(tx, store.id);
      return tx.order.create({
      data: {
        storeId: store.id,
        code,
        type: input.type,
        customerName: input.customerName,
        customerPhone: input.customerPhone,
        address: input.address,
        notes: input.notes,
        subtotalCents,
        discountCents,
        deliveryFeeCents,
        tipCents,
        totalCents,
        paymentMethod,
        changeForCents: input.changeForCents,
        couponId: coupon?.id,
        awaitingPayment: usePix,
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
    }, ORDER_TX_OPTIONS);

    if (coupon) {
      await prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
    }

    if (!usePix) {
      publishToStore(store.id, { type: "order.created", orderId: order.id });
      return reply.code(201).send({ orderId: order.id, code: order.code });
    }

    try {
      const pix = await createPixPayment({
        orderId: order.id,
        amountCents: totalCents,
        description: `Pedido #${order.code} — ${store.name}`,
        payerEmail: `cliente-${order.id}@checkout.meucardapio.local`,
      });
      await prisma.payment.create({
        data: {
          orderId: order.id,
          providerPaymentId: pix.providerPaymentId,
          amountCents: totalCents,
          pixQrCode: pix.pixQrCode,
          pixQrCodeBase64: pix.pixQrCodeBase64,
          expiresAt: pix.expiresAt,
        },
      });
      return reply.code(201).send({
        orderId: order.id,
        code: order.code,
        payment: { pixQrCode: pix.pixQrCode, pixQrCodeBase64: pix.pixQrCodeBase64, expiresAt: pix.expiresAt },
      });
    } catch (error) {
      app.log.error(error);
      await prisma.order.delete({ where: { id: order.id } });
      if (coupon) await prisma.coupon.update({ where: { id: coupon.id }, data: { usedCount: { decrement: 1 } } });
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
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

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
      cancelReason: cancelRow ? { customerMessage: cancelRow.customerMessage ?? null } : null,
    };
  });

  // Cliente só cancela enquanto a loja não aceitou (PENDENTE); vence quem chegar primeiro.
  // Com PIX já aprovado, o estorno roda automaticamente (ADR-0007 §5.3).
  app.post("/stores/:slug/orders/:orderId/cancel", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { slug, orderId } = request.params as { slug: string; orderId: string };
    const store = await prisma.store.findUnique({ where: { slug } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
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
