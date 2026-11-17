import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { prisma } from "@meucardapio/db";
import { loginSchema, registerStoreSchema, forgotPasswordSchema, resetPasswordSchema } from "@meucardapio/shared-types";
import { sendLoginAlertEmail, sendPasswordResetEmail } from "../lib/email";
import { newTrialEndsAt } from "../lib/subscription";
import { SESSION_COOKIE, revokeSession, sessionCookieOptions, signSession } from "../lib/session";
import { disconnectSession, disconnectUser } from "../realtime/hub";
import { hashToken } from "../lib/tokenHash";
import { LoginThrottle } from "../lib/loginThrottle";

// Hash de uma senha que ninguém conhece, no mesmo custo dos hashes reais: login com e-mail inexistente
// gasta o mesmo tempo do login com senha errada (ST-05, sem enumeração de contas por tempo).
const DUMMY_HASH = bcrypt.hashSync(`nao-existe-${Math.random()}-${Date.now()}`, 10);

type PrismaKnownError = { code?: string; meta?: { target?: string[] | string } };
function uniqueTarget(error: unknown): string | null {
  const e = error as PrismaKnownError;
  if (e?.code !== "P2002") return null;
  const t = e.meta?.target;
  return Array.isArray(t) ? t.join(",") : (t ?? "");
}

const authRoutes: FastifyPluginAsync = async (app) => {
  // Uma instância por app: cada teste (e cada processo) tem os seus contadores.
  const throttle = new LoginThrottle();

  // Bootstrap de uma loja nova + usuário dono. Em produção isso vira o fluxo de
  // cadastro self-service da plataforma.
  app.post("/auth/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = registerStoreSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { storeName, slug, code, email, password } = parsed.data;

    const existing = await prisma.store.findFirst({ where: { OR: [{ slug }, { code }] } });
    if (existing) {
      return reply.code(409).send({ error: "slug ou código já em uso", code: "STORE_IN_USE" });
    }
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return reply.code(409).send({ error: "este e-mail já está cadastrado", code: "EMAIL_IN_USE" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    let store;
    try {
      store = await prisma.store.create({
        data: {
          name: storeName,
          slug,
          code,
          users: { create: { email, passwordHash, role: "OWNER" } },
          subscription: { create: { trialEndsAt: newTrialEndsAt() } },
        },
        include: { users: true },
      });
    } catch (error) {
      // Corrida: dois cadastros iguais passaram pelas checagens acima ao mesmo tempo (B21).
      const target = uniqueTarget(error);
      if (target === null) throw error;
      if (target.includes("email")) return reply.code(409).send({ error: "este e-mail já está cadastrado", code: "EMAIL_IN_USE" });
      return reply.code(409).send({ error: "slug ou código já em uso", code: "STORE_IN_USE" });
    }

    const user = store.users[0];
    reply.setCookie(SESSION_COOKIE, signSession(app, user), sessionCookieOptions());
    return reply.code(201).send({ store: { id: store.id, name: store.name, slug: store.slug } });
  });

  app.post("/auth/login", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const { email, password } = parsed.data;

    // Reserva a tentativa ANTES de qualquer await (ST-32): uma rajada paralela não passa toda pela checagem.
    // Limite estrito por (conta, IP); o total da conta só atrasa e avisa o dono, nunca tranca (ST-33).
    const slot = throttle.reserve(email, request.ip);
    if (!slot.allowed) {
      reply.header("Retry-After", String(slot.retryAfterSeconds));
      return reply.code(429).send({ error: "muitas tentativas de login; tente de novo em alguns minutos", code: "LOGIN_LOCKED" });
    }
    if (slot.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, slot.delayMs));

    const user = await prisma.user.findUnique({ where: { email } });
    // Sempre compara com algum hash (o falso, se a conta não existe): mesmo tempo nos dois casos (ST-05).
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    // Muitos erros na conta (de vários IPs): avisa o dono UMA vez por janela. A resposta não muda.
    if (slot.alertOwner && user) void sendLoginAlertEmail({ to: user.email }).catch(() => {});
    if (!user || !passwordOk) {
      return reply.code(401).send({ error: "credenciais inválidas" });
    }
    throttle.succeed(email, request.ip);

    reply.setCookie(SESSION_COOKIE, signSession(app, user), sessionCookieOptions());
    return { ok: true };
  });

  // Sair deste aparelho: o cookie copiado deixa de valer (ST-30) sem derrubar os outros aparelhos do mesmo
  // usuário. Sem cookie, ou com cookie inválido/vencido, só limpa e responde ok (idempotente).
  app.post("/auth/logout", async (request, reply) => {
    const token = request.cookies?.[SESSION_COOKIE];
    if (token) {
      try {
        const payload = await app.jwt.verify<{ sid?: string; exp?: number }>(token);
        if (typeof payload.sid === "string" && typeof payload.exp === "number") {
          await revokeSession(payload.sid, payload.exp);
          disconnectSession(payload.sid);
        }
      } catch {
        // token inválido ou vencido: nada a revogar
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  // "Sair de todos os dispositivos": incrementa tokenVersion (derruba todos os JWTs e sockets do
  // usuário) e entrega um cookie novo só para este dispositivo continuar logado.
  app.post("/auth/logout-all", { preHandler: app.requirePanelAuth }, async (request, reply) => {
    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: { tokenVersion: { increment: 1 } },
      select: { id: true, tokenVersion: true },
    });
    disconnectUser(user.id);
    reply.setCookie(SESSION_COOKIE, signSession(app, user), sessionCookieOptions());
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: app.requirePanelAuth }, async (request) => {
    return { user: request.user };
  });

  // Resposta sempre genérica (não revela se o e-mail existe na base). Envio real via Resend
  // (RESEND_API_KEY) — sem a chave configurada, cai no modo dev: loga o link no console.
  app.post(
    "/auth/forgot-password",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = forgotPasswordSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
      if (user) {
        const token = nanoid(32);
        await prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
        });
        const resetUrl = `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/reset-senha?token=${token}`;
        await sendPasswordResetEmail({ to: user.email, resetUrl });
      }

      return { ok: true };
    },
  );

  app.post(
    "/auth/reset-password",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
      if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) {
        return reply.code(400).send({ error: "token inválido ou expirado" });
      }

      const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
      await prisma.$transaction([
        // tokenVersion+1: redefinir a senha derruba todas as sessões abertas (token roubado inclusive).
        prisma.user.update({ where: { id: resetToken.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
        prisma.passwordResetToken.update({ where: { id: resetToken.id }, data: { usedAt: new Date() } }),
      ]);

      disconnectUser(resetToken.userId);
      return { ok: true };
    },
  );
};

export default authRoutes;
