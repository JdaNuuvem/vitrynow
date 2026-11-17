import type { FastifyPluginAsync } from "fastify";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { prisma } from "@meucardapio/db";
import { loginSchema, registerStoreSchema, forgotPasswordSchema,
  inspectResetTokenSchema, resetPasswordSchema } from "@meucardapio/shared-types";
import { maskEmail, sendLoginAlertEmail, sendPasswordResetEmail } from "../lib/email";
import { newTrialEndsAt } from "../lib/subscription";
import { SESSION_COOKIE, revokeSession, sessionCookieOptions, signSession } from "../lib/session";
import { disconnectSession, disconnectUser } from "../realtime/hub";
import { hashToken } from "../lib/tokenHash";
import { LoginThrottle } from "../lib/loginThrottle";
import { NOW, RESET_FAIL_MIN_DURATION_MS, RESET_MAX_EMAIL_FAILURES, constantTimeEqual, issueResetToken, markResetSendFailed, padToMinimum, runBeforeClaimHook } from "../lib/passwordReset";

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
      const startedAt = performance.now();
      const parsed = forgotPasswordSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      // SEC-28: a emissão do token (por conta: 3/hora, 60 s entre pedidos, um só token ativo) fica em `issueResetToken`; o envio NÃO é
      // esperado (ST-57: esperar o provedor de e-mail revelaria por tempo se a conta existe) e o piso de duração iguala os três caminhos
      // (existente, inexistente, limitado). A resposta é sempre a mesma.
      const issued = await issueResetToken(parsed.data.email);
      if (issued) {
        // O token vai no FRAGMENTO (#), que o navegador nunca envia ao servidor: não aparece em log de acesso, de erro do proxy,
        // nem no Referer. A página lê, apaga da barra de endereço e manda no corpo do POST.
        const resetUrl = `${process.env.WEB_ORIGIN ?? "http://localhost:3000"}/reset-senha#token=${issued.token}`;
        // ST-65: o envio que não saiu (retorno `false`, ou exceção) devolve a tentativa: o token é marcado e deixa de gastar a cota de 3/hora.
        const giveBack = () => markResetSendFailed(issued.id).catch(() => console.error(`[email] não consegui devolver a tentativa de recuperação de ${maskEmail(issued.to)}`));
        void sendPasswordResetEmail({ to: issued.to, resetUrl })
          .then((sent) => (sent === false ? giveBack() : undefined))
          .catch((error: unknown) => {
            console.error(`[email] falha ao enviar recuperação de senha para ${maskEmail(issued.to)}: ${error instanceof Error ? error.name : "erro"}`);
            return giveBack();
          });
      }
      await padToMinimum(startedAt);

      return { ok: true };
    },
  );

  // SEC-29 (ST-63): quem abre o link vê DE QUAL CONTA é o token (e-mail mascarado) ANTES de digitar a senha nova. Sem isto, um atacante
  // pede a redefinição da conta DELE e manda à vítima o link; a vítima digita a senha que reutiliza e o atacante a lê ao entrar.
  // NÃO consome o token. Resposta idêntica para inválido, expirado, usado, inexistente e corpo malformado (nada de motivo).
  app.post(
    "/auth/reset-password/inspect",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      reply.header("Cache-Control", "no-store");
      const parsed = inspectResetTokenSchema.safeParse(request.body);
      if (!parsed.success) return { valid: false };
      const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
      if (!resetToken || resetToken.usedAt || resetToken.expiresAt < new Date()) return { valid: false };
      const user = await prisma.user.findUnique({ where: { id: resetToken.userId }, select: { email: true } });
      if (!user) return { valid: false };
      return { valid: true, email: maskEmail(user.email) };
    },
  );

  app.post(
    "/auth/reset-password",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const startedAt = performance.now();
      const parsed = resetPasswordSchema.safeParse(request.body);
      if (!parsed.success) {
        // Pedido SEM e-mail (ou com e-mail malformado) vindo de um bundle antigo em cache do navegador: a MESMA recusa genérica e o mesmo piso de
        // tempo das demais (o servidor nunca trata o e-mail como opcional). Qualquer outro problema do corpo (senha curta, token ausente) segue
        // com o erro de validação, que não depende do token e por isso não é oráculo.
        const onlyEmail = parsed.error.issues.length > 0 && parsed.error.issues.every((issue) => issue.path[0] === "email");
        if (onlyEmail) {
          await padToMinimum(startedAt, RESET_FAIL_MIN_DURATION_MS);
          return reply.code(400).send({ error: "token inválido ou expirado" });
        }
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      // SEC-29 (ST-67): além do token, quem redefine DIGITA o e-mail da conta, comparado AQUI com o da conta do token. Sem isto, o link da
      // conta de um atacante, mandado à vítima, redefinia a conta DELE com a senha que a vítima reutiliza.
      // Três recusas (token inexistente/usado/vencido, e-mail que não bate, token de outra conta) têm o MESMO status, o MESMO corpo e o
      // MESMO trabalho no banco (3 consultas, na mesma ordem) e o MESMO piso de tempo; o token NUNCA é gasto quando o e-mail não bate.
      const resetToken = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(parsed.data.token) } });
      const owner = await prisma.user.findUnique({ where: { id: resetToken?.userId ?? "-" }, select: { email: true } });
      const sameEmail = constantTimeEqual(parsed.data.email, owner?.email ?? "");
      // Gancho só de TESTE (ST-69: honrado só com NODE_ENV=test, sem receber dado): deixa um teste atrasar o pedido entre a leitura de cima
      // e o UPDATE, para provar que a decisão não depende da leitura velha.
      await runBeforeClaimHook();

      // ST-68: a DECISÃO sai NO BANCO, numa instrução só, com o relógio do banco. Lê-la antes (live/sameEmail em memória) deixava uma rajada
      // paralela ver o token "vivo" antes de qualquer falha ser gravada: um palpite certo passava mesmo depois de 5 falhas, e duas
      // requisições certas simultâneas usavam o token 2×. O UPDATE trava a linha; quem chega depois reavalia o WHERE já com o resultado dos
      // anteriores. (a) e-mail certo: marca `usedAt` (consome o token); (b) e-mail errado: soma a falha e, na 5ª, invalida o token.
      // Para token que não existe, a mesma instrução roda sobre 0 linhas (mesmo trabalho em todos os ramos).
      const outcome = await prisma.$transaction(async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          UPDATE "PasswordResetToken"
             SET "usedAt" = CASE WHEN ${sameEmail}::boolean THEN ${NOW} ELSE "usedAt" END,
                 "emailFailures" = CASE WHEN ${sameEmail}::boolean THEN "emailFailures" ELSE "emailFailures" + 1 END,
                 "expiresAt" = CASE WHEN NOT ${sameEmail}::boolean AND "emailFailures" + 1 >= ${RESET_MAX_EMAIL_FAILURES} THEN ${NOW} ELSE "expiresAt" END
           WHERE "id" = ${resetToken?.id ?? "-"} AND "usedAt" IS NULL AND "expiresAt" >= ${NOW} AND "emailFailures" < ${RESET_MAX_EMAIL_FAILURES}
          RETURNING "id"`;
        if (claimed.length !== 1 || !sameEmail || !resetToken) return null;
        // O bcrypt só roda DEPOIS de o banco ter dado o token a este pedido: nenhuma recusa o paga, então o tempo de uma recusa não revela
        // que o e-mail estava certo (token morto + e-mail certo seria mais lento que as outras). Dentro da transação: a troca de senha e o
        // consumo do token continuam atômicos, e quem esperava a linha só segue depois do COMMIT.
        const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);
        // Na MESMA transação do consumo do token: se a troca da senha falhar, o token volta a valer (nada de token queimado sem senha nova).
        // tokenVersion+1: redefinir a senha derruba todas as sessões abertas (token roubado inclusive).
        await tx.user.update({ where: { id: resetToken.userId }, data: { passwordHash, tokenVersion: { increment: 1 } } });
        return resetToken.userId;
      });
      if (!outcome || !resetToken) {
        await padToMinimum(startedAt, RESET_FAIL_MIN_DURATION_MS);
        return reply.code(400).send({ error: "token inválido ou expirado" });
      }

      disconnectUser(outcome);
      return { ok: true };
    },
  );
};

export default authRoutes;
