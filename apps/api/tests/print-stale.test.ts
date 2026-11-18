// N6/N8 — janela de retomada de 12 h (STALE), "Imprimir agora" e eventos print.* do painel (RN-IMP-20, CA-IMP-05).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { staleWindowSeconds } from "../src/lib/printJobs";
import { subscribe } from "../src/realtime/hub";
import { makeApp, registerStore, resetDb, useMockedProvider } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";

const HOUR = 3600_000;

describe("N6/N8 — janela de 12 h e eventos de impressão", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    useMockedProvider(mp);
    vi.clearAllMocks();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (r: { body: string }) => JSON.parse(r.body);

  async function setup(slug = "loja-stale", mode: "QUEUE" | "LEGACY" = "QUEUE") {
    const { cookie, response } = await registerStore(app, { slug, code: slug.replace(/[^a-z0-9]/g, "").slice(-8).toUpperCase() });
    const { id: storeId } = json(response).store;
    await prisma.store.update({ where: { id: storeId }, data: { printMode: mode } });
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie!, }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "Balcao" } })).token.token as string;
    return { owner: cookie!, storeId: storeId as string, slug, productId, token };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const order = async (ctx: Ctx, extra: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...extra } });
    expect(res.statusCode, res.body).toBe(201);
    return json(res).orderId as string;
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const claim = (token: string) => app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(token), payload: {} });
  const ack = (token: string, jobId: string, body: Record<string, unknown>) => app.inject({ method: "POST", url: `/api/device/print-jobs/${jobId}/ack`, headers: bearer(token), payload: body });
  const printNow = (cookie: string, jobId: string) => app.inject({ method: "POST", url: `/api/print-jobs/${jobId}/print-now`, headers: { cookie } });
  const summary = (cookie?: string) => app.inject({ method: "GET", url: "/api/print-jobs/summary", headers: cookie ? { cookie } : {} });
  const jobOf = async (orderId: string) => (await prisma.printJob.findFirstOrThrow({ where: { orderId, kind: "ORDER_KITCHEN" } }));
  const ageJob = (id: string, hours: number) => prisma.printJob.update({ where: { id }, data: { createdAt: new Date(Date.now() - hours * HOUR) } });
  const sockets = (storeId: string, role: "OWNER" | "STAFF" | "DEVICE") => {
    const sent: string[] = [];
    subscribe(storeId, { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() } as never, role);
    return (type: string) => sent.filter((m) => JSON.parse(m).type === type).map((m) => JSON.parse(m));
  };
  async function staffCookie(ctx: Ctx) {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Math.random().toString(36).slice(2, 8)}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  }

  it("a janela padrão é de 12 h e a variável de ambiente a muda", () => {
    expect(staleWindowSeconds()).toBe(12 * 3600);
    process.env.PRINT_STALE_HOURS = "2";
    expect(staleWindowSeconds()).toBe(2 * 3600);
    process.env.PRINT_STALE_HOURS = "lixo";
    expect(staleWindowSeconds()).toBe(12 * 3600);
    delete process.env.PRINT_STALE_HOURS;
  });

  it("CA-IMP-05: PC desligado 3 h ⇒ imprime em ordem de chegada; com mais de 12 h o pedido vira STALE e NÃO sai sozinho (nem some)", async () => {
    const ctx = await setup();
    const velho = await order(ctx);
    const novo1 = await order(ctx);
    const novo2 = await order(ctx);
    await ageJob((await jobOf(velho)).id, 13);
    await ageJob((await jobOf(novo1)).id, 3);
    await ageJob((await jobOf(novo2)).id, 2.99);
    const owner = sockets(ctx.storeId, "OWNER");

    const first = json(await claim(ctx.token)).job;
    expect(first.ticket.orderId).toBe(novo1);
    const afterFirst = await ack(ctx.token, first.id, { status: "PRINTED" });
    expect(afterFirst.statusCode).toBe(200);
    const second = json(await claim(ctx.token)).job;
    expect(second.ticket.orderId).toBe(novo2);
    await ack(ctx.token, second.id, { status: "PRINTED" });
    expect(json(await claim(ctx.token)).job).toBeNull(); // o de 13 h não sai sozinho

    const stale = await jobOf(velho);
    expect(stale.status).toBe("STALE");
    expect(await prisma.order.findUnique({ where: { id: velho } })).not.toBeNull(); // o pedido continua lá
    expect(owner("print.stale")).toEqual([{ type: "print.stale", count: 1 }]);
  });

  it("job de 11 h 59 min ainda é entregue (a borda é a janela, não antes)", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await prisma.printJob.update({ where: { id: (await jobOf(id)).id }, data: { createdAt: new Date(Date.now() - (12 * HOUR - 60_000)) } });
    expect(json(await claim(ctx.token)).job.ticket.orderId).toBe(id);
  });

  it("lease vencida de job já velho vira STALE em vez de voltar à fila", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    const job = json(await claim(ctx.token)).job;
    await prisma.printJob.update({ where: { id: job.id }, data: { createdAt: new Date(Date.now() - 13 * HOUR), leaseUntil: new Date(Date.now() - 5000) } });
    expect(json(await claim(ctx.token)).job).toBeNull();
    expect((await jobOf(id)).status).toBe("STALE");
  });

  it("\"Imprimir agora\": STALE volta à fila (janela recomeça), acorda a impressora, é auditado e imprime; 2 cliques = 1 efeito", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    const job = await jobOf(id);
    await ageJob(job.id, 20);
    await claim(ctx.token); // varre
    expect((await jobOf(id)).status).toBe("STALE");
    const owner = sockets(ctx.storeId, "OWNER");
    const device = sockets(ctx.storeId, "DEVICE");

    const [a, b] = await Promise.all([printNow(ctx.owner, job.id), printNow(ctx.owner, job.id)]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    expect(json(a).job.status === "PENDING" || json(a).job.status === "CLAIMED").toBe(true);
    expect(owner("print.available")).toHaveLength(1);
    expect(device("print.available")).toHaveLength(1);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.print_now", targetId: job.id } })).toBe(1), { timeout: 10_000, interval: 100 }); // auditoria é gravada sem esperar (corrida sob carga)

    const got = json(await claim(ctx.token)).job; // createdAt tem 20 h, mas resumedAt recomeçou a janela
    expect(got.id).toBe(job.id);
    expect(got.attempt).toBe(1);
    expect((await ack(ctx.token, got.id, { status: "PRINTED" })).statusCode).toBe(200);
    expect((await printNow(ctx.owner, job.id)).statusCode).toBe(200); // já impresso: idempotente, sem voltar à fila
    expect((await jobOf(id)).status).toBe("PRINTED");
  });

  it("STAFF também pode imprimir agora um pedido aberto; sem sessão ⇒ 401; outra loja ⇒ 404 idêntico ao inexistente", async () => {
    const a = await setup("loja-a-stale");
    const b = await setup("loja-b-stale");
    const idA = await order(a);
    const jobA = await jobOf(idA);
    await ageJob(jobA.id, 30);
    await claim(a.token);
    const staff = await staffCookie(a);

    expect((await app.inject({ method: "POST", url: `/api/print-jobs/${jobA.id}/print-now` })).statusCode).toBe(401);
    const cross = await printNow(b.owner, jobA.id);
    const missing = await printNow(b.owner, "inexistente");
    expect(cross.statusCode).toBe(404);
    expect(cross.body).toBe(missing.body);
    expect((await jobOf(idA)).status).toBe("STALE"); // a outra loja não mexeu

    expect((await printNow(staff, jobA.id)).statusCode).toBe(200);
    expect((await jobOf(idA)).status).toBe("PENDING");
  });

  it("STAFF e pedido ANTIGO com contato: 403 (mesma regra da 2ª via); o dono pode", async () => {
    const ctx = await setup();
    const id = await order(ctx, { type: "DELIVERY", customerPhone: "11987654321", address: "Rua Sigilosa, 77", customerName: "Ana" });
    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"]) {
      expect((await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: ctx.owner }, payload: { to } })).statusCode, to).toBe(200);
    }
    await prisma.orderStatusHistory.updateMany({ where: { orderId: id }, data: { createdAt: new Date(Date.now() - 48 * HOUR) } });
    const job = await jobOf(id);
    await ageJob(job.id, 48);
    await claim(ctx.token);
    const staff = await staffCookie(ctx);
    expect((await printNow(staff, job.id)).statusCode).toBe(403);
    expect((await jobOf(id)).status).toBe("STALE");
    expect((await printNow(ctx.owner, job.id)).statusCode).toBe(200);
  });

  it("pedido cancelado enquanto STALE: o job vira CANCELED e não volta (409)", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    const job = await jobOf(id);
    await ageJob(job.id, 15);
    await claim(ctx.token);
    expect((await jobOf(id)).status).toBe("STALE");
    expect((await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } })).statusCode).toBeLessThan(300);
    expect((await jobOf(id)).status).toBe("CANCELED");
    const res = await printNow(ctx.owner, job.id);
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toMatch(/ORDER_CANCELED|PRINT_JOB_NOT_STALE/);
  });

  it("loja em LEGACY: imprimir agora é recusado (ninguém consome a fila)", async () => {
    const ctx = await setup("loja-legacy-stale", "LEGACY");
    const id = await order(ctx);
    const res = await printNow(ctx.owner, (await jobOf(id)).id);
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("PRINT_MODE_LEGACY");
  });

  it("GET /api/print-jobs/summary: conta os STALE da PRÓPRIA loja, varre a janela sem impressora conectada e exige sessão", async () => {
    const a = await setup("loja-sum-a");
    const b = await setup("loja-sum-b");
    const x = await jobOf(await order(a));
    const y = await jobOf(await order(a));
    await order(a); // dentro da janela
    await jobOf(await order(b));
    await ageJob(x.id, 13);
    await ageJob(y.id, 40);
    expect((await summary()).statusCode).toBe(401);
    expect(json(await summary(a.owner))).toEqual({ stale: 2 }); // nenhum claim aconteceu: o resumo varre
    expect(json(await summary(b.owner))).toEqual({ stale: 0 });
    expect(json(await summary(a.owner))).toEqual({ stale: 2 }); // idempotente
  });

  it("N8: claim ⇒ print.claimed; ack ⇒ print.printed; falha definitiva ⇒ print.job_failed com código; só o PAINEL recebe (a impressora só print.available)", async () => {
    const ctx = await setup();
    const owner = sockets(ctx.storeId, "OWNER");
    const staff = sockets(ctx.storeId, "STAFF");
    const device = sockets(ctx.storeId, "DEVICE");
    const id1 = await order(ctx);
    const j1 = json(await claim(ctx.token)).job;
    await ack(ctx.token, j1.id, { status: "PRINTED" });
    const id2 = await order(ctx);
    const row2 = await jobOf(id2);
    await prisma.printJob.update({ where: { id: row2.id }, data: { maxAttempts: 1 } });
    const j2 = json(await claim(ctx.token)).job;
    await ack(ctx.token, j2.id, { status: "FAILED", code: "NO_PAPER", error: "sem papel" });

    for (const panel of [owner, staff]) {
      expect(panel("print.claimed").map((m) => m.jobId)).toEqual([j1.id, j2.id]);
      expect(panel("print.printed")).toEqual([{ type: "print.printed", jobId: j1.id, orderId: id1 }]);
      expect(panel("print.job_failed")).toEqual([{ type: "print.job_failed", jobId: j2.id, code: "NO_PAPER" }]);
    }
    expect(device("print.claimed")).toHaveLength(0);
    expect(device("print.printed")).toHaveLength(0);
    expect(device("print.job_failed")).toHaveLength(0);
    expect(device("print.stale")).toHaveLength(0);
    expect(device("print.available").length).toBeGreaterThan(0);
  });
});
