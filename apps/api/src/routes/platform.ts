import { clientIpOf } from "../lib/clientIp";
import { randomBytes } from "node:crypto";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { Prisma, prisma } from "@meucardapio/db";
import {
  platformCreateNoticeSchema,
  platformCreditGrantSchema,
  platformExtendTrialSchema,
  platformLoginSchema,
  platformMfaChallengeSchema,
  platformMfaVerifySchema,
  platformReasonSchema,
  platformStoreListQuerySchema,
} from "@meucardapio/shared-types";
import { PLATFORM_COOKIE, platformCookieOptions, platformSessionSeconds, requirePlatformRole } from "../plugins/platformAuth";
import { platformAudit } from "../lib/platformAudit";
import { LoginThrottle } from "../lib/loginThrottle";
import { clientKey } from "../lib/clientKey";
import { createChallenge, maskEmail, spendProof, verifyChallenge } from "../lib/mfa";
import { revokeSession } from "../lib/session";
import { sendCreditChangeEmail, sendMfaCodeEmail } from "../lib/email";
import { resolveSubscription } from "../lib/subscription";
import { ServerBusyError, sendServerBusy } from "../shared/errors";
import { DUMMY_HASH, bcryptPasswordHasher as passwordHasher } from "../shared/passwordHasher";
import { securityEvent } from "../lib/securityEvents";

const DAY_MS = 24 * 60 * 60 * 1000;
const PRINTER_ONLINE_MS = 2 * 60 * 1000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
// Limite por operação e patamar de "concessão grande" (ADR-0015 §3D). Configuráveis; o padrão só protege contra erro de digitação.
const creditMaxPerOperation = () => envInt("CREDIT_GRANT_MAX", 100);
const creditLargeAt = () => envInt("CREDIT_GRANT_ALERT_AT", 50);

const PURPOSE_LABEL: Record<string, string> = {
  platform_login: "entrada no back-office",
  platform_credit_grant: "concessão de créditos",
};

class CreditNegative extends Error {}

const platformRoutes: FastifyPluginAsync = async (app) => {
  const throttle = new LoginThrottle();
  const guard = { preHandler: app.requirePlatformAdmin };
  const adminOnly = { preHandler: [app.requirePlatformAdmin, requirePlatformRole("ADMIN")] };

  const sessionToken = (admin: { id: string; tokenVersion: number }) => {
    const now = Math.floor(Date.now() / 1000);
    // `typ` marca o token como da plataforma; o requirePanelAuth das lojas nunca o aceita (e este nunca aceita o das lojas).
    const payload = { sub: admin.id, tv: admin.tokenVersion, auth_time: now, sid: randomBytes(16).toString("base64url"), typ: "platform" };
    return app.jwt.sign(payload as never, { expiresIn: platformSessionSeconds() });
  };

  // ---------- Entrada: senha + código por e-mail (MFA SEMPRE obrigatório, independe de MFA_ENFORCED) ----------

  app.post("/api/platform/auth/login", { config: { rateLimit: { max: 8, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = platformLoginSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { email, password } = parsed.data;

    const slot = throttle.reserve(email, clientIpOf(request));
    if (!slot.allowed) {
      reply.header("Retry-After", String(slot.retryAfterSeconds));
      securityEvent(request, "platform_login_locked", { email });
      return reply.code(429).send({ error: "muitas tentativas; tente de novo em alguns minutos", code: "LOGIN_LOCKED" });
    }
    if (slot.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, slot.delayMs));

    const admin = await prisma.platformAdmin.findUnique({ where: { email } });
    let passwordOk: boolean;
    try {
      passwordOk = await passwordHasher.verify(password, admin?.passwordHash ?? DUMMY_HASH, clientKey(clientIpOf(request)));
    } catch (error) {
      if (error instanceof ServerBusyError) {
        throttle.refund(email, clientIpOf(request));
        return sendServerBusy(reply);
      }
      throw error;
    }
    if (!admin || admin.disabledAt || !passwordOk) {
      securityEvent(request, "platform_login_failed", { email });
      return reply.code(401).send({ error: "credenciais inválidas" });
    }
    throttle.succeed(email, clientIpOf(request));

    // Senha certa NÃO abre sessão: só gera o desafio. O cookie só nasce em /auth/verify.
    const { challenge, code } = await createChallenge(admin.id, "platform_login");
    await sendMfaCodeEmail({ to: admin.email, code, purposeLabel: PURPOSE_LABEL.platform_login });
    return reply.code(202).send({ challengeId: challenge.id, maskedEmail: maskEmail(admin.email) });
  });

  app.post("/api/platform/auth/verify", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = platformMfaVerifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { challengeId, code } = parsed.data;

    const challenge = await prisma.mfaChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge || challenge.purpose !== "platform_login") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_INVALID" });
      return reply.code(400).send({ error: "código inválido", code: "MFA_INVALID" });
    }
    const outcome = await verifyChallenge(challenge.userId, challengeId, code);
    if (outcome === "locked") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_LOCKED" });
      return reply.code(429).send({ error: "muitas tentativas; peça um código novo", code: "MFA_LOCKED" });
    }
    if (outcome === "expired") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_EXPIRED" });
      return reply.code(400).send({ error: "código expirado", code: "MFA_EXPIRED" });
    }
    if (outcome !== "ok") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_INVALID" });
      return reply.code(400).send({ error: "código inválido", code: "MFA_INVALID" });
    }

    const admin = await prisma.platformAdmin.findUnique({ where: { id: challenge.userId } });
    if (!admin || admin.disabledAt) return reply.code(401).send({ error: "credenciais inválidas" });
    await platformAudit({ adminId: admin.id, action: "platform.login" });
    securityEvent(request, "platform_login_ok", { userId: admin.id });
    reply.setCookie(PLATFORM_COOKIE, sessionToken(admin), platformCookieOptions());
    return { ok: true, role: admin.role };
  });

  app.post("/api/platform/auth/logout", async (request, reply) => {
    const token = request.cookies?.[PLATFORM_COOKIE];
    if (token) {
      try {
        const payload = app.jwt.verify<{ sid?: string; exp?: number; typ?: string }>(token);
        if (payload.typ === "platform" && typeof payload.sid === "string" && typeof payload.exp === "number") await revokeSession(payload.sid, payload.exp);
      } catch {
        // token inválido ou vencido: nada a revogar
      }
    }
    reply.clearCookie(PLATFORM_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/platform/me", guard, async (request) => ({ email: request.platformAdmin!.email, role: request.platformAdmin!.role }));

  // Comprovante de uso único para ações sensíveis (hoje: conceder créditos).
  app.post("/api/platform/mfa/challenge", { ...guard, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = platformMfaChallengeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const admin = request.platformAdmin!;
    const { challenge, code } = await createChallenge(admin.id, parsed.data.purpose);
    await sendMfaCodeEmail({ to: admin.email, code, purposeLabel: PURPOSE_LABEL[parsed.data.purpose] });
    return reply.code(201).send({ challengeId: challenge.id, maskedEmail: maskEmail(admin.email) });
  });

  app.post("/api/platform/mfa/verify", { ...guard, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const parsed = platformMfaVerifySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const outcome = await verifyChallenge(request.platformAdmin!.id, parsed.data.challengeId, parsed.data.code);
    if (outcome === "locked") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_LOCKED" });
      return reply.code(429).send({ error: "muitas tentativas; peça um código novo", code: "MFA_LOCKED" });
    }
    if (outcome === "expired") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_EXPIRED" });
      return reply.code(400).send({ error: "código expirado", code: "MFA_EXPIRED" });
    }
    if (outcome !== "ok") {
      securityEvent(request, "platform_mfa_failed", { reason: "MFA_INVALID" });
      return reply.code(400).send({ error: "código inválido", code: "MFA_INVALID" });
    }
    return { ok: true };
  });

  // ---------- Lojas (somente o necessário para suporte; nunca segredo nem cliente final: RN-BKO-02/04) ----------

  const balanceOf = async (storeId: string): Promise<number> => {
    const row = await prisma.aiCreditLedger.aggregate({ where: { storeId }, _sum: { delta: true } });
    return row._sum.delta ?? 0;
  };

  app.get("/api/platform/stores", guard, async (request, reply) => {
    const parsed = platformStoreListQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { q, page, pageSize } = parsed.data;
    const where: Prisma.StoreWhereInput = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
            { users: { some: { role: "OWNER", email: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {};
    await platformAudit({ adminId: request.platformAdmin!.id, action: "stores.list", metadata: { hasQuery: Boolean(q), page } });

    const [total, stores] = await Promise.all([
      prisma.store.count({ where }),
      prisma.store.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          createdAt: true,
          platformSuspendedAt: true,
          users: { where: { role: "OWNER" }, select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 },
          subscription: { include: { plan: true } },
          paymentAccounts: { where: { status: "CONNECTED" }, select: { id: true }, take: 1 },
          deviceTokens: { where: { revokedAt: null }, select: { lastSeenAt: true } },
        },
      }),
    ]);
    const ids = stores.map((store) => store.id);
    const lastOrders = ids.length ? await prisma.order.groupBy({ by: ["storeId"], where: { storeId: { in: ids } }, _max: { createdAt: true } }) : [];
    const lastByStore = new Map(lastOrders.map((row) => [row.storeId, row._max.createdAt]));
    const now = new Date();
    return {
      total,
      page,
      pageSize,
      stores: stores.map((store) => ({
        id: store.id,
        name: store.name,
        slug: store.slug,
        ownerEmail: store.users[0]?.email ?? null,
        createdAt: store.createdAt,
        suspended: store.platformSuspendedAt !== null,
        subscription: store.subscription ? resolveSubscription(store.subscription, now) : null,
        paymentConnected: store.paymentAccounts.length > 0,
        printerOnline: store.deviceTokens.some((device) => device.lastSeenAt && now.getTime() - device.lastSeenAt.getTime() < PRINTER_ONLINE_MS),
        lastOrderAt: lastByStore.get(store.id) ?? null,
      })),
    };
  });

  app.get("/api/platform/stores/:id", guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const store = await prisma.store.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        slug: true,
        code: true,
        createdAt: true,
        acceptingOrders: true,
        platformSuspendedAt: true,
        platformSuspendedReason: true,
        users: { where: { role: "OWNER" }, select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 },
        subscription: {
          include: { plan: true, payments: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, planCode: true, status: true, amountCents: true, createdAt: true } } },
        },
        paymentAccounts: { select: { status: true } },
      },
    });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    // A leitura de dados de uma loja também fica no rastro (RN-BKO-03), ANTES de a resposta sair.
    await platformAudit({ adminId: request.platformAdmin!.id, storeId: id, action: "store.view" });
    return {
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        code: store.code,
        createdAt: store.createdAt,
        acceptingOrders: store.acceptingOrders,
        suspended: store.platformSuspendedAt !== null,
        suspendedAt: store.platformSuspendedAt,
        suspendedReason: store.platformSuspendedReason,
        ownerEmail: store.users[0]?.email ?? null,
        paymentStatus: store.paymentAccounts[0]?.status ?? "NOT_CONNECTED",
      },
      subscription: store.subscription ? { ...resolveSubscription(store.subscription, new Date()), status: store.subscription.status } : null,
      subscriptionPayments: store.subscription?.payments ?? [],
      creditBalance: await balanceOf(id),
    };
  });

  // ---------- Ações sobre a loja (sempre com motivo; auditoria na MESMA transação) ----------

  app.post("/api/platform/stores/:id/suspend", guard, async (request, reply) => {
    const parsed = platformReasonSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { id } = request.params as { id: string };
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.store.updateMany({ where: { id, platformSuspendedAt: null }, data: { platformSuspendedAt: new Date(), platformSuspendedReason: parsed.data.reason } });
      if (result.count === 1) await platformAudit({ adminId: request.platformAdmin!.id, storeId: id, action: "store.suspend", reason: parsed.data.reason }, tx);
      return result.count;
    });
    if (changed === 1) return { ok: true };
    const exists = await prisma.store.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: "loja não encontrada" });
    return reply.code(409).send({ error: "a loja já está suspensa", code: "ALREADY_SUSPENDED" });
  });

  app.post("/api/platform/stores/:id/reactivate", guard, async (request, reply) => {
    const parsed = platformReasonSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { id } = request.params as { id: string };
    const changed = await prisma.$transaction(async (tx) => {
      const result = await tx.store.updateMany({ where: { id, platformSuspendedAt: { not: null } }, data: { platformSuspendedAt: null, platformSuspendedReason: null } });
      if (result.count === 1) await platformAudit({ adminId: request.platformAdmin!.id, storeId: id, action: "store.reactivate", reason: parsed.data.reason }, tx);
      return result.count;
    });
    if (changed === 1) return { ok: true };
    const exists = await prisma.store.findUnique({ where: { id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ error: "loja não encontrada" });
    return reply.code(409).send({ error: "a loja não está suspensa", code: "NOT_SUSPENDED" });
  });

  app.post("/api/platform/stores/:id/extend-trial", guard, async (request, reply) => {
    const parsed = platformExtendTrialSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { id } = request.params as { id: string };
    const { days, reason } = parsed.data;
    const outcome = await prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.findUnique({ where: { storeId: id } });
      if (!subscription) return { error: 404 as const };
      if (subscription.status !== "TRIAL") return { error: 409 as const };
      const base = subscription.trialEndsAt > new Date() ? subscription.trialEndsAt : new Date();
      const trialEndsAt = new Date(base.getTime() + days * DAY_MS);
      await tx.subscription.update({ where: { storeId: id }, data: { trialEndsAt } });
      await platformAudit({ adminId: request.platformAdmin!.id, storeId: id, action: "subscription.extend_trial", reason, metadata: { days, trialEndsAt: trialEndsAt.toISOString() } }, tx);
      return { trialEndsAt };
    });
    if ("error" in outcome) {
      return outcome.error === 404
        ? reply.code(404).send({ error: "assinatura não encontrada" })
        : reply.code(409).send({ error: "só é possível estender o período de teste de uma loja em teste", code: "NOT_IN_TRIAL" });
    }
    return { ok: true, trialEndsAt: outcome.trialEndsAt };
  });

  // ---------- Avisos (substitui o x-admin-token) ----------

  app.post("/api/platform/notices", guard, async (request, reply) => {
    const parsed = platformCreateNoticeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const { expiresAt, ...rest } = parsed.data;
    const notice = await prisma.$transaction(async (tx) => {
      const created = await tx.notice.create({ data: { ...rest, expiresAt: expiresAt ? new Date(expiresAt) : null } });
      await platformAudit({ adminId: request.platformAdmin!.id, action: "notice.publish", metadata: { noticeId: created.id } }, tx);
      return created;
    });
    return reply.code(201).send({ notice });
  });

  app.post("/api/platform/notices/:id/delete", guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const removed = await prisma.$transaction(async (tx) => {
      const result = await tx.notice.deleteMany({ where: { id } });
      if (result.count === 1) await platformAudit({ adminId: request.platformAdmin!.id, action: "notice.delete", metadata: { noticeId: id } }, tx);
      return result.count;
    });
    if (removed === 0) return reply.code(404).send({ error: "aviso não encontrado" });
    return { ok: true };
  });

  // ---------- Créditos (livro-razão imutável; só ADMIN concede/ajusta) ----------

  const ledgerView = (row: { id: string; delta: number; reason: string; note: string | null; externalRef: string | null; priceCents: number | null; expiresAt: Date | null; actorAdminId: string | null; createdAt: Date }) => ({
    id: row.id,
    delta: row.delta,
    reason: row.reason,
    note: row.note,
    externalRef: row.externalRef,
    priceCents: row.priceCents,
    expiresAt: row.expiresAt,
    actorAdminId: row.actorAdminId,
    createdAt: row.createdAt,
  });

  app.get("/api/platform/stores/:id/credits", guard, async (request, reply) => {
    const { id } = request.params as { id: string };
    const store = await prisma.store.findUnique({ where: { id }, select: { id: true } });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });
    await platformAudit({ adminId: request.platformAdmin!.id, storeId: id, action: "credits.view" });
    const entries = await prisma.aiCreditLedger.findMany({ where: { storeId: id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100 });
    return { balance: await balanceOf(id), entries: entries.map(ledgerView) };
  });

  app.post("/api/platform/stores/:id/credits", { ...adminOnly, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = platformCreditGrantSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    const input = parsed.data;
    const { id: storeId } = request.params as { id: string };
    const admin = request.platformAdmin!;

    if (Math.abs(input.credits) > creditMaxPerOperation()) {
      return reply.code(422).send({ error: `limite por operação: ${creditMaxPerOperation()} créditos`, code: "CREDIT_LIMIT_EXCEEDED" });
    }
    const store = await prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, users: { where: { role: "OWNER" }, select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 } },
    });
    if (!store) return reply.code(404).send({ error: "loja não encontrada" });

    // Repetição da MESMA chave: devolve o lançamento que já existe, sem novo comprovante e sem lançar de novo.
    const already = await prisma.aiCreditLedger.findUnique({ where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } } });
    if (already) return reply.code(200).send({ entry: ledgerView(already), balance: await balanceOf(storeId), idempotent: true });

    // Reautenticação: senha de novo + comprovante MFA de uso único.
    const adminRow = await prisma.platformAdmin.findUnique({ where: { id: admin.id }, select: { passwordHash: true } });
    let passwordOk: boolean;
    try {
      passwordOk = await passwordHasher.verify(input.password, adminRow?.passwordHash ?? DUMMY_HASH, clientKey(clientIpOf(request)));
    } catch (error) {
      if (error instanceof ServerBusyError) return sendServerBusy(reply);
      throw error;
    }
    if (!passwordOk) return reply.code(403).send({ error: "senha incorreta", code: "REAUTH_FAILED" });
    const challengeId = request.headers["x-mfa-challenge"];
    if (typeof challengeId !== "string" || !(await spendProof(admin.id, challengeId, "platform_credit_grant"))) {
      return reply.code(403).send({ error: "Confirmação de segurança necessária.", code: "MFA_REQUIRED", purpose: "platform_credit_grant" });
    }

    const large = Math.abs(input.credits) >= creditLargeAt();
    let entry;
    try {
      entry = await prisma.$transaction(async (tx) => {
        // Serializa os lançamentos DA LOJA: o saldo lido abaixo vale até o commit (sem saldo negativo por corrida).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai-credit:" + storeId}))`;
        const sum = await tx.aiCreditLedger.aggregate({ where: { storeId }, _sum: { delta: true } });
        if ((sum._sum.delta ?? 0) + input.credits < 0) throw new CreditNegative();
        const created = await tx.aiCreditLedger.create({
          data: {
            storeId,
            delta: input.credits,
            reason: input.reason,
            note: input.note,
            externalRef: input.externalRef ?? null,
            priceCents: input.priceCents ?? null,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
            idempotencyKey: input.idempotencyKey,
            actorAdminId: admin.id,
          },
        });
        await platformAudit(
          { adminId: admin.id, storeId, action: "credits.change", reason: input.note, metadata: { ledgerId: created.id, delta: input.credits, reason: input.reason, large } },
          tx,
        );
        return created;
      });
    } catch (error) {
      if (error instanceof CreditNegative) return reply.code(409).send({ error: "o ajuste deixaria o saldo negativo", code: "CREDIT_NEGATIVE_BALANCE" });
      if ((error as { code?: string })?.code === "P2002") {
        const existing = await prisma.aiCreditLedger.findUnique({ where: { storeId_idempotencyKey: { storeId, idempotencyKey: input.idempotencyKey } } });
        if (existing) return reply.code(200).send({ entry: ledgerView(existing), balance: await balanceOf(storeId), idempotent: true });
      }
      throw error;
    }

    // Avisos (não derrubam a concessão): OWNER da loja e, se configurado, o responsável da plataforma.
    const mail = { storeName: store.name, credits: input.credits, reason: input.reason, note: input.note, externalRef: input.externalRef, actor: admin.email };
    const ownerEmail = store.users[0]?.email;
    if (ownerEmail) void sendCreditChangeEmail({ ...mail, to: ownerEmail, audience: "owner" }).catch(() => {});
    const alertTo = process.env.PLATFORM_ALERT_EMAIL;
    if (alertTo) void sendCreditChangeEmail({ ...mail, to: alertTo, audience: "platform" }).catch(() => {});

    return reply.code(201).send({ entry: ledgerView(entry), balance: await balanceOf(storeId), large });
  });
};

export default platformRoutes;
