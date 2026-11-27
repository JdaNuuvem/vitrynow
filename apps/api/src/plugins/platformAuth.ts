import fp from "fastify-plugin";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { allowedOrigin, cookieSecure, sessionAbsoluteSeconds, sessionTtlSeconds } from "../lib/securityConfig";

// API-25 (RN-BKO-01): sessão da EQUIPE da plataforma, separada da do lojista. Cookie próprio, JWT com `typ: "platform"` e SEM renovação
// deslizante (vida curta, no máximo PLATFORM_SESSION_HOURS, padrão 8). Um cookie de loja não abre o back-office e vice-versa.
export const PLATFORM_COOKIE = "mc_platform_session";

export type PlatformAdminCtx = { id: string; email: string; role: "ADMIN" | "SUPPORT"; sid: string };

declare module "fastify" {
  interface FastifyRequest {
    platformAdmin?: PlatformAdminCtx;
  }
  interface FastifyInstance {
    requirePlatformAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

type PlatformPayload = { sub: string; tv: number; auth_time: number; sid: string; typ: string; exp: number };

export function platformSessionSeconds(): number {
  const hours = Number(process.env.PLATFORM_SESSION_HOURS);
  const wanted = Number.isFinite(hours) && hours > 0 ? hours * 3600 : 8 * 3600;
  return Math.min(wanted, sessionTtlSeconds(), sessionAbsoluteSeconds());
}

export function platformCookieOptions() {
  return { path: "/", httpOnly: true, sameSite: "strict" as const, secure: cookieSecure(), maxAge: platformSessionSeconds() };
}

export function requirePlatformRole(role: "ADMIN") {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.platformAdmin?.role !== role) return reply.code(403).send({ error: "Só a equipe da plataforma pode fazer isso.", code: "PLATFORM_ROLE_REQUIRED" });
  };
}

const platformAuthPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest("platformAdmin", undefined);
  app.decorate("requirePlatformAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    const deny = (code: string) => reply.code(401).send({ error: "não autenticado", code });

    const method = request.method;
    const origin = request.headers.origin;
    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && origin && origin !== allowedOrigin()) {
      return reply.code(403).send({ error: "Não foi possível confirmar a origem do acesso. Atualize a página.", code: "ORIGIN_MISMATCH" });
    }

    const token = request.cookies?.[PLATFORM_COOKIE];
    if (!token) return deny("SESSION_INVALID");
    let payload: PlatformPayload;
    try {
      payload = app.jwt.verify<PlatformPayload>(token);
    } catch {
      return deny("SESSION_INVALID");
    }
    if (payload.typ !== "platform" || typeof payload.sub !== "string" || typeof payload.tv !== "number" || typeof payload.sid !== "string") {
      return deny("SESSION_INVALID");
    }
    const [admin, revoked] = await Promise.all([
      prisma.platformAdmin.findUnique({ where: { id: payload.sub }, select: { id: true, email: true, role: true, tokenVersion: true, disabledAt: true } }),
      prisma.revokedSession.findUnique({ where: { sid: payload.sid }, select: { sid: true } }),
    ]);
    if (revoked || !admin || admin.disabledAt || admin.tokenVersion !== payload.tv) return deny("SESSION_REVOKED");
    request.platformAdmin = { id: admin.id, email: admin.email, role: admin.role, sid: payload.sid };
  });
};

export default fp(platformAuthPlugin, { name: "platform-auth-plugin", dependencies: ["auth-plugin"] });
