import { vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { activateSubscription } from "../src/lib/subscription";
import { sendMfaCodeEmail } from "../src/lib/email";
import { bcryptPasswordHasher } from "../src/shared/passwordHasher";
import { buildApp } from "../src/app";
import { encryptSecret } from "../src/lib/paymentCrypto";
import { setGatewayMaker } from "../src/modules/storePayments/gateway";
import type { PixGateway } from "../src/lib/mercadopago";
import { assertSafeToReset } from "./dbGuard";

// NG-16: o token do pedido só existe na resposta da criação. Os testes que depois consultam/cancelam como cliente
// precisam dele: este gancho (SÓ no app de teste, nunca em produção) guarda o token de cada pedido criado.
const orderTokens = new Map<string, string>();

export function orderTokenHeader(orderId: string): Record<string, string> {
  const token = orderTokens.get(orderId);
  return token ? { "x-order-token": token } : {};
}

export function orderTokenOf(orderId: string): string | undefined {
  return orderTokens.get(orderId);
}

export function makeApp() {
  const app = buildApp();
  app.addHook("onSend", async (request, reply, payload) => {
    if (request.method === "POST" && reply.statusCode === 201 && /^\/stores\/[^/]+\/orders$/.test(request.url.split("?")[0]) && typeof payload === "string") {
      try {
        const body = JSON.parse(payload) as { orderId?: string; token?: string };
        if (body.orderId && body.token) orderTokens.set(body.orderId, body.token);
      } catch {
        // resposta que não é JSON: nada a guardar
      }
    }
    return payload;
  });
  return app;
}

// Limpa todas as tabelas entre testes (ordem respeita FKs). Só roda contra meucardapio_test
// (ver vitest.config.ts) — nunca o banco de dev/produção.
// API-48b: tabelas filhas têm `storeId` próprio (FK composta com o pai). Para os testes que criam linhas filhas direto no banco.
export const orderStore = async (orderId: string) => (await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { storeId: true } })).storeId;
export const productStore = async (productId: string) => (await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { storeId: true } })).storeId;

export async function resetDb() {
  // INF-16: antes do primeiro DELETE, confere a URL e pergunta ao servidor em que banco ele está (recusa se não for _test).
  await assertSafeToReset({
    currentDatabase: async () => (await prisma.$queryRaw<{ db: string }[]>`select current_database() as db`)[0].db,
  });
  // API-25: o livro-razão e a auditoria da plataforma são imutáveis (trigger recusa DELETE); a limpeza de TESTE usa TRUNCATE.
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AiCreditLedger", "PlatformAuditLog"');
  await prisma.$transaction([
    prisma.platformAdmin.deleteMany(),
    prisma.orderStatusHistory.deleteMany(),
    prisma.orderItemAdditional.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.receiptPayment.deleteMany(),
    prisma.order.deleteMany(),
    prisma.receipt.deleteMany(),
    prisma.cashMovement.deleteMany(),
    prisma.cashSession.deleteMany(),
    prisma.productAdditional.deleteMany(),
    prisma.option.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.coupon.deleteMany(),
    prisma.deliverer.deleteMany(),
    prisma.deviceToken.deleteMany(),
    prisma.revokedSession.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.mfaChallenge.deleteMany(),
    prisma.noticeRead.deleteMany(),
    prisma.notice.deleteMany(),
    prisma.subscriptionPayment.deleteMany(),
    prisma.subscription.deleteMany(),
    prisma.user.deleteMany(),
    prisma.store.deleteMany(),
  ]);
}

let storeSeq = 0;

/**
 * API-07 (P-1): o checkout cria/consulta/cancela/estorna PIX pelo gateway DA LOJA. Os testes antigos de pedido/webhook controlam o provedor
 * mockando as 4 funções de `lib/mercadopago` (`vi.fn`); esta ponte aponta o gateway de loja para ESSAS MESMAS funções, então as
 * asserções delas (chamadas, idempotência, erros) continuam valendo sem reescrita. Chame no `beforeEach` do arquivo que mocka o módulo.
 */
export function useMockedProvider(mp: PixGateway) {
  setGatewayMaker(() => ({
    createPixPayment: (input) => mp.createPixPayment(input),
    getPayment: (id) => mp.getPayment(id),
    findByExternalReference: (ref) => mp.findByExternalReference(ref),
    cancelPayment: (id) => mp.cancelPayment(id),
    refundPayment: (id, key) => mp.refundPayment(id, key),
  }));
}

/**
 * API-07 (G3): sem conta do Mercado Pago CONECTADA a loja não vende PIX (409 PIX_UNAVAILABLE). Conecta uma conta FAKE direto no banco
 * (tokens cifrados como em produção; o gateway fake não fala com a rede). `registerStore` já a conecta por padrão, para os testes de
 * pedido/PIX de outros donos continuarem exercitando o PIX; passe `{ pix: false }` para testar a loja SEM conta.
 */
export async function connectPixAccount(storeId: string, seller = `vendedor-${storeId.slice(-6)}`) {
  const ctx = (field: string) => ({ storeId, provider: "mercadopago", field });
  return prisma.paymentAccount.create({
    data: {
      storeId,
      sellerUserId: seller,
      status: "CONNECTED",
      accessTokenEnc: encryptSecret(`fake-access-${seller}`, ctx("accessToken")),
      refreshTokenEnc: encryptSecret(`fake-refresh-${seller}`, ctx("refreshToken")),
      expiresAt: new Date(Date.now() + 90 * 24 * 3_600_000),
    },
  });
}

export async function registerStore(
  app: ReturnType<typeof makeApp>,
  overrides: Partial<{ storeName: string; slug: string; code: string; email: string; password: string; pix: boolean; unverified: boolean; plan: "BASICO" | "PRO" }> = {},
) {
  storeSeq += 1;
  const body = {
    storeName: overrides.storeName ?? `Loja Teste ${storeSeq}`,
    slug: overrides.slug ?? `loja-teste-${storeSeq}`,
    code: overrides.code ?? `C${storeSeq}`,
    email: overrides.email ?? `dono${storeSeq}@teste.com`,
    password: overrides.password ?? "senha12345",
  };
  const response = await app.inject({ method: "POST", url: "/auth/register", payload: body });
  // Diagnóstico do flake de cadastro (QA-14): se vier 5xx ou 429, registra o corpo para achar a causa.
  if (response.statusCode >= 500 || response.statusCode === 429) console.error("[registerStore] resposta inesperada", response.statusCode, response.body.slice(0, 300));
  // API-26: os testes partem de dono com e-mail JÁ verificado (o portão de assinatura exige); `unverified: true` testa o caminho novo.
  if (response.statusCode === 201 && !overrides.unverified) await prisma.user.updateMany({ where: { email: body.email }, data: { emailVerifiedAt: new Date() } });
  const cookie = (response.headers["set-cookie"] as string | undefined)?.split(";")[0];
  if (overrides.pix !== false && response.statusCode === 201) {
    const storeId = (JSON.parse(response.body) as { store?: { id?: string } }).store?.id;
    if (storeId) await connectPixAccount(storeId);
  }
  // API-08 (lote 1): a loja de teste nasce em PRO, pois `multi_user` e trancado no BASICO (402); `plan: "BASICO"` testa os limites.
  if (overrides.plan !== "BASICO" && response.statusCode === 201) {
    const sid = (JSON.parse(response.body) as { store?: { id?: string } }).store?.id;
    if (sid) await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow({ where: { storeId: sid } })).id, planCode: "PRO" });
  }
  return { response, cookie, credentials: body };
}

export async function login(app: ReturnType<typeof makeApp>, email: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  const cookie = (response.headers["set-cookie"] as string | undefined)?.split(";")[0];
  return { response, cookie };
}


// ---- API-25: back-office. Os testes que usam estes helpers precisam mockar `../src/lib/email` (sendMfaCodeEmail como vi.fn). ----
let adminSeq = 0;

export async function createPlatformAdmin(role: "ADMIN" | "SUPPORT" = "ADMIN", overrides: Partial<{ email: string; password: string }> = {}) {
  adminSeq += 1;
  const email = overrides.email ?? `equipe${adminSeq}@plataforma.teste`;
  const password = overrides.password ?? "senha-da-equipe-12345";
  const admin = await prisma.platformAdmin.create({ data: { email, passwordHash: await bcryptPasswordHasher.hash(password, "test"), role } });
  return { admin, email, password };
}

function lastMfaCode(): string {
  return vi.mocked(sendMfaCodeEmail).mock.calls.at(-1)![0].code;
}

/** Entra no back-office (senha + código por e-mail) e devolve o cookie da sessão da equipe. */
export async function platformLogin(app: ReturnType<typeof makeApp>, email: string, password: string) {
  const step1 = await app.inject({ method: "POST", url: "/api/platform/auth/login", payload: { email, password } });
  if (step1.statusCode !== 202) return { step1, cookie: undefined as string | undefined };
  const { challengeId } = JSON.parse(step1.body) as { challengeId: string };
  const step2 = await app.inject({ method: "POST", url: "/api/platform/auth/verify", payload: { challengeId, code: lastMfaCode() } });
  return { step1, step2, cookie: (step2.headers["set-cookie"] as string | undefined)?.split(";")[0] };
}

/** Comprovante de uso único para conceder créditos (pede o código, verifica e devolve o id do desafio). */
export async function platformCreditProof(app: ReturnType<typeof makeApp>, cookie: string) {
  const created = await app.inject({ method: "POST", url: "/api/platform/mfa/challenge", headers: { cookie }, payload: { purpose: "platform_credit_grant" } });
  const { challengeId } = JSON.parse(created.body) as { challengeId: string };
  await app.inject({ method: "POST", url: "/api/platform/mfa/verify", headers: { cookie }, payload: { challengeId, code: lastMfaCode() } });
  return challengeId;
}
