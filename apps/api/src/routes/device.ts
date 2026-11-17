import type { FastifyPluginAsync } from "fastify";
import { prisma } from "@meucardapio/db";
import { buildPrintableOrder } from "../lib/printable";
import { Prisma } from "@meucardapio/db";
import { loadPrintMode } from "../modules/printJobs/printMode.service";

// Relógio do BANCO em UTC (mesma convenção do claim: colunas TIMESTAMP sem fuso, gravadas em UTC).
const NOW = Prisma.raw("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");

// Rotas consumidas pelo print-client (C#), autenticadas por token de dispositivo.
// Equivalentes funcionais ao listarPedidos/pedidosImpressos/textSaleNew do original,
// mas contra o nosso backend e com JSON estruturado em vez de HTML pronto.
const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/device/orders/pending", { preHandler: app.requireDeviceAuth }, async (request) => {
    const storeId = request.deviceStoreId!;
    // Em QUEUE a lista legada vem VAZIA: quem imprime é a fila (o servidor impede a impressão em dobro).
    // O corpo também diz o modo: o cliente legado já chama esta rota a cada ciclo, então descobre a fila sem requisição extra
    // (clientes antigos ignoram o campo novo; o formato `{ orders }` não mudou).
    const mode = await loadPrintMode(prisma, storeId);
    if (mode === "QUEUE") return { orders: [], mode };
    const orders = await prisma.order.findMany({
      where: { storeId, printedAt: null, status: { not: "CANCELADO" }, awaitingPayment: false },
      orderBy: { createdAt: "asc" },
      select: { id: true, code: true },
    });
    return { orders, mode };
  });

  app.get("/api/device/orders/:id/printable", { preHandler: app.requireDeviceAuth }, async (request, reply) => {
    const storeId = request.deviceStoreId!;
    const { id } = request.params as { id: string };
    if ((await loadPrintMode(prisma, storeId)) === "QUEUE") return reply.code(409).send({ error: "Esta loja imprime pela fila.", code: "MODE_QUEUE" });
    const order = await prisma.order.findFirst({ where: { id, storeId } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

    const printable = await buildPrintableOrder(id);
    return { order: printable };
  });

  app.post("/api/device/orders/:id/printed", { preHandler: app.requireDeviceAuth }, async (request, reply) => {
    const storeId = request.deviceStoreId!;
    const { id } = request.params as { id: string };
    const order = await prisma.order.findFirst({ where: { id, storeId }, select: { id: true } });
    if (!order) return reply.code(404).send({ error: "pedido não encontrado" });

    if ((await loadPrintMode(prisma, storeId)) === "QUEUE") {
      // ACK TARDIO (ADR-0004 §8 item 14): a impressora legada imprimiu e só agora confirma, depois da virada. Se NINGUÉM está com o
      // job do pedido (PENDING, ou CLAIMED com lease vencida), aceita: fecha o job (PRINTED) e grava `printedAt` NA MESMA transação,
      // para a fila não reimprimir. Com o job CLAIMED por outra impressora e lease vigente, 409 como antes. Idempotente.
      // A lista legada e o `printable` seguem recusados em QUEUE: só o ACK é aceito.
      const outcome = await prisma.$transaction(async (tx) => {
        const closed = await tx.$executeRaw`
          UPDATE "PrintJob" SET "status" = 'PRINTED', "printedAt" = ${NOW}, "ackStatus" = 'PRINTED', "leaseUntil" = NULL, "updatedAt" = ${NOW}
           WHERE "storeId" = ${storeId} AND "orderId" = ${id} AND "kind" = 'ORDER_KITCHEN'
             AND ("status" = 'PENDING' OR ("status" = 'CLAIMED' AND "leaseUntil" <= ${NOW}))`;
        if (closed === 0) {
          const [live] = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*) AS n FROM "PrintJob"
             WHERE "storeId" = ${storeId} AND "orderId" = ${id} AND "kind" = 'ORDER_KITCHEN' AND "status" = 'CLAIMED' AND "leaseUntil" > ${NOW}`;
          if (Number(live.n) > 0) return "BUSY" as const;
        }
        await tx.order.updateMany({ where: { id, storeId, printedAt: null }, data: { printedAt: new Date() } });
        return "OK" as const;
      });
      if (outcome === "BUSY") return reply.code(409).send({ error: "Esta loja imprime pela fila.", code: "MODE_QUEUE" });
      return { ok: true };
    }

    // `printedAt` do pedido E o job ORDER_KITCHEN dele fecham NA MESMA transação: o job do pedido que o legado imprimiu não
    // fica PENDING (senão a virada para a fila o reimprimiria; achado do Ritchie, ADR-0004 §8.13a).
    const now = new Date();
    await prisma.$transaction([
      prisma.order.update({ where: { id }, data: { printedAt: now } }),
      prisma.printJob.updateMany({
        where: { storeId, orderId: id, kind: "ORDER_KITCHEN", status: { in: ["PENDING", "CLAIMED"] } },
        data: { status: "PRINTED", printedAt: now, ackStatus: "PRINTED", leaseUntil: null },
      }),
    ]);
    return { ok: true };
  });
};

export default deviceRoutes;
