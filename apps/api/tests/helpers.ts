import { prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";

export function makeApp() {
  return buildApp();
}

// Limpa todas as tabelas entre testes (ordem respeita FKs). Só roda contra meucardapio_test
// (ver vitest.config.ts) — nunca o banco de dev/produção.
export async function resetDb() {
  await prisma.$transaction([
    prisma.orderStatusHistory.deleteMany(),
    prisma.orderItemAdditional.deleteMany(),
    prisma.orderItem.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.order.deleteMany(),
    prisma.cashMovement.deleteMany(),
    prisma.cashSession.deleteMany(),
    prisma.productAdditional.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.coupon.deleteMany(),
    prisma.deliverer.deleteMany(),
    prisma.deviceToken.deleteMany(),
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

export async function registerStore(
  app: ReturnType<typeof makeApp>,
  overrides: Partial<{ storeName: string; slug: string; code: string; email: string; password: string }> = {},
) {
  storeSeq += 1;
  const body = {
    storeName: overrides.storeName ?? `Loja Teste ${storeSeq}`,
    slug: overrides.slug ?? `loja-teste-${storeSeq}`,
    code: overrides.code ?? `C${storeSeq}`,
    email: overrides.email ?? `dono${storeSeq}@teste.com`,
    password: overrides.password ?? "senha123",
  };
  const response = await app.inject({ method: "POST", url: "/auth/register", payload: body });
  // Diagnóstico do flake de cadastro (QA-14): se vier 5xx ou 429, registra o corpo para achar a causa.
  if (response.statusCode >= 500 || response.statusCode === 429) console.error("[registerStore] resposta inesperada", response.statusCode, response.body.slice(0, 300));
  const cookie = (response.headers["set-cookie"] as string | undefined)?.split(";")[0];
  return { response, cookie, credentials: body };
}

export async function login(app: ReturnType<typeof makeApp>, email: string, password: string) {
  const response = await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
  const cookie = (response.headers["set-cookie"] as string | undefined)?.split(";")[0];
  return { response, cookie };
}
