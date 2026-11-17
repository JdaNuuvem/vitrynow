// API-12b — modo de impressão por loja decidido pelo SERVIDOR + reconciliação da virada (ADR-0004 §8.12–13; plano do Ritchie).
// LEGACY: o cliente lista pedidos com printedAt nulo. QUEUE: o cliente consome jobs. Só um dos dois caminhos funciona por vez.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

describe("API-12b — modo de impressão e virada", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
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
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    const token = json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label: "caixa" } })).token.token as string;
    return { owner: cookie!, storeId: storeId as string, slug: slug as string, productId, token };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const order = async (ctx: Ctx, extra: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...extra } });
    expect(res.statusCode, res.body).toBe(201);
    return json(res).orderId as string;
  };
  const setMode = (ctx: Ctx, mode: string, cookie = ctx.owner) => app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie }, payload: { mode } });
  const modeOf = async (storeId: string) => (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).printMode;
  const kitchenJobs = (orderId: string) => prisma.printJob.findMany({ where: { orderId, kind: "ORDER_KITCHEN" } });
  const pending = (ctx: Ctx) => app.inject({ method: "GET", url: "/api/device/orders/pending", headers: bearer(ctx.token) });
  const claim = (ctx: Ctx) => app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(ctx.token), payload: {} });
  const conferenceOf = async (ctx: Ctx) => json(await app.inject({ method: "GET", url: "/api/store/print-mode", headers: { cookie: ctx.owner } })).conference;
  const staffCookie = async (ctx: Ctx) => {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  };

  it("o padrão é LEGACY; GET /api/device/config e GET /api/store/print-mode dizem o modo (e a conferência)", async () => {
    const ctx = await setup();
    expect(await modeOf(ctx.storeId)).toBe("LEGACY");
    const cfg = await app.inject({ method: "GET", url: "/api/device/config", headers: bearer(ctx.token) });
    expect([cfg.statusCode, json(cfg)]).toEqual([200, { mode: "LEGACY" }]);
    const panel = await app.inject({ method: "GET", url: "/api/store/print-mode", headers: { cookie: ctx.owner } });
    expect(json(panel)).toEqual({ mode: "LEGACY", conference: { pendingJobOfPrintedOrder: 0, printableOrderWithoutJob: 0, printedJobOfUnprintedOrder: 0 } });
    expect((await app.inject({ method: "GET", url: "/api/device/config" })).statusCode).toBe(401); // sem token
  });

  it("só o OWNER altera o modo: STAFF ⇒ 403, sem sessão ⇒ 401, valor inválido ⇒ 400; nada muda", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    expect((await setMode(ctx, "QUEUE", staff)).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/store/print-mode", headers: { cookie: staff } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/store/print-mode", payload: { mode: "QUEUE" } })).statusCode).toBe(401);
    expect((await setMode(ctx, "TANTO_FAZ")).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/api/store/print-mode", headers: { cookie: ctx.owner }, payload: {} })).statusCode).toBe(400);
    expect(await modeOf(ctx.storeId)).toBe("LEGACY");
    // a tentativa negada do STAFF fica registrada (com o modo pedido), e só ela
    const denied = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "print.mode_change_denied" } });
    expect(denied).toHaveLength(1);
    expect(denied[0].metadata).toEqual({ role: "STAFF", requested: "QUEUE" });
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.mode_change" } })).toBe(0);
  });

  it("FALHA FECHADA: se o rastro da troca não puder ser gravado, o modo NÃO muda e a reconciliação some junto (mesma transação)", async () => {
    const ctx = await setup();
    const semJob = await order(ctx);
    await prisma.printJob.deleteMany({ where: { orderId: semJob } });
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION recusa_audit_modo() RETURNS trigger AS $$ BEGIN IF NEW."action" = 'print.mode_change' THEN RAISE EXCEPTION 'auditoria indisponivel'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER recusa_audit_modo BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION recusa_audit_modo()`);
    try {
      const r = await setMode(ctx, "QUEUE");
      expect(r.statusCode).toBeGreaterThanOrEqual(500);
      expect(await modeOf(ctx.storeId)).toBe("LEGACY");
      expect(await kitchenJobs(semJob)).toHaveLength(0); // o job criado pela reconciliação também voltou atrás
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER recusa_audit_modo ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION recusa_audit_modo()`);
    }
    // sem o gatilho, a mesma troca funciona
    expect((await setMode(ctx, "QUEUE")).statusCode).toBe(200);
    expect(await kitchenJobs(semJob)).toHaveLength(1);
  });

  it("o modo vem SÓ da loja do token: query, cabeçalho e corpo com 'mode'/'storeId' de outra loja são ignorados", async () => {
    const a = await setup();
    const b = await setup();
    await setMode(b, "QUEUE");
    const r = await app.inject({
      method: "GET",
      url: `/api/device/config?mode=QUEUE&storeId=${b.storeId}`,
      headers: { ...bearer(a.token), "x-print-mode": "QUEUE", "x-store-id": b.storeId },
    });
    expect(json(r)).toEqual({ mode: "LEGACY" });
    const c = await app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(a.token), payload: { mode: "QUEUE", storeId: b.storeId } });
    expect(json(c)).toEqual({ job: null, mode: "LEGACY" });
  });

  it("X-Print-Mode em TODA resposta autenticada de /api/device/* (inclusive 409 e erros do próprio handler) e `mode` no corpo de /pending; o cabeçalho vem da loja do token", async () => {
    const a = await setup();
    const b = await setup();
    await setMode(b, "QUEUE");
    const idA = await order(a);
    const get = (ctx: Ctx, url: string, extra: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { ...bearer(ctx.token), ...extra } });

    // LEGACY: lista com o pedido + modo no corpo; cabeçalho LEGACY
    const pendA = await pending(a);
    expect(json(pendA)).toEqual({ orders: [{ id: idA, code: expect.any(String) }], mode: "LEGACY" });
    expect(pendA.headers["x-print-mode"]).toBe("LEGACY");
    expect((await get(a, `/api/device/orders/${idA}/printable`)).headers["x-print-mode"]).toBe("LEGACY");
    expect((await get(a, "/api/device/orders/inexistente/printable")).headers["x-print-mode"]).toBe("LEGACY"); // até no 404

    // QUEUE: corpo { orders: [], mode } (formato antigo preservado: `orders` continua array) e cabeçalho QUEUE, também no 409
    const pendB = await pending(b);
    expect(json(pendB)).toEqual({ orders: [], mode: "QUEUE" });
    expect(Array.isArray(json(pendB).orders)).toBe(true);
    expect(pendB.headers["x-print-mode"]).toBe("QUEUE");
    const idB = await order(b);
    const conflito = await get(b, `/api/device/orders/${idB}/printable`);
    expect([conflito.statusCode, conflito.headers["x-print-mode"]]).toEqual([409, "QUEUE"]);
    expect((await claim(b)).headers["x-print-mode"]).toBe("QUEUE");
    expect((await get(b, "/api/device/config")).headers["x-print-mode"]).toBe("QUEUE");

    // o cabeçalho é da loja do TOKEN: nada que o cliente mande (cabeçalho, query) o muda; e a virada aparece no ciclo seguinte
    expect((await get(a, "/api/device/config?mode=QUEUE", { "x-print-mode": "QUEUE" })).headers["x-print-mode"]).toBe("LEGACY");
    await setMode(a, "QUEUE");
    expect((await pending(a)).headers["x-print-mode"]).toBe("QUEUE");

    // sem token válido não há loja: 401 SEM o cabeçalho (nada vaza de loja nenhuma)
    const semToken = await app.inject({ method: "GET", url: "/api/device/orders/pending" });
    expect([semToken.statusCode, semToken.headers["x-print-mode"]]).toEqual([401, undefined]);
    const tokenRuim = await app.inject({ method: "GET", url: "/api/device/orders/pending", headers: bearer("token-que-nao-existe") });
    expect([tokenRuim.statusCode, tokenRuim.headers["x-print-mode"]]).toEqual([401, undefined]);
    // rotas do painel não ganham o cabeçalho
    expect((await app.inject({ method: "GET", url: "/api/store/print-mode", headers: { cookie: a.owner } })).headers["x-print-mode"]).toBeUndefined();
  });

  it("o 409 MODE_QUEUE tem mensagem FIXA e nenhum dado de pedido/loja", async () => {
    const ctx = await setup();
    const id = await order(ctx, { type: "DELIVERY", customerName: "Ana Sigilosa", customerPhone: "11987654321", address: "Rua Sigilosa, 777" });
    await setMode(ctx, "QUEUE");
    const r = await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: bearer(ctx.token) });
    expect([r.statusCode, json(r)]).toEqual([409, { error: "Esta loja imprime pela fila.", code: "MODE_QUEUE" }]);
    for (const d of ["Sigilosa", "11987654321", id, ctx.storeId, ctx.slug]) expect(r.body, d).not.toContain(d);
  });

  it("LEGACY: o claim devolve {job:null, mode:'LEGACY'} MESMO com job PENDING na fila (ninguém imprime pela fila)", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    expect(await kitchenJobs(id)).toHaveLength(1); // o job nasce em qualquer modo
    const r = await claim(ctx);
    expect([r.statusCode, json(r)]).toEqual([200, { job: null, mode: "LEGACY" }]);
    expect((await kitchenJobs(id))[0]).toMatchObject({ status: "PENDING", attempts: 0 }); // o claim não tocou no job
  });

  it("QUEUE: o claim devolve o job com mode:'QUEUE'; a lista legada vem VAZIA e printable/printed ⇒ 409 MODE_QUEUE", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    expect((await setMode(ctx, "QUEUE")).statusCode).toBe(200);
    const r = await claim(ctx);
    expect(json(r).mode).toBe("QUEUE");
    expect(json(r).job).toMatchObject({ kind: "ORDER_KITCHEN", ticket: { orderId: id } });
    expect(json(await pending(ctx))).toMatchObject({ orders: [] });
    const printable = await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: bearer(ctx.token) });
    expect([printable.statusCode, json(printable).code]).toEqual([409, "MODE_QUEUE"]);
    const printed = await app.inject({ method: "POST", url: `/api/device/orders/${id}/printed`, headers: bearer(ctx.token) });
    expect([printed.statusCode, json(printed).code]).toEqual([409, "MODE_QUEUE"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt).toBeNull(); // o 409 não imprimiu nada
  });

  it("LEGACY: o fluxo antigo segue igual (lista → printable → printed); o ack legado fecha o job NA MESMA transação", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    expect(json(await pending(ctx)).orders.map((o: { id: string }) => o.id)).toEqual([id]);
    expect((await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: bearer(ctx.token) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/device/orders/${id}/printed`, headers: bearer(ctx.token) })).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt).not.toBeNull();
    expect((await kitchenJobs(id))[0]).toMatchObject({ status: "PRINTED", ackStatus: "PRINTED" });
    expect(json(await pending(ctx))).toMatchObject({ orders: [] });
    // e a virada logo depois NÃO reimprime: nada a reconciliar
    const virada = json(await setMode(ctx, "QUEUE"));
    expect(virada.reconciled).toEqual({ closedPendingJobs: 0, createdJobs: 0, markedOrdersPrinted: 0 });
    expect((await claim(ctx)).body).toContain('"job":null');
  });

  it("LEGACY→QUEUE reconcilia: impresso com job PENDING ⇒ PRINTED; não impresso sem job ⇒ job criado; cancelado/aguardando pagamento ⇒ nenhum", async () => {
    const ctx = await setup();
    const impresso = await order(ctx);
    const naoImpresso = await order(ctx);
    const semJob = await order(ctx);
    const cancelado = await order(ctx);
    const aguardando = await order(ctx);
    // estado herdado de uma loja que rodava no legado:
    const antes = new Date(Date.now() - 3600_000);
    await prisma.order.update({ where: { id: impresso }, data: { printedAt: antes } }); // legado imprimiu, job ficou PENDING
    await prisma.printJob.deleteMany({ where: { orderId: semJob } }); // pedido antigo, de antes da fila
    await prisma.order.update({ where: { id: cancelado }, data: { status: "CANCELADO" } });
    await prisma.printJob.deleteMany({ where: { orderId: { in: [cancelado, aguardando] } } });
    await prisma.order.update({ where: { id: aguardando }, data: { awaitingPayment: true } });

    expect(await conferenceOf(ctx)).toEqual({ pendingJobOfPrintedOrder: 1, printableOrderWithoutJob: 1, printedJobOfUnprintedOrder: 0 });

    const r = await setMode(ctx, "QUEUE");
    expect(r.statusCode, r.body).toBe(200);
    expect(json(r)).toMatchObject({
      mode: "QUEUE",
      changed: true,
      reconciled: { closedPendingJobs: 1, createdJobs: 1, markedOrdersPrinted: 0 },
      conference: { pendingJobOfPrintedOrder: 0, printableOrderWithoutJob: 0, printedJobOfUnprintedOrder: 0 },
    });
    expect((await kitchenJobs(impresso))[0]).toMatchObject({ status: "PRINTED", printedAt: antes });
    expect((await kitchenJobs(naoImpresso))[0].status).toBe("PENDING");
    const criado = await kitchenJobs(semJob);
    expect(criado).toHaveLength(1);
    expect(criado[0]).toMatchObject({ status: "PENDING", dedupeKey: `${semJob}:ORDER_KITCHEN`, attempts: 0 });
    expect(await kitchenJobs(cancelado)).toHaveLength(0);
    expect(await kitchenJobs(aguardando)).toHaveLength(0);
    expect(await modeOf(ctx.storeId)).toBe("QUEUE");
    // o claim só entrega o que ainda não foi impresso
    const vistos = new Set<string>();
    for (let i = 0; i < 4; i++) {
      const j = json(await claim(ctx)).job;
      if (!j) continue;
      vistos.add(j.ticket.orderId);
      await app.inject({ method: "POST", url: `/api/device/print-jobs/${j.id}/ack`, headers: bearer(ctx.token), payload: { status: "PRINTED" } }); // um token segura um job por vez
    }
    expect([...vistos].sort()).toEqual([naoImpresso, semJob].sort());
  });

  it("a virada é IDEMPOTENTE: repetir o comando não muda nada, não duplica job e não grava nova auditoria", async () => {
    const ctx = await setup();
    const semJob = await order(ctx);
    await prisma.printJob.deleteMany({ where: { orderId: semJob } });
    expect(json(await setMode(ctx, "QUEUE")).reconciled.createdJobs).toBe(1);
    const again = json(await setMode(ctx, "QUEUE"));
    expect(again).toMatchObject({ mode: "QUEUE", changed: false, reconciled: { closedPendingJobs: 0, createdJobs: 0, markedOrdersPrinted: 0 } });
    expect(await kitchenJobs(semJob)).toHaveLength(1);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.mode_change" } })).toBe(1), { timeout: 10_000, interval: 100 });
  });

  it("virada concorrente: dois PUTs simultâneos ⇒ um job por pedido (lock por loja + dedupeKey)", async () => {
    const ctx = await setup();
    const ids = [await order(ctx), await order(ctx), await order(ctx)];
    await prisma.printJob.deleteMany({ where: { orderId: { in: ids } } });
    const [a, b] = await Promise.all([setMode(ctx, "QUEUE"), setMode(ctx, "QUEUE")]);
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]);
    for (const id of ids) expect(await kitchenJobs(id)).toHaveLength(1);
    expect(json(a).reconciled.createdJobs + json(b).reconciled.createdJobs).toBe(3);
  });

  it("QUEUE→LEGACY (recuo): pedido que a fila imprimiu ganha printedAt (o legado não reimprime) e a conferência fecha em 0", async () => {
    const ctx = await setup();
    const feitoPelaFila = await order(ctx);
    const pendente = await order(ctx);
    expect((await setMode(ctx, "QUEUE")).statusCode).toBe(200);
    const claimed = json(await claim(ctx)).job as { id: string; ticket: { orderId: string } };
    const job = { id: claimed.id, orderId: claimed.ticket.orderId };
    // o job do `pendente` pode vir primeiro; imprime o que veio e o outro fica na fila
    const ackRes = await app.inject({ method: "POST", url: `/api/device/print-jobs/${job.id}/ack`, headers: bearer(ctx.token), payload: { status: "PRINTED" } });
    expect(ackRes.statusCode, ackRes.body).toBe(200);
    // ack em QUEUE já grava Order.printedAt; simula o resíduo antigo (job PRINTED com printedAt nulo no pedido)
    await prisma.order.update({ where: { id: job.orderId }, data: { printedAt: null } });
    expect(await conferenceOf(ctx)).toMatchObject({ printedJobOfUnprintedOrder: 1 });

    const r = await setMode(ctx, "LEGACY");
    expect(json(r)).toMatchObject({ mode: "LEGACY", changed: true, reconciled: { markedOrdersPrinted: 1 }, conference: { printedJobOfUnprintedOrder: 0 } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: job.orderId } })).printedAt).not.toBeNull();
    const outro = job.orderId === feitoPelaFila ? pendente : feitoPelaFila;
    expect(json(await pending(ctx)).orders.map((o: { id: string }) => o.id)).toEqual([outro]); // só o que não foi impresso
    expect(json(await claim(ctx))).toEqual({ job: null, mode: "LEGACY" });
  });

  it("ack PRINTED em QUEUE grava Order.printedAt junto do job; ack repetido conserta printedAt perdido", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await setMode(ctx, "QUEUE");
    const job = json(await claim(ctx)).job as { id: string };
    const ack = () => app.inject({ method: "POST", url: `/api/device/print-jobs/${job.id}/ack`, headers: bearer(ctx.token), payload: { status: "PRINTED" } });
    expect((await ack()).statusCode).toBe(200);
    const impresso = (await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt;
    expect(impresso).not.toBeNull();
    await prisma.order.update({ where: { id }, data: { printedAt: null } });
    expect((await ack()).statusCode).toBe(200); // idempotente
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt).not.toBeNull();
  });

  it("o ack do job segue aceito se o modo virou LEGACY no meio (a impressão já saiu; não pode ficar presa)", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await setMode(ctx, "QUEUE");
    const job = json(await claim(ctx)).job as { id: string };
    // o recuo normal é recusado com impressão em andamento (ver PRINT_IN_PROGRESS); aqui o modo vira LEGACY por fora (operador/banco)
    await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: "LEGACY" } });
    const r = await app.inject({ method: "POST", url: `/api/device/print-jobs/${job.id}/ack`, headers: bearer(ctx.token), payload: { status: "PRINTED" } });
    expect(r.statusCode, r.body).toBe(200);
    expect((await kitchenJobs(id))[0].status).toBe("PRINTED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt).not.toBeNull(); // o legado não reimprime
    expect(json(await pending(ctx))).toMatchObject({ orders: [] });
  });

  // ───────────── Janela entre impressoras (ADR-0004 §8 item 14) ─────────────
  const printed = (ctx: Ctx, orderId: string) => app.inject({ method: "POST", url: `/api/device/orders/${orderId}/printed`, headers: bearer(ctx.token) });
  const claimedLive = (storeId: string) => prisma.printJob.count({ where: { storeId, status: "CLAIMED", leaseUntil: { gt: new Date() } } });

  it("RECUO com impressão em andamento ⇒ 409 PRINT_IN_PROGRESS e NADA muda; depois do ack (ou da lease vencida) o recuo funciona", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await setMode(ctx, "QUEUE");
    const job = json(await claim(ctx)).job as { id: string };
    const negado = await setMode(ctx, "LEGACY");
    expect([negado.statusCode, json(negado).code, json(negado).error]).toEqual([409, "PRINT_IN_PROGRESS", "Há impressão em andamento. Tente em instantes."]);
    expect(await modeOf(ctx.storeId)).toBe("QUEUE");
    expect((await kitchenJobs(id))[0].status).toBe("CLAIMED");
    // a lista legada segue vazia e o job segue do dono: nada foi tocado
    expect(json(await pending(ctx))).toMatchObject({ orders: [] });
    // com o ack, o recuo passa
    await app.inject({ method: "POST", url: `/api/device/print-jobs/${job.id}/ack`, headers: bearer(ctx.token), payload: { status: "PRINTED" } });
    expect((await setMode(ctx, "LEGACY")).statusCode).toBe(200);
    expect(await modeOf(ctx.storeId)).toBe("LEGACY");

    // lease VENCIDA (impressora caiu) não segura o recuo
    const ctx2 = await setup();
    await order(ctx2);
    await setMode(ctx2, "QUEUE");
    const j2 = json(await claim(ctx2)).job as { id: string };
    await prisma.printJob.update({ where: { id: j2.id }, data: { leaseUntil: new Date(Date.now() - 5000) } });
    expect((await setMode(ctx2, "LEGACY")).statusCode).toBe(200);
  });

  it("CORRIDA claim × recuo, 8 rodadas: nunca fica LEGACY com impressão em andamento (ou o recuo é recusado, ou o claim não entrega)", async () => {
    const ctx = await setup();
    let recusados = 0;
    let semJob = 0;
    for (let i = 0; i < 8; i++) {
      await prisma.store.update({ where: { id: ctx.storeId }, data: { printMode: "QUEUE" } });
      await order(ctx);
      const [c, p] = await Promise.all([claim(ctx), setMode(ctx, "LEGACY")]);
      const modo = await modeOf(ctx.storeId);
      expect(!(modo === "LEGACY" && (await claimedLive(ctx.storeId)) > 0), `rodada ${i}: LEGACY com job em andamento`).toBe(true);
      if (p.statusCode === 409) {
        recusados += 1;
        expect(json(p).code).toBe("PRINT_IN_PROGRESS");
        expect(json(c).job).not.toBeNull();
      } else {
        expect(p.statusCode, p.body).toBe(200);
        if (json(c).job === null) semJob += 1;
      }
      // limpa para a próxima rodada: encerra o que estiver em andamento
      await prisma.printJob.updateMany({ where: { storeId: ctx.storeId, status: { in: ["CLAIMED", "PENDING"] } }, data: { status: "PRINTED", leaseUntil: null } });
    }
    expect(recusados + semJob).toBeGreaterThan(0);
  });

  it("DETERMINÍSTICO: com a troca de modo em andamento (lock da loja seguro), o claim ESPERA e, ao liberar, relê o modo: entrega nada se virou LEGACY", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await setMode(ctx, "QUEUE");
    let resposta: { statusCode: number; body: string } | undefined;
    let terminou = false;
    await prisma.$transaction(async (tx) => {
      // faz o papel do PUT em andamento: lock exclusivo da loja + troca do modo ainda NÃO commitada
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"printmode:" + ctx.storeId}))`;
      const pendente = claim(ctx).then((r) => {
        terminou = true;
        resposta = r;
      });
      await new Promise((r) => setTimeout(r, 600));
      expect(terminou, "o claim não pode terminar enquanto a troca segura o lock").toBe(false);
      await tx.store.update({ where: { id: ctx.storeId }, data: { printMode: "LEGACY" } });
      void pendente;
    });
    await vi.waitFor(() => expect(terminou).toBe(true), { timeout: 10_000 });
    expect(json(resposta!)).toEqual({ job: null, mode: "LEGACY" }); // releu o modo depois do lock
    expect((await kitchenJobs(id))[0]).toMatchObject({ status: "PENDING", attempts: 0 }); // e não gastou o job
  });

  it("DETERMINÍSTICO: cancelar pedido JÁ IMPRESSO com a virada LEGACY→QUEUE em andamento espera o lock, relê o modo e o aviso NASCE (nunca CANCELADO + impresso + 0 aviso)", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await app.inject({ method: "POST", url: `/api/device/orders/${id}/printed`, headers: bearer(ctx.token) }); // o legado imprimiu
    let resposta: { statusCode: number; body: string } | undefined;
    let terminou = false;
    await prisma.$transaction(async (tx) => {
      // faz o papel do PUT em andamento: lock exclusivo da loja + troca para QUEUE ainda NÃO commitada
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"printmode:" + ctx.storeId}))`;
      const cancelamento = app
        .inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } })
        .then((r) => {
          terminou = true;
          resposta = r;
        });
      await new Promise((r) => setTimeout(r, 700));
      expect(terminou, "o cancelamento não pode terminar enquanto a troca segura o lock").toBe(false);
      await tx.store.update({ where: { id: ctx.storeId }, data: { printMode: "QUEUE" } });
      void cancelamento;
    });
    await vi.waitFor(() => expect(terminou).toBe(true), { timeout: 10_000 });
    expect(resposta!.statusCode, resposta!.body).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELADO");
    // a virada commitou antes: o cancelamento releu QUEUE e o job de aviso existe (o pedido já tinha sido impresso pelo legado)
    expect(await prisma.printJob.count({ where: { orderId: id, kind: "ORDER_CANCEL_NOTICE" } })).toBe(1);
  });

  // ORDEM ÚNICA DE TRAVAS (loja → pedido → pagamento): enquanto o cancelamento ESPERA o lock da loja (troca de modo em andamento), ele NÃO pode
  // estar segurando a linha do pedido nem a do pagamento; senão a troca (que atualiza pedido/job na reconciliação) forma um ciclo e o Postgres
  // aborta um dos dois com 40P01 (achado do Deming). `FOR UPDATE NOWAIT` na linha: se alguém a segura, falha na hora.
  const linhaLivre = async (orderId: string) => {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE NOWAIT`;
      });
      return true;
    } catch {
      return false;
    }
  };

  it("ORDEM DE TRAVAS (cancelar sem dinheiro): esperando o lock da loja, o cancelamento NÃO segura a linha do pedido; ao liberar, cancela", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await app.inject({ method: "POST", url: `/api/device/orders/${id}/printed`, headers: bearer(ctx.token) });
    let resposta: { statusCode: number; body: string } | undefined;
    let terminou = false;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"printmode:" + ctx.storeId}))`; // a troca em andamento
      app
        .inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } })
        .then((r) => {
          terminou = true;
          resposta = r;
        });
      await new Promise((r) => setTimeout(r, 700));
      expect(terminou).toBe(false);
      expect(await linhaLivre(id), "o cancelamento em espera está segurando a linha do pedido (ordem de travas invertida)").toBe(true);
    });
    await vi.waitFor(() => expect(terminou).toBe(true), { timeout: 10_000 });
    expect(resposta!.statusCode, resposta!.body).toBe(200);
  });

  it("ORDEM DE TRAVAS (Tx 2 do estorno): esperando o lock da loja, a conclusão do estorno NÃO segura pedido nem pagamento; ao liberar, conclui", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    // pedido pago por PIX aprovado e com estorno já pedido (ESTORNO_PENDENTE + contexto de cancelamento): a retentativa faz só a Tx 2
    await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX", refundLockedAt: new Date() } });
    const payment = await prisma.payment.create({
      data: {
        orderId: id,
        providerPaymentId: `mp-${id}`,
        amountCents: 1000,
        status: "ESTORNO_PENDENTE",
        refundRequestedAt: new Date(),
        refundContext: { source: "PANEL", userId: null, actor: "OWNER", reason: { code: "ITEM_EM_FALTA" }, providerRefundedAt: new Date().toISOString() },
      },
    });
    let resposta: { statusCode: number; body: string } | undefined;
    let terminou = false;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"printmode:" + ctx.storeId}))`;
      app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.owner } }).then((r) => {
        terminou = true;
        resposta = r;
      });
      await new Promise((r) => setTimeout(r, 700));
      expect(terminou).toBe(false);
      expect(await linhaLivre(id), "a Tx 2 em espera está segurando a linha do pedido").toBe(true);
      const pagamentoLivre = await prisma.$transaction(async (t) => {
        try {
          await t.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE NOWAIT`;
          return true;
        } catch {
          return false;
        }
      });
      expect(pagamentoLivre, "a Tx 2 em espera está segurando a linha do pagamento").toBe(true);
    });
    await vi.waitFor(() => expect(terminou).toBe(true), { timeout: 10_000 });
    expect(resposta!.statusCode, resposta!.body).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("REEMBOLSADO");
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELADO");
  });

  it("VARREDURA: toda transação que chega ao applyCancel toma lockPrintMode como a PRIMEIRA instrução (ordem única de travas: loja → pedido → pagamento)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "../src/modules/orders/orders.service.ts"), "utf8").split("\r\n").join("\n");
    // Para cada chamada `this.applyCancel(` olha o texto desde o `runTx(` mais próximo ANTES dela: ali o lock precisa vir antes de qualquer acesso a pedido/pagamento/job.
    const chamadas = [...src.matchAll(/this\.applyCancel\(/g)].map((m) => m.index!);
    expect(chamadas.length, "esperava 2 chamadas ao applyCancel (cancelOrder e Tx 2 da saga)").toBeGreaterThanOrEqual(2);
    for (const pos of chamadas) {
      const inicio = src.lastIndexOf("runTx(", pos);
      expect(inicio, "applyCancel fora de um runTx").toBeGreaterThanOrEqual(0);
      const trecho = src.slice(inicio, pos);
      const iLock = trecho.indexOf("lockPrintMode(tx");
      expect(iLock, "transação com applyCancel sem lockPrintMode").toBeGreaterThanOrEqual(0);
      for (const antes of ['FROM "Order"', "tx.order.", "tx.payment.", "tx.printJob."]) {
        const i = trecho.indexOf(antes);
        expect(i === -1 || i > iLock, `${antes} aparece ANTES do lockPrintMode`).toBe(true);
      }
    }
  });

  it("ACK TARDIO em QUEUE: job PENDING ⇒ 200 idempotente, fecha o job (PRINTED) e grava printedAt NA MESMA transação; a lista legada segue vazia e a fila não reimprime", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await setMode(ctx, "QUEUE");
    expect((await kitchenJobs(id))[0].status).toBe("PENDING");
    const r = await printed(ctx, id);
    expect([r.statusCode, json(r)]).toEqual([200, { ok: true }]);
    expect((await kitchenJobs(id))[0]).toMatchObject({ status: "PRINTED", ackStatus: "PRINTED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt).not.toBeNull();
    expect((await printed(ctx, id)).statusCode).toBe(200); // repetido
    expect(json(await pending(ctx))).toMatchObject({ orders: [] }); // a lista legada continua vazia em QUEUE
    expect(json(await claim(ctx)).job).toBeNull(); // a fila não reimprime
    const pr = await app.inject({ method: "GET", url: `/api/device/orders/${id}/printable`, headers: bearer(ctx.token) });
    expect([pr.statusCode, json(pr).code]).toEqual([409, "MODE_QUEUE"]); // só o ACK é aceito
  });

  it("ACK TARDIO: job CLAIMED com lease vigente ⇒ 409 MODE_QUEUE e nada muda; lease vencida ⇒ 200; pedido sem job ⇒ 200 com printedAt; job cancelado ⇒ 200", async () => {
    const ctx = await setup();
    const emAndamento = await order(ctx);
    await setMode(ctx, "QUEUE");
    const job = json(await claim(ctx)).job as { id: string; ticket: { orderId: string } };
    expect(job.ticket.orderId).toBe(emAndamento);
    const busy = await printed(ctx, emAndamento);
    expect([busy.statusCode, json(busy).code]).toEqual([409, "MODE_QUEUE"]);
    expect((await kitchenJobs(emAndamento))[0].status).toBe("CLAIMED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: emAndamento } })).printedAt).toBeNull();
    // a impressora que tinha o job caiu: lease vencida ⇒ o ack tardio é aceito
    await prisma.printJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(Date.now() - 5000) } });
    expect((await printed(ctx, emAndamento)).statusCode).toBe(200);
    expect((await kitchenJobs(emAndamento))[0].status).toBe("PRINTED");
    // pedido sem job (antigo)
    const semJob = await order(ctx);
    await prisma.printJob.deleteMany({ where: { orderId: semJob } });
    expect((await printed(ctx, semJob)).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: semJob } })).printedAt).not.toBeNull();
    // job cancelado (pedido cancelado antes de imprimir) mas o papel saiu: aceita e marca
    const cancelado = await order(ctx);
    await prisma.printJob.updateMany({ where: { orderId: cancelado }, data: { status: "CANCELED" } });
    expect((await printed(ctx, cancelado)).statusCode).toBe(200);
  });

  it("ACK TARDIO de pedido de OUTRA loja ⇒ 404 e nada muda", async () => {
    const a = await setup();
    const b = await setup();
    const pedidoB = await order(b);
    await setMode(a, "QUEUE");
    const r = await printed(a, pedidoB);
    expect(r.statusCode).toBe(404);
    expect((await kitchenJobs(pedidoB))[0].status).toBe("PENDING");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pedidoB } })).printedAt).toBeNull();
  });

  it("CORRIDA ack tardio × claim, 8 rodadas: o pedido sai UMA vez (ou o ack fecha o job e o claim não o entrega, ou o claim pega e o ack é 409)", async () => {
    const ctx = await setup();
    await setMode(ctx, "QUEUE");
    for (let i = 0; i < 8; i++) {
      const id = await order(ctx);
      const [a, c] = await Promise.all([printed(ctx, id), claim(ctx)]);
      const entregue = json(c).job?.ticket?.orderId === id;
      expect(a.statusCode === 200 && entregue, `rodada ${i}: impresso no legado E entregue pela fila`).toBe(false);
      expect(a.statusCode === 409 && !entregue, `rodada ${i}: nem um nem outro`).toBe(false);
      if (entregue) {
        expect([a.statusCode, json(a).code]).toEqual([409, "MODE_QUEUE"]);
        await app.inject({ method: "POST", url: `/api/device/print-jobs/${json(c).job.id}/ack`, headers: bearer(ctx.token), payload: { status: "PRINTED" } });
      } else {
        expect(a.statusCode).toBe(200);
        expect((await kitchenJobs(id))[0].status).toBe("PRINTED");
      }
      // encerra o que sobrou da rodada para a próxima começar limpa
      await prisma.printJob.updateMany({ where: { storeId: ctx.storeId, status: { in: ["CLAIMED", "PENDING"] } }, data: { status: "PRINTED", leaseUntil: null } });
    }
  });

  it("repetir o comando que RECONCILIA sem trocar o modo também fica no rastro (print.mode_reconcile); sem nada a reconciliar, nenhum rastro novo", async () => {
    const ctx = await setup();
    await setMode(ctx, "QUEUE");
    const novo = await order(ctx);
    await prisma.printJob.deleteMany({ where: { orderId: novo } }); // pedido que chegou sem job (ex.: legado)
    const r = await setMode(ctx, "QUEUE");
    expect(json(r)).toMatchObject({ changed: false, reconciled: { createdJobs: 1 } });
    const rows = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "print.mode_reconcile" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toEqual({ mode: "QUEUE", closedPendingJobs: 0, createdJobs: 1, markedOrdersPrinted: 0 });
    await setMode(ctx, "QUEUE"); // nada a reconciliar
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.mode_reconcile" } })).toBe(1);
  });

  it("LIMITE DA TENTATIVA NEGADA: o STAFF que insiste leva 403 ×10 (cada uma registrada) e depois 429 sem gravar mais; a rota nunca abre; o dono segue trocando (balde separado)", async () => {
    const ctx = await setup();
    const staff = await staffCookie(ctx);
    for (let i = 0; i < 10; i++) expect((await setMode(ctx, "QUEUE", staff)).statusCode, `tentativa ${i + 1}`).toBe(403);
    const barrado = await setMode(ctx, "QUEUE", staff);
    expect([barrado.statusCode, json(barrado).code, barrado.headers["retry-after"]]).toEqual([429, "RATE_LIMITED", "60"]);
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.mode_change_denied" } })).toBe(10); // a 11ª não gravou
    expect(await modeOf(ctx.storeId)).toBe("LEGACY"); // nunca houve efeito
    expect((await setMode(ctx, "QUEUE")).statusCode).toBe(200); // o balde do dono é outro
    expect(await modeOf(ctx.storeId)).toBe("QUEUE");
  });

  it("LIMITE DE TAXA da troca de modo: 10 por minuto POR LOJA (a 11ª ⇒ 429 RATE_LIMITED com Retry-After); outra loja não é afetada", async () => {
    const ctx = await setup();
    const outra = await setup();
    for (let i = 0; i < 10; i++) expect((await setMode(ctx, i % 2 ? "LEGACY" : "QUEUE")).statusCode, `chamada ${i + 1}`).toBe(200);
    const r = await setMode(ctx, "QUEUE");
    expect([r.statusCode, json(r).code, r.headers["retry-after"]]).toEqual([429, "RATE_LIMITED", "60"]);
    expect((await setMode(outra, "QUEUE")).statusCode).toBe(200);
  });

  it("2ª via e tíquete de teste exigem QUEUE: em LEGACY ⇒ 409 PRINT_MODE_LEGACY e NADA é criado", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    const reprint = await app.inject({ method: "POST", url: `/api/orders/${id}/reprint`, headers: { cookie: ctx.owner } });
    expect([reprint.statusCode, json(reprint).code]).toEqual([409, "PRINT_MODE_LEGACY"]);
    const test = await app.inject({ method: "POST", url: "/api/print-jobs/test", headers: { cookie: ctx.owner } });
    expect([test.statusCode, json(test).code]).toEqual([409, "PRINT_MODE_LEGACY"]);
    expect(await prisma.printJob.count({ where: { storeId: ctx.storeId, kind: { in: ["ORDER_REPRINT", "TEST"] } } })).toBe(0);
    await setMode(ctx, "QUEUE");
    expect((await app.inject({ method: "POST", url: `/api/orders/${id}/reprint`, headers: { cookie: ctx.owner } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/print-jobs/test", headers: { cookie: ctx.owner } })).statusCode).toBe(201);
  });

  it("cancelar pedido já impresso em LEGACY NÃO cria aviso de cancelamento na fila (ninguém o imprimiria; o aviso só existe em QUEUE)", async () => {
    const ctx = await setup();
    const id = await order(ctx);
    await app.inject({ method: "POST", url: `/api/device/orders/${id}/printed`, headers: bearer(ctx.token) });
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(cancel.statusCode, cancel.body).toBe(200);
    expect(await prisma.printJob.count({ where: { orderId: id, kind: "ORDER_CANCEL_NOTICE" } })).toBe(0);
  });

  it("a auditoria da virada guarda só CONTAGENS: nada de pedido, cliente, telefone ou endereço", async () => {
    const ctx = await setup();
    await order(ctx, { type: "DELIVERY", customerName: "Ana Sigilosa", customerPhone: "11987654321", address: "Rua Sigilosa, 777" });
    await setMode(ctx, "QUEUE");
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.mode_change" } })).toBe(1), { timeout: 10_000, interval: 100 });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { storeId: ctx.storeId, action: "print.mode_change" } });
    expect(row.metadata).toEqual({ from: "LEGACY", to: "QUEUE", closedPendingJobs: 0, createdJobs: 0, markedOrdersPrinted: 0 });
    const dump = JSON.stringify(row);
    for (const d of ["Sigilosa", "11987654321", "Ana"]) expect(dump, d).not.toContain(d);
    expect(row.targetId).toBe(ctx.storeId);
  });

  it("ISOLAMENTO: virar a loja A não toca nos pedidos, jobs nem no modo da loja B; token de A não vê o modo de B", async () => {
    const a = await setup();
    const b = await setup();
    const pedidoB = await order(b);
    await prisma.printJob.deleteMany({ where: { orderId: pedidoB } });
    await prisma.order.update({ where: { id: pedidoB }, data: { printedAt: null } });
    const pedidoA = await order(a);
    await prisma.printJob.deleteMany({ where: { orderId: pedidoA } });

    expect(json(await setMode(a, "QUEUE")).reconciled.createdJobs).toBe(1);
    expect(await modeOf(b.storeId)).toBe("LEGACY");
    expect(await kitchenJobs(pedidoB)).toHaveLength(0); // B não ganhou job
    expect(json(await app.inject({ method: "GET", url: "/api/device/config", headers: bearer(b.token) }))).toEqual({ mode: "LEGACY" });
    expect(json(await app.inject({ method: "GET", url: "/api/device/config", headers: bearer(a.token) }))).toEqual({ mode: "QUEUE" });
    expect(json(await pending(b)).orders.map((o: { id: string }) => o.id)).toEqual([pedidoB]); // B segue no legado
    expect((await conferenceOf(b)).printableOrderWithoutJob).toBe(1); // a conferência de B só vê B
  });

  it("a rota de modo e a conferência nunca vazam dados de pedido (corpo só com modo e contagens)", async () => {
    const ctx = await setup();
    await order(ctx, { type: "DELIVERY", customerName: "Ana Sigilosa", customerPhone: "11987654321", address: "Rua Sigilosa, 777" });
    const get = await app.inject({ method: "GET", url: "/api/store/print-mode", headers: { cookie: ctx.owner } });
    const put = await setMode(ctx, "QUEUE");
    for (const r of [get, put]) for (const d of ["Sigilosa", "11987654321", "Ana"]) expect(r.body, d).not.toContain(d);
    expect(Object.keys(json(put)).sort()).toEqual(["changed", "conference", "mode", "reconciled"]);
  });
});
