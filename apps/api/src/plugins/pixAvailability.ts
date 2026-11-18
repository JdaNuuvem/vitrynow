import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";

// PIX por loja no cardápio público (ADR-0001 §3.5, decisão D1; condição de G3): sem conta do Mercado Pago CONECTADA a
// opção PIX não existe. O servidor decide — não depende de a interface esconder o botão:
//  - POST /stores/:slug/orders com paymentMethod=PIX ⇒ 409 PIX_UNAVAILABLE ANTES da rota do pedido;
//  - GET /stores/:slug/menu ganha `store.payment.pixAvailable` (false sem conta CONNECTED).
// Feito no onRoute (como o portão da assinatura) para não editar as rotas do cardápio.

const UNAVAILABLE_MESSAGE = "O PIX não está disponível nesta loja no momento.";

// UMA consulta: existência da loja + conta CONNECTED (nulo = a loja não existe).
async function pixStateOf(slug: string | undefined): Promise<{ pixAvailable: boolean } | null> {
  if (!slug) return null;
  const store = await prisma.store.findUnique({
    where: { slug },
    select: { paymentAccounts: { where: { status: "CONNECTED", accessTokenEnc: { not: null } }, select: { id: true }, take: 1 } },
  });
  return store ? { pixAvailable: store.paymentAccounts.length > 0 } : null;
}

const pixOrderGate = async (request: FastifyRequest, reply: FastifyReply) => {
  const body = request.body as { paymentMethod?: unknown } | null | undefined;
  if (body?.paymentMethod !== "PIX") return undefined;
  const state = await pixStateOf((request.params as { slug?: string }).slug);
  if (!state) return undefined; // a rota responde 404
  if (!state.pixAvailable) {
    return reply.code(409).send({ error: UNAVAILABLE_MESSAGE, code: "PIX_UNAVAILABLE" });
  }
  return undefined;
};

const menuSerializer = async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
  if (!payload || typeof payload !== "object") return payload;
  const body = payload as { store?: Record<string, unknown> };
  if (!body.store) return payload;
  const state = await pixStateOf((request.params as { slug?: string }).slug);
  return { ...body, store: { ...body.store, payment: { pixAvailable: state?.pixAvailable ?? false } } };
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
