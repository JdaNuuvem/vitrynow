import { createHash, timingSafeEqual } from "node:crypto";
import { Prisma, prisma } from "@meucardapio/db";
import { nanoid } from "nanoid";
import { hashToken } from "./tokenHash";
import { utc } from "./sqlTime";

// SEC-28 (ST-58): o "esqueci a senha" não pode ser uma metralhadora de e-mails contra uma conta (esgota a cota do provedor, que também entrega
// o código de MFA e o aviso de login, e queima a reputação do domínio) nem acumular tokens válidos. Regras POR CONTA, no banco (valem entre
// instâncias e reinícios), silenciosas: a resposta da rota é sempre a mesma.
export const RESET_MAX_PER_HOUR = 3;
// SEC-28b (ST-65): pedido cujo e-mail NÃO saiu (provedor fora do ar, sem chave) não gasta a cota de 3/hora nem o intervalo de 60 s: a pessoa
// tenta de novo logo. O teto de TENTATIVAS (enviadas ou não) por hora impede que isso vire metralhadora contra o provedor.
export const RESET_MAX_ATTEMPTS_PER_HOUR = 8;
export const RESET_COOLDOWN_MS = 60_000;
export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const NOBODY = "-"; // id que nunca existe: as consultas da conta inexistente têm a mesma forma, e voltam vazias

export type ResetIssue = { id: string; to: string; token: string };

// Devolve o token novo (e o e-mail do dono) ou `null` quando NÃO se deve enviar nada: conta inexistente, 3 pedidos na última hora,
// ou pedido a menos de 60 s do anterior. Ao emitir um token novo, os anteriores ainda válidos são INVALIDADOS (um só ativo por conta).
// O lock da conta (sem espera) serializa pedidos simultâneos: 20 pedidos ao mesmo tempo ⇒ no máximo 1 emissão.
//
// SEC-28b (ST-64): conta existente, inexistente e limitada executam a MESMA sequência de instruções no banco (lock, leitura da última
// hora, invalidação, inserção) na mesma transação; só muda se a invalidação e a inserção afetam linhas. Antes, a conta inexistente fazia
// 1 consulta e a existente 4 a 5 idas ao banco: com o banco em outro host, a diferença passava do piso de duração e revelava a conta.
export async function issueResetToken(email: string, now: Date = new Date()): Promise<ResetIssue | null> {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  const subjectId = user?.id ?? NOBODY;
  return prisma.$transaction(async (tx) => {
    // Lock consultivo da conta SEM esperar: se outro pedido da mesma conta está emitindo agora, este é descartado em silêncio. Esperar
    // seguraria uma conexão do pool por pedido (rajada contra uma conta = esgotar o pool) e a resposta já é a mesma de qualquer forma.
    // Conta inexistente: a instrução roda igual (mesma ida ao banco) com chave CONSTANTE (o e-mail digitado não entra no hashtext de 32 bits);
    // como o lock não espera, a chave não muda o resultado.
    const lockKey = user ? `pwreset:${user.id}` : "pwreset:none";
    const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS ok`;
    const recent = await tx.passwordResetToken.findMany({
      where: { userId: subjectId, createdAt: { gte: new Date(now.getTime() - HOUR_MS) } },
      select: { createdAt: true, sendFailedAt: true },
      orderBy: { createdAt: "desc" },
    });
    // Pedido cujo envio falhou é "devolvido": não conta na cota nem no intervalo (só no teto de tentativas).
    const delivered = recent.filter((row) => row.sendFailedAt === null);
    const allowed =
      !!user &&
      !!lock?.ok &&
      delivered.length < RESET_MAX_PER_HOUR &&
      recent.length < RESET_MAX_ATTEMPTS_PER_HOUR &&
      !(delivered[0] && now.getTime() - delivered[0].createdAt.getTime() < RESET_COOLDOWN_MS);
    const token = nanoid(32);
    const tokenHash = hashToken(token);
    const expiresAt = new Date(now.getTime() + RESET_TOKEN_TTL_MS);
    const id = nanoid(25); // createdAt gravado explícito (UTC, como o motor do Prisma faria): não depender do fuso da sessão do banco
    // Mesmas duas instruções em todos os caminhos: quando não pode emitir, a invalidação não casa nenhuma linha e a inserção grava zero.
    await tx.passwordResetToken.updateMany({ where: allowed ? { userId: subjectId, usedAt: null, expiresAt: { gt: now } } : { id: NOBODY }, data: { expiresAt: now } });
    await tx.$executeRaw`INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "expiresAt", "createdAt") SELECT ${id}, ${subjectId}, ${tokenHash}, ${utc(expiresAt)}, ${utc(now)} WHERE ${allowed}::boolean`; // SEC-32 (ST-77): Date em SQL cru sempre por utc()
    return allowed && user ? { id, to: user.email, token } : null;
  }, { maxWait: 10_000, timeout: 15_000 }); // espera por conexão do pool em rajada; a transação em si é de poucos ms
}

// SEC-28b (ST-65): o envio falhou depois de a resposta sair; o token fica marcado e a tentativa deixa de gastar a cota de 3/hora.
export async function markResetSendFailed(id: string): Promise<void> {
  await prisma.passwordResetToken.updateMany({ where: { id, usedAt: null, sendFailedAt: null }, data: { sendFailedAt: new Date() } });
}

// ST-57 (oráculo de existência por TEMPO): conta existente = lock + INSERT; inexistente = só um SELECT; e o envio do e-mail leva centenas de
// ms. Por isso a rota (1) NÃO espera o envio e (2) nunca responde antes de um piso de duração, igual para existente, inexistente e limitado.
// SEC-28b (ST-64): 350 ms cobre o p99 do caminho mais lento (lock + 3 instruções + commit) com o banco FORA da máquina da API; a suposição
// "banco na mesma rede" e a regra de revisão do piso estão em docs/forgot-password-tempo.md.
export const FORGOT_MIN_DURATION_MS = 350;

// SEC-33: quando o trabalho JÁ passou do piso (`remaining <= 0`) o piso deixou de mascarar e o tempo volta a revelar o caminho. Isso é sinal de
// operação (banco lento, CPU saturada, piso curto para a topologia): conta em `floorExceeded` e registra o aviso `<rota>_floor_exceeded` com o tempo
// gasto e o piso (sem e-mail nem conta), no máximo 1 por minuto por rota para não virar ruído sob carga.
export type FloorRoute = "forgot" | "reset";
export const floorExceeded: Record<FloorRoute, number> = { forgot: 0, reset: 0 };
const lastFloorWarn: Record<FloorRoute, number> = { forgot: 0, reset: 0 };
const FLOOR_WARN_EVERY_MS = 60_000;
export function resetFloorStats() {
  floorExceeded.forgot = floorExceeded.reset = 0;
  lastFloorWarn.forgot = lastFloorWarn.reset = 0;
}

export async function padToMinimum(startedAt: number, minMs: number = FORGOT_MIN_DURATION_MS, route: FloorRoute = "forgot"): Promise<void> {
  const elapsed = performance.now() - startedAt;
  const remaining = minMs - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
    return;
  }
  floorExceeded[route] += 1;
  const now = Date.now();
  if (now - lastFloorWarn[route] >= FLOOR_WARN_EVERY_MS) {
    lastFloorWarn[route] = now;
    console.warn(`[${route}_floor_exceeded] a resposta passou do piso de tempo: ${Math.round(elapsed)} ms > ${minMs} ms (total no processo: ${floorExceeded[route]}); revisar docs/forgot-password-tempo.md`);
  }
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


// Gancho de TESTE: atrasar um pedido entre a leitura do token e o UPDATE que decide, para reproduzir a rajada do ST-68 sem depender de
// sorte. ST-69: "indefinido em produção" não pode ser só convenção. Fora de NODE_ENV=test o objeto nasce CONGELADO (ninguém o define) e a
// rota nem o consulta; e o gancho não recebe dado nenhum (o e-mail digitado nunca chega a código de terceiros).
export type ResetHooks = { beforeClaim?: () => Promise<void> };

export function makeResetHooks(nodeEnv: string | undefined): ResetHooks {
  return nodeEnv === "test" ? {} : Object.freeze({});
}

export const resetHooks: ResetHooks = makeResetHooks(process.env.NODE_ENV);

export async function runBeforeClaimHook(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  await resetHooks.beforeClaim?.();
}
