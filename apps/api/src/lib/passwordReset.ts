import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, prisma } from "@meucardapio/db";
import { nanoid } from "nanoid";
import { hashToken } from "./tokenHash";

// SEC-28 (ST-58): o "esqueci a senha" não pode ser uma metralhadora de e-mails contra uma conta (esgota a cota do provedor, que também entrega
// o código de MFA e o aviso de login, e queima a reputação do domínio) nem acumular tokens válidos. Regras POR CONTA, no banco (valem entre
// instâncias e reinícios), silenciosas: a resposta da rota é sempre a mesma.
export const RESET_MAX_PER_HOUR = 3;
export const RESET_COOLDOWN_MS = 60_000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type ResetIssue = { to: string; token: string };

// Devolve o token novo (e o e-mail do dono) ou `null` quando NÃO se deve enviar nada: conta inexistente, 3 pedidos na última hora,
// ou pedido a menos de 60 s do anterior. Ao emitir um token novo, os anteriores ainda válidos são INVALIDADOS (um só ativo por conta).
// O lock da conta (sem espera) serializa pedidos simultâneos: 20 pedidos ao mesmo tempo ⇒ no máximo 1 emissão.
export async function issueResetToken(email: string, now: Date = new Date()): Promise<ResetIssue | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) return null;
  return prisma.$transaction(async (tx) => {
    // Lock consultivo da conta SEM esperar: se outro pedido da mesma conta está emitindo agora, este é descartado em silêncio. Esperar
    // seguraria uma conexão do pool por pedido (rajada contra uma conta = esgotar o pool) e a resposta já é a mesma de qualquer forma.
    const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${"pwreset:" + user.id})) AS ok`;
    if (!lock?.ok) return null;
    const recent = await tx.passwordResetToken.findMany({
      where: { userId: user.id, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
      select: { createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (recent.length >= RESET_MAX_PER_HOUR) return null;
    if (recent[0] && now.getTime() - recent[0].createdAt.getTime() < RESET_COOLDOWN_MS) return null;
    await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } });
    const token = nanoid(32);
    await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS) } });
    return { to: user.email, token };
  }, { maxWait: 10_000, timeout: 15_000 }); // espera por conexão do pool em rajada; a transação em si é de poucos ms
}

// ST-57 (oráculo de existência por TEMPO): conta existente = lock + INSERT; inexistente = só um SELECT; e o envio do e-mail leva centenas de
// ms. Por isso a rota (1) NÃO espera o envio e (2) nunca responde antes de um piso de duração, igual para existente, inexistente e limitado.
export const FORGOT_MIN_DURATION_MS = 150;

export async function padToMinimum(startedAt: number, minMs: number = FORGOT_MIN_DURATION_MS): Promise<void> {
  const remaining = minMs - (performance.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}

// SEC-29 (ST-67): na redefinição, o e-mail digitado é comparado com o da conta do token SEM revelar nada: tempo constante (comparamos os
// SHA-256 dos dois textos, que têm tamanho igual), 5 e-mails errados invalidam o token e toda recusa leva o mesmo piso de tempo.
export const RESET_MAX_EMAIL_FAILURES = 5;
// Maior que o piso do forgot-password: a redefinição faz 3 consultas e é rara; o piso cobre o p99 do banco em outro host (ST-64).
export const RESET_FAIL_MIN_DURATION_MS = 300;

export function constantTimeEqual(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value.trim().toLowerCase()).digest();
  return timingSafeEqual(digest(a), digest(b));
}

// Relógio do BANCO em UTC (mesma convenção do claim e da troca de modo: colunas TIMESTAMP sem fuso, gravadas em UTC).
export const NOW = Prisma.raw("(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')");
