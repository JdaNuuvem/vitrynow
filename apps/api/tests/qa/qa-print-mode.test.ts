// QA-25 (Deming) — API-12b: modo de impressão LEGACY/QUEUE. Sondas independentes das do Turing.
// Todos os casos são it(): as correções da API-12b estão na main (sondas do Deming, movidas para a suíte pelo Turing).
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";
import { subscribe } from "../../src/realtime/hub";

// Estes testes esperam o lock da loja, disputam corridas e preparam banco: sob carga da máquina o tempo total varia de 1 s a 45 s (medido pelo
// Hopper). O limite de 15 s do vitest.config.ts os reprovava por TEMPO, sem violar nenhum invariante. O limite é só deste arquivo e as
// asserções não mudaram (com mais folga, a asserção final é sempre reportada).
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

vi.mock("../../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});


describe("QA-25 modo de impressão (API-12b)", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { vi.clearAllMocks(); app = makeApp(); await app.ready(); });
  afterEach(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS qa_audit_recusa ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS qa_audit_recusa_fn()`);
    await app.close();
    await resetDb();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const json = (r: { body: string }) => JSON.parse(r.body);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC" } })).token.token as string;
    const token2 = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "PC2" } })).token.token as string;
    return { owner: cookie!, storeId: store.id, slug: store.slug, productId, token, token2 };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;
  const novoPedido = async (c: Ctx) => {
    const res = await app.inject({ method: "POST", url: `/stores/${c.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: c.productId, quantity: 1 }] } });
    expect(res.statusCode, res.body).toBe(201);
    return json(res).orderId as string;
  };
  const setMode = (c: Ctx, mode: string) => app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie: c.owner }, payload: { mode } });
  const claim = (token: string) => app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(token), payload: {} });
  const ack = (token: string, id: string) => app.inject({ method: "POST", url: `/api/device/print-jobs/${id}/ack`, headers: bearer(token), payload: { status: "PRINTED" } });
  const legacyPending = async (token: string) => json(await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: bearer(token) })).orders as { id: string }[];
  const legacyPrinted = (token: string, id: string) => app.inject({ method: "POST", url: `/api/device/orders/${id}/printed`, headers: bearer(token) });
  const cancelar = (c: Ctx, id: string) => app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: c.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
  const jobs = (orderId: string) => prisma.printJob.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });

  const gatilhoAuditoria = async (acao: string) => {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION qa_audit_recusa_fn() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'QA: auditoria recusada de proposito'; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER qa_audit_recusa BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW.action = '${acao}') EXECUTE FUNCTION qa_audit_recusa_fn()`);
  };
  const staff = async (c: Ctx) => {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: c.owner }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  };

  it("M1 a auditoria da virada é ATÔMICA (falha injetada no banco): se a linha não grava, o modo NÃO muda e a reconciliação é desfeita", async () => {
    const c = await setup();
    const o = await novoPedido(c);
    await prisma.printJob.deleteMany({ where: { orderId: o } }); // pedido imprimível sem job: a virada para QUEUE criaria o job
    await gatilhoAuditoria("print.mode_change");
    const res = await setMode(c, "QUEUE");
    expect(res.statusCode, res.body).toBeGreaterThanOrEqual(500);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: c.storeId } })).printMode).toBe("LEGACY");
    expect(await jobs(o)).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { storeId: c.storeId, action: "print.mode_change" } })).toBe(0);
  });

  it("M2 STAFF tentando virar o modo: 403, a tentativa fica registrada e, se o rastro falhar, a negativa continua 403 (nunca 500, nunca vira)", async () => {
    const c = await setup();
    const cookie = await staff(c);
    const ok = await app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie }, payload: { mode: "QUEUE" } });
    expect(ok.statusCode).toBe(403);
    const reg = await prisma.auditLog.findMany({ where: { storeId: c.storeId, action: "print.mode_change_denied" } });
    expect(reg).toHaveLength(1);
    await gatilhoAuditoria("print.mode_change_denied");
    const semRastro = await app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie }, payload: { mode: "QUEUE" } });
    expect(semRastro.statusCode).toBe(403);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: c.storeId } })).printMode).toBe("LEGACY");
  });

  it("M3 em LEGACY, cancelar um pedido já impresso NÃO cria job de aviso, mas o evento order.cancel_notice (o aviso do legado) continua saindo", async () => {
    const c = await setup();
    const eventos: string[] = [];
    subscribe(c.storeId, { readyState: 1, OPEN: 1, send: (m: string) => eventos.push(JSON.parse(m).type), on: vi.fn() } as never, "OWNER");
    const o = await novoPedido(c);
    expect((await legacyPrinted(c.token, o)).statusCode).toBe(200);
    expect((await cancelar(c, o)).statusCode).toBe(200);
    expect((await jobs(o)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE")).toHaveLength(0);
    expect(eventos).toContain("order.cancel_notice");
  });

  it("M4 aviso de cancelamento criado em QUEUE e preso pela virada para LEGACY NÃO se perde: continua PENDING e sai quando a loja volta para QUEUE", async () => {
    const c = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const o = await novoPedido(c);
    const cl = json(await claim(c.token)).job;
    expect((await ack(c.token, cl.id)).statusCode).toBe(200);
    expect((await cancelar(c, o)).statusCode).toBe(200);
    expect((await jobs(o)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE" && j.status === "PENDING")).toHaveLength(1);
    expect((await setMode(c, "LEGACY")).statusCode).toBe(200);
    expect(json(await claim(c.token))).toMatchObject({ job: null, mode: "LEGACY" });
    expect((await jobs(o)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE")[0].status).toBe("PENDING");
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    expect(json(await claim(c.token)).job?.kind).toBe("ORDER_CANCEL_NOTICE");
  });

  it("M5 ida e volta sem papel em dobro nem pedido perdido: 1 pedido impresso pela fila, 1 pelo legado, e nenhum dos dois é reimpresso depois das viradas", async () => {
    const c = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const a = await novoPedido(c);
    const ja = json(await claim(c.token)).job;
    expect((await ack(c.token, ja.id)).statusCode).toBe(200); // a: impresso pela fila
    const b = await novoPedido(c); // b: nasce em QUEUE e fica PENDING
    expect((await setMode(c, "LEGACY")).statusCode).toBe(200);
    const lista = (await legacyPending(c.token)).map((x) => x.id);
    expect(lista).toEqual([b]); // só o b; o a (já impresso) não volta
    expect((await legacyPrinted(c.token, b)).statusCode).toBe(200); // b: impresso pelo legado
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    expect(json(await claim(c.token)).job).toBeNull(); // nada sobrou para a fila reimprimir
    const conf = json(await app.inject({ method: "GET", url: "/api/store/print-mode", headers: { cookie: c.owner } })).conference;
    expect(conf).toEqual({ pendingJobOfPrintedOrder: 0, printableOrderWithoutJob: 0, printedJobOfUnprintedOrder: 0 });
  });

  // Item 14 (ADR-0004): recuar para LEGACY com impressão em andamento (job CLAIMED, lease viva) é RECUSADO; antes disso a lista
  // legada de OUTRA impressora enxergava o pedido que a primeira estava imprimindo (impressão em dobro).
  it("M6 virar para LEGACY com um job CLAIMED (lease viva) ⇒ 409 PRINT_IN_PROGRESS, o modo NÃO muda e a lista legada segue vazia; depois do ack (ou da lease vencida) a virada passa", async () => {
    const c = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const o = await novoPedido(c);
    const cl = json(await claim(c.token)).job;
    expect(cl?.kind).toBe("ORDER_KITCHEN");
    const barrado = await setMode(c, "LEGACY");
    expect([barrado.statusCode, json(barrado).code], barrado.body).toEqual([409, "PRINT_IN_PROGRESS"]);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: c.storeId } })).printMode).toBe("QUEUE");
    expect(await legacyPending(c.token2)).toEqual([]);
    expect(await prisma.auditLog.count({ where: { storeId: c.storeId, action: "print.mode_change", metadata: { path: ["to"], equals: "LEGACY" } } })).toBe(0);
    // lease vencida não segura: o cliente que sumiu não trava o recuo de emergência
    await prisma.$executeRawUnsafe(`UPDATE "PrintJob" SET "leaseUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - interval '1 minute' WHERE "orderId" = '${o}'`);
    expect((await setMode(c, "LEGACY")).statusCode).toBe(200);
  });

  it("M6b com o ack do job feito, a virada para LEGACY passa e o pedido NÃO reaparece na lista legada (impresso uma vez só)", async () => {
    const c = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const o = await novoPedido(c);
    const cl = json(await claim(c.token)).job;
    expect((await setMode(c, "LEGACY")).statusCode).toBe(409);
    expect((await ack(c.token, cl.id)).statusCode).toBe(200);
    expect((await setMode(c, "LEGACY")).statusCode).toBe(200);
    expect((await legacyPending(c.token2)).some((x) => x.id === o)).toBe(false);
  });

  it("M7 ack legado TARDIO em QUEUE: job PENDING ⇒ 200 e fecha o job + printedAt (a fila não reimprime); repetir ⇒ 200; CLAIMED vigente ⇒ 409 MODE_QUEUE sem tocar em nada; pedido de OUTRA loja ⇒ 404", async () => {
    const c = await setup();
    const outra = await setup();
    expect((await setMode(c, "QUEUE")).statusCode).toBe(200);
    const o1 = await novoPedido(c);
    const o2 = await novoPedido(c);
    const tardio = await legacyPrinted(c.token, o1);
    expect([tardio.statusCode, json(tardio)], tardio.body).toEqual([200, { ok: true }]);
    expect((await jobs(o1)).map((j) => j.status)).toEqual(["PRINTED"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o1 } })).printedAt).not.toBeNull();
    expect((await legacyPrinted(c.token, o1)).statusCode).toBe(200); // idempotente
    const next = json(await claim(c.token)).job; // a fila entrega só o o2
    expect(next?.orderId ?? next?.order?.orderId ?? next?.ticket?.orderId).toBeDefined();
    expect((await jobs(o2)).map((j) => j.status)).toEqual(["CLAIMED"]);
    const ocupado = await legacyPrinted(c.token2, o2); // alguém está imprimindo o o2 pela fila agora
    expect([ocupado.statusCode, json(ocupado).code]).toEqual([409, "MODE_QUEUE"]);
    expect((await jobs(o2)).map((j) => j.status)).toEqual(["CLAIMED"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o2 } })).printedAt).toBeNull();
    const alheio = await legacyPrinted(outra.token, o2); // token de outra loja com id de pedido da loja c
    expect(alheio.statusCode).toBe(404);
    expect((await jobs(o2)).map((j) => j.status)).toEqual(["CLAIMED"]);
  });

  it("M8 limite de taxa da troca de modo: 10 por minuto por loja ⇒ a 11ª é 429 RATE_LIMITED com Retry-After; outra loja não é afetada", async () => {
    const c = await setup();
    const outra = await setup();
    for (let i = 0; i < 10; i++) expect((await setMode(c, "QUEUE")).statusCode, "tentativa " + (i + 1)).toBe(200);
    const r = await setMode(c, "QUEUE");
    expect([r.statusCode, json(r).code, r.headers["retry-after"]]).toEqual([429, "RATE_LIMITED", "60"]);
    expect((await setMode(outra, "QUEUE")).statusCode).toBe(200);
  });

  it("M9 corrida claim × recuo (60 rodadas, direto no serviço para não bater no limite de taxa da rota): nunca fica LEGACY com impressão em andamento", async () => {
    const { printModeService } = await import("../../src/modules/printJobs/printJobs.module");
    const c = await setup();
    const owner = await prisma.user.findFirstOrThrow({ where: { storeId: c.storeId } });
    await prisma.store.update({ where: { id: c.storeId }, data: { printMode: "QUEUE" } });
    const contagem = { trocaPassou: 0, claimGanhou: 0, nenhum: 0 };
    const pedido = await novoPedido(c); // 1 pedido só (o limite de 20 pedidos/min por IP): o job é reposto a PENDING a cada rodada
    const repor = () => prisma.printJob.updateMany({ where: { orderId: pedido, kind: "ORDER_KITCHEN" }, data: { status: "PENDING", attempts: 0, claimedAt: null, leaseUntil: null, claimedByTokenId: null, printedAt: null, ackStatus: null, availableAt: new Date(Date.now() - 60_000) } });
    for (let i = 0; i < 60; i++) {
      await repor();
      const offsets = [0, 5, 10, 15, 20, 30, 40, 55]; // ms de atraso do recuo: a corrida precisa ser DISPUTADA nos dois sentidos
      const atraso = offsets[i % offsets.length];
      const dorme = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const [cl, put] = await Promise.all([
        claim(c.token),
        dorme(atraso).then(() => printModeService.set({ storeId: c.storeId, userId: owner.id }, "LEGACY")).then(() => 200, (e: { statusCode?: number; code?: string }) => (e.code === "PRINT_IN_PROGRESS" ? 409 : 500)),
      ]);
      const job = json(cl).job;
      const modo = (await prisma.store.findUniqueOrThrow({ where: { id: c.storeId } })).printMode;
      const emAndamento = await prisma.printJob.count({ where: { storeId: c.storeId, status: "CLAIMED", leaseUntil: { gt: new Date() } } });
      expect(put, `rodada ${i}: a troca nunca pode dar 5xx`).not.toBe(500);
      expect(modo === "LEGACY" && emAndamento > 0, `rodada ${i}: modo=${modo} claimed=${emAndamento} put=${put} job=${!!job}`).toBe(false);
      expect(put === 200 && !!job, `rodada ${i}: a troca passou E o claim entregou job`).toBe(false);
      if (put === 200) contagem.trocaPassou++; else if (job) contagem.claimGanhou++; else contagem.nenhum++;
      await prisma.store.update({ where: { id: c.storeId }, data: { printMode: "QUEUE" } });
    }
    console.log("M9 contagem", JSON.stringify(contagem));
    expect(contagem.nenhum, "toda rodada tem de ter um vencedor (a troca ou o claim)").toBe(0);
  }, 240000);
});
