// QA-26 (Deming) — API-12b: o cancelamento agora toma o lock COMPARTILHADO da loja DEPOIS de travar linhas do pedido/job; a virada
// de modo segura o lock EXCLUSIVO e atualiza as mesmas linhas na reconciliação. Ordem de travas oposta = risco de DEADLOCK (40P01 ⇒ 500).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});


describe("QA-26 cancelamento × virada de modo (deadlock)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  const json = (r: { body: string }) => JSON.parse(r.body);

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId: store.id } });
    const created = await app.inject({ method: "POST", url: `/stores/${store.slug}/orders`, payload: { type: "BALCAO", items: [{ productId, quantity: 1 }] } });
    expect(created.statusCode, created.body).toBe(201);
    return { cookie: cookie!, storeId: store.id, ownerId: owner.id, orderId: json(created).orderId as string };
  }

  const cenarios: { nome: string; modoInicial: "LEGACY" | "QUEUE"; alvo: "LEGACY" | "QUEUE"; pedidoImpresso: boolean; jobStatus: "PENDING" | "PRINTED" }[] = [
    { nome: "R1b: LEGACY→QUEUE com pedido impresso e job PENDING (a virada fecha o job)", modoInicial: "LEGACY", alvo: "QUEUE", pedidoImpresso: true, jobStatus: "PENDING" },
    { nome: "R2: QUEUE→LEGACY com job PRINTED e pedido sem printedAt (a virada marca o pedido)", modoInicial: "QUEUE", alvo: "LEGACY", pedidoImpresso: false, jobStatus: "PRINTED" },
  ];

  for (const c of cenarios) {
    it(`${c.nome}: 30 rodadas de cancelamento CONCORRENTE com a virada, sem 5xx nem deadlock`, async () => {
      const { printModeService } = await import("../../src/modules/printJobs/printJobs.module");
      const ctx = await setup();
      const offsets = [0, 3, 6, 10, 15, 25];
      const resumo: Record<string, number> = {};
      for (let i = 0; i < 30; i++) {
        await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: c.modoInicial } });
        await prisma.order.update({ where: { id: ctx.orderId }, data: { status: "PENDENTE", printedAt: c.pedidoImpresso ? new Date() : null } });
        await prisma.printJob.deleteMany({ where: { orderId: ctx.orderId, kind: "ORDER_CANCEL_NOTICE" } });
        await prisma.printJob.updateMany({ where: { orderId: ctx.orderId, kind: "ORDER_KITCHEN" }, data: { status: c.jobStatus, printedAt: c.jobStatus === "PRINTED" ? new Date() : null, claimedByTokenId: null, leaseUntil: null, attempts: 0 } });
        const atraso = offsets[i % offsets.length];
        const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
        const cancelFirst = i % 2 === 0;
        const cancelar = () => app.inject({ method: "POST", url: `/api/orders/${ctx.orderId}/cancel`, headers: { cookie: ctx.cookie }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
        const virar = () => printModeService.set({ storeId: ctx.storeId, userId: ctx.ownerId }, c.alvo).then(() => "ok", (e: { code?: string; message?: string }) => e.code ?? e.message ?? "erro");
        const [rc, rv] = await Promise.all([cancelFirst ? cancelar() : dorme(atraso).then(cancelar), cancelFirst ? dorme(atraso).then(virar) : virar()]);
        const chave = `cancel=${rc.statusCode} virar=${rv}`;
        resumo[chave] = (resumo[chave] ?? 0) + 1;
        expect(rc.statusCode, `rodada ${i} (${chave}): ${rc.body.slice(0, 160)}`).toBeLessThan(500);
        expect(rv, `rodada ${i}: a virada não pode falhar com deadlock/erro`).toBe("ok");
        // (sem checar o aviso aqui: cancelamento que termina ANTES da virada, ainda em LEGACY, legitimamente não gera aviso; o caso
        // determinístico do aviso é o teste do Turing)
      }
      console.log("QA-26", c.nome.slice(0, 4), JSON.stringify(resumo));
    }, 240000);
  }
});
