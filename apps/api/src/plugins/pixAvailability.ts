import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { storePaymentsService } from "../modules/storePayments/storePayments.module";

// PIX por loja no cardápio público (ADR-0001 §3.5, decisão D1; condição de G3): sem conta do Mercado Pago CONECTADA a
// opção PIX não existe. O servidor decide — não depende de a interface esconder o botão:
//  - POST /stores/:slug/orders com paymentMethod=PIX ⇒ 409 PIX_UNAVAILABLE ANTES da rota do pedido;
//  - GET /stores/:slug/menu ganha `store.payment.pixAvailable` (false sem conta CONNECTED).
// Feito no onRoute (como o portão da assinatura) para não editar as rotas do cardápio.

const UNAVAILABLE_MESSAGE = "O PIX não está disponível nesta loja no momento.";

async function storeIdOf(slug: string | undefined): Promise<string | null> {
  if (!slug) return null;
  return (await prisma.store.findUnique({ where: { slug }, select: { id: true } }))?.id ?? null;
}

const pixOrderGate = async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as { paymentMethod?: unknown } | null | undefined;
  if (body?.paymentMethod !== "PIX") return undefined;
  const storeId = await storeIdOf((request.params as { slug?: string }).slug);
  if (!storeId) return undefined; // a rota responde 404
  if (!(await storePaymentsService.pixAvailable(storeId))) {
    return reply.code(409).send({ error: UNAVAILABLE_MESSAGE, code: "PIX_UNAVAILABLE" });
  }
  return undefined;
};

const menuSerializer = async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as { store?: Record<string, unknown> };
  if (!body.store) return payload;
  const storeId = await storeIdOf((request.params as { slug?: string }).slug);
  const pixAvailable = storeId ? await storePaymentsService.pixAvailable(storeId) : false;
  return { ...body, store: { ...body.store, payment: { pixAvailable } } };
};

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

const pixAvailabilityPlugin: FastifyPluginAsync = async (app) => {
  app.addHook("onRoute", (route) => {
    const methods = asArray(route.method as string | string[]).map((m) => m.toUpperCase());
    if (methods.includes("POST") && route.url === "/stores/:slug/orders") {
      route.preHandler = [...asArray(route.preHandler as never), pixOrderGate] as never;
    }
    if (methods.includes("GET") && route.url === "/stores/:slug/menu") {
      route.preSerialization = [...asArray(route.preSerialization as never), menuSerializer] as never;
    }
  });
};

export default fp(pixAvailabilityPlugin, { name: "pix-availability" });
