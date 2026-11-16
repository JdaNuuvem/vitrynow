import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { prisma } from "@meucardapio/db";

export interface PanelJwtPayload {
  userId: string;
  storeId: string;
  role: "OWNER" | "STAFF";
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: PanelJwtPayload;
    user: PanelJwtPayload;
  }
}

declare module "fastify" {
  interface FastifyRequest {
    deviceStoreId?: string;
  }
  interface FastifyInstance {
    requirePanelAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireDeviceAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  // Sem JWT_SECRET configurado: em produção isso seria assinar sessões com um segredo
  // público e conhecido (qualquer um forjaria login) — falha o boot em vez de seguir silencioso.
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET não configurado — obrigatório em produção, recusando subir o servidor");
  }
  console.warn("[auth] JWT_SECRET não configurado — usando segredo de desenvolvimento (NÃO use em produção)");
  return "dev-secret-change-me";
}

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: resolveJwtSecret(),
    cookie: { cookieName: "mc_session", signed: false },
  });

  // Painel: usuário autenticado por cookie httpOnly com JWT.
  app.decorate("requirePanelAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ error: "não autenticado" });
    }
  });

  // Ações sensíveis da conta (configurações, chaves de impressora, equipe) — exige OWNER.
  // Encadear depois de requirePanelAuth: `{ preHandler: [app.requirePanelAuth, app.requireOwner] }`.
  app.decorate("requireOwner", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.user.role !== "OWNER") {
      reply.code(403).send({ error: "ação restrita ao dono da loja" });
    }
  });

  // Print-client: token de dispositivo por loja (não é login humano).
  app.decorate("requireDeviceAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
    if (!token) {
      reply.code(401).send({ error: "token de dispositivo ausente" });
      return;
    }
    const deviceToken = await prisma.deviceToken.findUnique({ where: { token } });
    if (!deviceToken || deviceToken.revokedAt) {
      reply.code(401).send({ error: "token de dispositivo inválido" });
      return;
    }
    request.deviceStoreId = deviceToken.storeId;

    // Heartbeat: não bloqueia a resposta — serve só pro painel saber se a impressora está
    // online (last seen), não é crítico se uma atualização ocasional se perder.
    prisma.deviceToken.update({ where: { id: deviceToken.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  });
};

export default fp(authPlugin, { name: "auth-plugin" });
