import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "@meucardapio/db";
import { getEmailSender } from "./emailSender";
import { hashToken, newSecretToken } from "./tokenHash";

// API-26 (RN-ONB-03): verificação de e-mail do usuário. Token de uso único, só o hash no banco, um ativo por usuário.
export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
export const VERIFY_RESEND_COOLDOWN_MS = 60_000;
export const VERIFY_MAX_PER_HOUR = 5;
const HOUR_MS = 60 * 60 * 1000;

export type IssueResult = { token: string } | { limited: true; retryAfterSeconds: number };

export async function issueVerificationToken(userId: string, now: Date = new Date()): Promise<IssueResult> {
  const recent = await prisma.emailVerificationToken.findMany({
    where: { userId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const sinceLast = recent[0] ? now.getTime() - recent[0].createdAt.getTime() : Infinity;
  if (sinceLast < VERIFY_RESEND_COOLDOWN_MS) return { limited: true, retryAfterSeconds: Math.ceil((VERIFY_RESEND_COOLDOWN_MS - sinceLast) / 1000) };
  if (recent.length >= VERIFY_MAX_PER_HOUR) return { limited: true, retryAfterSeconds: 3600 };
  const token = newSecretToken();
  await prisma.$transaction([
    prisma.emailVerificationToken.updateMany({ where: { userId, usedAt: null, expiresAt: { gt: now } }, data: { expiresAt: now } }),
    prisma.emailVerificationToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + VERIFY_TTL_MS) } }),
  ]);
  return { token };
}

export const verificationUrl = (token: string) => `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/verificar-email#token=${token}`;

export function verificationEmailHtml(url: string): string {
  return `
      <p>Confirme o seu e-mail para ativar todos os recursos da sua loja.</p>
      <p><a href="${url}">Clique aqui para confirmar o e-mail</a> (válido por 24 horas).</p>
      <p>Se você pediu mais de uma vez, use apenas o e-mail mais recente: os links anteriores deixam de valer.</p>
      <p>Se não foi você, pode ignorar este e-mail.</p>
    `;
}

// Emite e envia. `false` quando não saiu (o token é invalidado para não gastar a cota do usuário).
export async function sendVerificationEmail(user: { id: string; email: string }, now: Date = new Date()): Promise<{ limited: true; retryAfterSeconds: number } | { sent: boolean }> {
  const issued = await issueVerificationToken(user.id, now);
  if ("limited" in issued) return issued;
  const url = verificationUrl(issued.token);
  const sent = await getEmailSender()
    .send({ to: user.email, subject: "Confirme o seu e-mail — MeuCardapio", html: verificationEmailHtml(url), link: url })
    .catch(() => false);
  if (!sent) await prisma.emailVerificationToken.deleteMany({ where: { tokenHash: hashToken(issued.token) } });
  return { sent };
}

// Confirma de forma atômica: o UPDATE condicional é o único portão (token usado/vencido/desconhecido ⇒ 0 linhas ⇒ inválido).
export async function consumeVerificationToken(token: string, now: Date = new Date()): Promise<{ ok: boolean }> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.emailVerificationToken.updateMany({ where: { tokenHash: hashToken(token), usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) return { ok: false };
    const row = await tx.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) }, select: { userId: true } });
    await tx.user.updateMany({ where: { id: row.userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
    return { ok: true };
  });
}

// Portão para as ações que a spec condiciona ao e-mail verificado (conectar Mercado Pago, assinar). Encadear depois de requirePanelAuth.
export async function requireVerifiedEmail(request: FastifyRequest, reply: FastifyReply) {
  const user = await prisma.user.findUnique({ where: { id: request.user.userId }, select: { emailVerifiedAt: true } });
  if (!user?.emailVerifiedAt) {
    return reply.code(403).send({ error: "Confirme o seu e-mail antes de continuar.", code: "EMAIL_NOT_VERIFIED" });
  }
}
