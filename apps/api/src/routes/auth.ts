import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { prisma } from "@meucardapio/db";
import { loginSchema, registerStoreSchema, forgotPasswordSchema, resetPasswordSchema } from "@meucardapio/shared-types";
import { sendPasswordResetEmail } from "../lib/email";
import { newTrialEndsAt } from "../lib/subscription";
import { SESSION_COOKIE, sessionCookieOptions, signSession } from "../lib/session";
import { disconnectUser } from "../realtime/hub";

const authRoutes: FastifyPluginAsync = async (app) => {
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
      return reply.code(409).send({ error: "slug ou código já em uso" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const store = await prisma.store.create({
      data: {
        name: storeName,
        slug,
        code,
        users: { create: { email, passwordHash, role: "OWNER" } },
        subscription: { create: { trialEndsAt: newTrialEndsAt() } },
      },
      include: { users: true },
    });

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

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: "credenciais inválidas" });
    }

    reply.setCookie(SESSION_COOKIE, signSession(app, user), sessionCookieOptions());
    return { ok: true };
  });

  app.post("/auth/logout", async (_request, reply) => {
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
          data: { userId: user.id, token, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
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

      const resetToken = await prisma.passwordResetToken.findUnique({ where: { token: parsed.data.token } });
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
