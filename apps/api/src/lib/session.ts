import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { prisma } from "@meucardapio/db";
import type { PanelJwtPayload } from "../plugins/auth";
import { cookieSecure, sessionAbsoluteSeconds, sessionTtlSeconds } from "./securityConfig";

export const SESSION_COOKIE = "mc_session";

export const sessionAbsoluteLimit = sessionAbsoluteSeconds;

export function sessionCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cookieSecure(),
    maxAge: sessionTtlSeconds(),
  };
}

// Emite o JWT da sessão (ADR-0008). `authTime` fixa o teto absoluto: renovações deslizantes
// mantêm o mesmo `auth_time`, então ninguém fica logado para sempre renovando.
export function signSession(
  app: FastifyInstance,
  user: { id: string; tokenVersion: number },
  opts: { authTime?: number; sid?: string } = {},
): string {
  const authTime = opts.authTime ?? Math.floor(Date.now() / 1000);
  const sid = opts.sid ?? randomBytes(16).toString("base64url"); // 128 bits
  const now = Math.floor(Date.now() / 1000);
  const remainingAbsolute = authTime + sessionAbsoluteSeconds() - now;
  const ttl = Math.max(1, Math.min(sessionTtlSeconds(), remainingAbsolute));
  return app.jwt.sign({ sub: user.id, tv: user.tokenVersion, auth_time: authTime, sid }, { expiresIn: ttl });
}

// Renova (reemite o cookie) quando falta menos da metade da janela — e ainda há teto absoluto.
export function sessionNeedsRenewal(payload: PanelJwtPayload, nowSeconds: number): boolean {
  if (!payload.exp) return false;
  const remaining = payload.exp - nowSeconds;
  const absoluteEnd = payload.auth_time + sessionAbsoluteSeconds();
  return remaining < sessionTtlSeconds() / 2 && payload.exp < absoluteEnd;
}

// SEC-19 / ST-30: encerra UMA sessão (um aparelho) sem derrubar as outras. Vale até o `exp` do token.
export async function revokeSession(sid: string, exp: number): Promise<void> {
  const expiresAt = new Date(exp * 1000);
  await prisma.revokedSession.upsert({ where: { sid }, create: { sid, expiresAt }, update: { expiresAt } });
}

// Limpeza técnica (lista de permissão do tech.cleanup, ADR-0011): linhas cujo token já expirou.
export async function purgeExpiredRevokedSessions(now: Date = new Date()): Promise<number> {
  const result = await prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: now } } });
  return result.count;
}
