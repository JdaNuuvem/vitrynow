// API-52d (RN-PV-06, ADR-0014): lista de "não contatar" por HASH do telefone, por loja; sobrevive à anonimização; falha fechada sem sal.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { isDoNotContact, phoneHash } from "../src/modules/privacy/doNotContact";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/email", () => ({ sendPasswordResetEmail: vi.fn(), sendMfaCodeEmail: vi.fn() }));
vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const PHONE = "11987654321";
const SENHA = "senha12345";

describe("privacidade: não contatar por hash", { timeout: 60_000 }, () => {
  let app: ReturnType<typeof makeApp>;
  let seq = 0;
  beforeEach(async () => {
    process.env.PRIVACY_ACTIONS_ENABLED = "true";
    process.env.PRIVACY_HASH_SALT = "sal-de-teste-0123456789";
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    delete process.env.PRIVACY_ACTIONS_ENABLED;
    delete process.env.PRIVACY_HASH_SALT;
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  async function mkStore() {
    const { cookie, response } = await registerStore(app);
    return { owner: cookie!, storeId: json(response).store.id as string };
  }
  async function mk(storeId: string, phone = PHONE) {
    seq += 1;
    await prisma.order.create({ data: { storeId, code: `D${String(seq).padStart(4, "0")}`, type: "DELIVERY", status: "CONCLUIDO", customerName: "Maria", customerPhone: phone, address: "Rua A", totalCents: 1000, subtotalCents: 1000 } });
  }
  const anon = (cookie: string, phone: string, n: number) =>
    app.inject({ method: "POST", url: "/api/privacy/anonymize", headers: { cookie }, payload: { phone, reason: "HOLDER_REQUEST", expectedOrders: n, currentPassword: SENHA } });

  it("anonimizar grava só o HASH (nunca o número), uma vez por telefone, e o telefone passa a ser 'não contatar' naquela loja", async () => {
    const a = await mkStore();
    await mk(a.storeId);
    await mk(a.storeId, "(11) 98765-4321"); // mesmo titular, outra formatação
    expect((await anon(a.owner, PHONE, 2)).statusCode).toBe(200);
    const rows = await prisma.doNotContact.findMany({ where: { storeId: a.storeId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ phoneHash: phoneHash(PHONE), reason: "ANONYMIZED" });
    expect(JSON.stringify(rows)).not.toContain("98765");
    expect(await isDoNotContact(prisma, a.storeId, "+55 11 98765-4321")).toBe(true);
    expect(await isDoNotContact(prisma, a.storeId, "11911112222")).toBe(false);
  });

  it("isolamento: vale por loja (a loja B não é afetada)", async () => {
    const a = await mkStore();
    const b = await mkStore();
    await mk(a.storeId);
    await anon(a.owner, PHONE, 1);
    expect(await isDoNotContact(prisma, b.storeId, PHONE)).toBe(false);
  });

  it("falha fechada: sem o sal da plataforma a anonimização é recusada (503) e NADA é alterado", async () => {
    const a = await mkStore();
    await mk(a.storeId);
    delete process.env.PRIVACY_HASH_SALT;
    const r = await anon(a.owner, PHONE, 1);
    expect(r.statusCode).toBe(503);
    expect(json(r).code).toBe("PRIVACY_NOT_CONFIGURED");
    expect(await prisma.order.count({ where: { storeId: a.storeId, anonymizedAt: { not: null } } })).toBe(0);
    expect(await prisma.doNotContact.count()).toBe(0);
    await expect(isDoNotContact(prisma, a.storeId, PHONE)).rejects.toThrow();
  });

  it("sal diferente ⇒ hash diferente (o hash não é reversível sem o sal)", () => {
    const h1 = phoneHash(PHONE);
    process.env.PRIVACY_HASH_SALT = "outro-sal-de-teste-987654";
    expect(phoneHash(PHONE)).not.toBe(h1);
  });
});
