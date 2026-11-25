import { panelRoleSchema } from "@meucardapio/shared-types";
import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import {
  MUTATING_METHODS,
  PANEL_ROUTE_POLICY,
  PUBLIC_ROUTE_POLICY,
  policyKey,
  type PanelPolicy,
  type PublicPolicy,
} from "../lib/routePolicy";
import { getEntitlements, getRequestEntitlements } from "../lib/subscription";
import { storeHoursService } from "../modules/storeHours/storeHours.module";

// Portão central da assinatura (ADR-0003 §2.3, B17, CA-B17-08): impõe Consulta e Suspensão a TODA rota
// pela tabela de `lib/routePolicy.ts`, sem `if` espalhado. Funciona no `onRoute`: cada rota com
// `requirePanelAuth`/`requireDeviceAuth` ganha o portão logo depois da autenticação (o `request.user`
// já existe e a fase é calculada por requisição, sem cache: pagar libera na hora). Rotas novas entram
// sozinhas, bloqueadas por padrão (escrita), e o teste de contrato exige classificá-las na tabela.

export type RouteRecord = {
  method: string;
  url: string;
  audience: "panel" | "device" | "public";
  policy: PanelPolicy | PublicPolicy | "device" | null;
  /** Escrita do painel/público que está (ou não) na tabela central. */
  classified: boolean;
  mutating: boolean;
};

declare module "fastify" {
  interface FastifyInstance {
    /** Todas as rotas registradas e como o portão da assinatura as trata (usado pelo teste de contrato). */
    routeRegistry: RouteRecord[];
  }
}

const READ_ONLY_MESSAGE = "Sua loja está em modo de consulta. Regularize o plano para voltar a editar.";
const SUSPENDED_MESSAGE = "Sua loja está suspensa. Pague para reativar na hora.";
const INACTIVE_MESSAGE = "Esta loja não está recebendo pedidos agora.";

function asArray<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function blockReadOnly(reply: FastifyReply) {
  return reply.code(403).send({ error: READ_ONLY_MESSAGE, code: "READ_ONLY" });
}
function blockSuspended(reply: FastifyReply) {
  return reply.code(402).send({ error: SUSPENDED_MESSAGE, code: "SUSPENDED" });
}

// Portões são singletons por tipo (a mesma referência), para reconhecer o que já foi aplicado
// (ex.: a rota HEAD gerada automaticamente copia o preHandler).
const panelGates = new Map<string, (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>>();

function panelGate(policy: PanelPolicy, mutating: boolean) {
  const key = `${policy}:${mutating}`;
  let gate = panelGates.get(key);
  if (!gate) {
    gate = async (request, reply) => {
      const { phase, access } = await getRequestEntitlements(request, request.user.storeId);
      if (phase === "SUSPENDED") {
        if (policy === "billing") return undefined;
        if (policy === "export" && request.user.role === panelRoleSchema.enum.OWNER) return undefined;
        return blockSuspended(reply);
      }
      if (phase === "READ_ONLY" && mutating) {
        if (policy === "blocked") return blockReadOnly(reply);
        if (policy === "finish" && !access.canFinishInProgress) return blockReadOnly(reply);
      }
      return undefined;
    };
    panelGates.set(key, gate);
  }
  return gate;
}

const deviceGate = async (request: FastifyRequest, reply: FastifyReply) => {
  const storeId = request.deviceStoreId;
  if (!storeId) return undefined; // requireDeviceAuth já respondeu
  const { access } = await getRequestEntitlements(request, storeId);
  if (access.printing === "none") return blockSuspended(reply);
  return undefined;
};

// Pedido público (cardápio/QR): loja sem `publicOrders` ⇒ 409 SUBSCRIPTION_INACTIVE, sem citar plano nem cobrança (RN-A-02).
const publicOrderGate = async (request: FastifyRequest, reply: FastifyReply) => {
  const { slug } = request.params as { slug?: string };
  if (!slug) return undefined;
  const store = await prisma.store.findUnique({ where: { slug }, select: { id: true } });
  if (!store) return undefined; // a rota responde 404
  const { access } = await getEntitlements(store.id);
  // RN-B5-01: a assinatura (Consulta/Suspensão) vence todos os outros motivos.
  if (!access.publicOrders) return reply.code(409).send({ error: INACTIVE_MESSAGE, code: "SUBSCRIPTION_INACTIVE" });
  // API-40: pedido AGENDADO não depende de a loja estar aberta agora; a rota confere o horário escolhido na grade (e o plano).
  const body = request.body as { scheduledFor?: unknown } | undefined;
  // Só na rota do cardápio: no QR da mesa o campo não existe e não pode furar o horário.
  if (request.routeOptions.url === "/stores/:slug/orders" && typeof body?.scheduledFor === "string") return undefined;
  const hours = await storeHoursService.publicStatus(slug);
  if (hours && hours.status.status !== "ABERTO") {
    const { reason, nextOpenAt, message } = hours.status;
    // g1: modo ocupado tem código próprio (RN-OCU-03): não se confunde com loja fechada.
    const code = reason === "BUSY" ? "STORE_BUSY" : "STORE_CLOSED";
    return reply.code(409).send({ error: message, code, details: { reason, nextOpenAt } });
  }
  return undefined;
};

// Cardápio: Suspensão ⇒ 503 neutro sem dados da loja; Consulta ⇒ `acceptingOrders:false`. A resposta
// ganha `store.accepting` (a loja recebe pedido AGORA = interruptor da loja E assinatura em dia): a vitrine
// usa só isso e nunca fica sabendo de plano nem de cobrança (RN-A-02).
const menuAccess = new WeakMap<FastifyRequest, { publicOrders: boolean; hours: Awaited<ReturnType<typeof storeHoursService.publicStatus>> }>();
const publicMenuGate = async (request: FastifyRequest, reply: FastifyReply) => {
  const { slug } = request.params as { slug?: string };
  if (!slug) return undefined;
  const store = await prisma.store.findUnique({ where: { slug }, select: { id: true } });
  if (!store) return undefined;
  const { access } = await getEntitlements(store.id);
  if (access.storefront === "unavailable") {
    return reply.code(503).send({ error: "Loja indisponível no momento.", code: "STORE_UNAVAILABLE" });
  }
  menuAccess.set(request, { publicOrders: access.publicOrders, hours: await storeHoursService.publicStatus(slug) });
  return undefined;
};
const publicMenuSerializer = async (request: FastifyRequest, _reply: FastifyReply, payload: unknown) => {
  const state = menuAccess.get(request);
  if (state && payload && typeof payload === "object") {
    const body = payload as { store?: { acceptingOrders?: boolean } & Record<string, unknown> };
    if (body.store) {
      const hours = state.hours?.status;
      // `hours` (RN-B5-04): status, motivo, próxima abertura e mensagem pronta; nada de assinatura.
      const switchedOn = state.publicOrders && body.store.acceptingOrders !== false;
      const accepting = switchedOn && (hours ? hours.status === "ABERTO" : true);
      // `prepMinutes` só existe quando a loja configurou (API-57): nunca um prazo inventado.
      const prepMinutes = state.hours?.prepMinutes;
      const derived = state.hours?.derived;
      // Horário (SSOT D2): UMA fonte, `Store.schedule`. `openNow`/`nextOpensAt`/`hoursText` saem da grade; `openingHours` vira o MESMO texto gerado quando há grade
      // (sem grade, continua o texto legado; é a única hora em que existe dois valores, e o legado já era o único).
      const hoursFields = derived ? { openNow: derived.openNow, nextOpensAt: derived.nextOpensAt, hoursText: derived.hoursText } : { openNow: null, nextOpensAt: null, hoursText: null };
      const openingHours = derived && derived.openNow !== null ? derived.hoursText : body.store.openingHours;
      return { ...body, store: { ...body.store, openingHours, ...hoursFields, acceptingOrders: switchedOn, accepting, busyUntil: state.hours?.busyUntil ?? null, reason: hours?.reason ?? null, hours: hours ?? null, ...(prepMinutes ? { prepMinutes } : {}) } };
    }
  }
  return payload;
};

const subscriptionGate: FastifyPluginAsync = async (app) => {
  const registry: RouteRecord[] = [];
  app.decorate("routeRegistry", registry);

  app.addHook("onRoute", (route) => {
    const methods = asArray(route.method as string | string[]);
    const hooks = asArray(route.preHandler as unknown as ((...args: never[]) => unknown) | Array<(...args: never[]) => unknown>);
    const panelAt = hooks.indexOf(app.requirePanelAuth as never);
    const deviceAt = hooks.indexOf(app.requireDeviceAuth as never);
    const audience: RouteRecord["audience"] = panelAt >= 0 ? "panel" : deviceAt >= 0 ? "device" : "public";
    const mutating = methods.some((method) => MUTATING_METHODS.has(method.toUpperCase()));

    let publicPolicy: PublicPolicy | undefined;
    let panelPolicy: PanelPolicy | undefined;
    for (const method of methods) {
      const isHead = method.toUpperCase() === "HEAD"; // cópia automática do GET: mesma política, sem entrada própria
      const key = policyKey(isHead ? "GET" : method, route.url);
      panelPolicy ??= PANEL_ROUTE_POLICY[key];
      publicPolicy ??= PUBLIC_ROUTE_POLICY[key];
      if (isHead) continue;
      const listed = audience === "panel" ? panelPolicy !== undefined : audience === "public" ? publicPolicy !== undefined : true;
      registry.push({
        method: method.toUpperCase(),
        url: route.url,
        audience,
        policy: audience === "panel" ? (panelPolicy ?? null) : audience === "device" ? "device" : (publicPolicy ?? null),
        classified: !MUTATING_METHODS.has(method.toUpperCase()) || listed,
        mutating: MUTATING_METHODS.has(method.toUpperCase()),
      });
    }

    const insertAfter = (index: number, gate: (...args: never[]) => unknown) => {
      if (hooks.includes(gate)) return;
      route.preHandler = [...hooks.slice(0, index + 1), gate as never, ...hooks.slice(index + 1)] as never;
    };

    if (audience === "panel") {
      // Escrita fora da tabela é bloqueada na Consulta (padrão seguro); leitura é liberada na Consulta.
      const policy: PanelPolicy = panelPolicy ?? (mutating ? "blocked" : "allowed");
      insertAfter(panelAt, panelGate(policy, mutating));
    } else if (audience === "device") {
      insertAfter(deviceAt, deviceGate);
    } else if (publicPolicy === "public-order") {
      route.preHandler = [...hooks, publicOrderGate] as never;
    } else if (publicPolicy === "public-menu") {
      route.preHandler = [...hooks, publicMenuGate] as never;
      route.preSerialization = [...asArray(route.preSerialization as never), publicMenuSerializer] as never;
    }
  });
};

export default fp(subscriptionGate, { name: "subscription-gate" });
