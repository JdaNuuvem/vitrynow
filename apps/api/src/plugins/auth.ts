import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import { prisma } from "@meucardapio/db";
import { allowedOrigin, getJwtSecret, getMfaKey } from "../lib/securityConfig";
import { sessionAbsoluteLimit, sessionCookieOptions, signSession, sessionNeedsRenewal, SESSION_COOKIE } from "../lib/session";

// O token carrega só identidade e versão (ADR-0008); `storeId`/`role` vêm SEMPRE do banco,
// reescritos em request.user por requirePanelAuth.
export interface PanelJwtPayload {
  sub: string; // userId
  tv: number; // User.tokenVersion no momento da emissão
  auth_time: number; // epoch s do login (teto absoluto da sessão)
  sid: string; // id aleatório da sessão (128 bits, sem tabela): auditoria e state de OAuth
  iat?: number;
  exp?: number;
}

export interface PanelUser {
  userId: string;
  storeId: string;
  role: "OWNER" | "STAFF";
  sid?: string;
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: PanelJwtPayload;
    user: PanelUser;
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

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCookie);
  // Falha o boot (fora de NODE_ENV=test) se algum segredo faltar ou for fraco/de exemplo.
  const jwtSecret = getJwtSecret();
  getMfaKey();
  await app.register(fastifyJwt, {
    secret: jwtSecret,
    cookie: { cookieName: SESSION_COOKIE, signed: false },
    sign: { algorithm: "HS256" },
    verify: { algorithms: ["HS256"] },
  });

  // Painel: cookie httpOnly com JWT que carrega só {sub, tv, auth_time, exp}. A cada requisição
  // relê o usuário por PK: removido, senha trocada (tv) ou papel alterado valem na hora.
  app.decorate("requirePanelAuth", async (request: FastifyRequest, reply: FastifyReply) => {
    const deny = (code: string) => reply.code(401).send({ error: "não autenticado", code });

    // CSRF em profundidade: escrita autenticada por cookie só aceita Origin igual ao do painel.
    const method = request.method;
    const origin = request.headers.origin;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && origin && origin !== allowedOrigin()) {
      return reply.code(403).send({ error: "origem não permitida", code: "ORIGIN_MISMATCH" });
    }

    let payload: PanelJwtPayload;
    try {
      payload = await request.jwtVerify<PanelJwtPayload>();
    } catch {
      return deny("SESSION_INVALID");
    }
    // Tokens sem exp/tv/sub/auth_time (formato antigo) são recusados: todos refazem login.
    if (
      typeof payload.exp !== "number" ||
      typeof payload.tv !== "number" ||
      typeof payload.sub !== "string" ||
      typeof payload.auth_time !== "number" ||
      typeof payload.sid !== "string"
    ) {
      return deny("SESSION_INVALID");
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (nowSeconds - payload.auth_time > sessionAbsoluteLimit()) return deny("SESSION_EXPIRED");

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, storeId: true, role: true, tokenVersion: true },
    });
    if (!user) return deny("SESSION_REVOKED");
    if (user.tokenVersion !== payload.tv) return deny("SESSION_REVOKED");

    request.user = { userId: user.id, storeId: user.storeId, role: user.role, sid: payload.sid };

    if (sessionNeedsRenewal(payload, nowSeconds)) {
      reply.setCookie(SESSION_COOKIE, signSession(app, user, { authTime: payload.auth_time, sid: payload.sid }), sessionCookieOptions());
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
