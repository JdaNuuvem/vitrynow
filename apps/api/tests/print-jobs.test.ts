// API-12 — fila de impressão (ADR-0004 §2, §5, §8). Tabela de casos = SelfTestJobs.ContractTable do Ritchie (PC-03),
// mais concorrência, isolamento entre lojas, cancelamento, reimpressão e erro NÃO confiável do cliente.
import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { printableOrderSchema } from "@meucardapio/shared-types";
import { BACKOFF_SECONDS, FAILURE_CODES, backoffSeconds, normalizeFailureCode, sanitizeDeviceText } from "../src/lib/printJobs";
import { subscribe } from "../src/realtime/hub";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});
import * as mp from "../src/lib/mercadopago";
import * as queue from "../src/modules/printJobs/printJobs.queue";
import { PrintJobService } from "../src/modules/printJobs/printJobs.service";

// O aviso de cancelamento precisa nascer NA transação do cancelamento: aqui o gravador do aviso pode ser feito falhar uma vez.
vi.mock("../src/modules/printJobs/printJobs.queue", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/modules/printJobs/printJobs.queue")>();
  return { ...original, enqueueCancelNoticeIfPrinted: vi.fn(original.enqueueCancelNoticeIfPrinted) };
});

// ───────────── Puros ─────────────
describe("regras puras da fila", () => {
  it("recuo: 15 s, 60 s, 5 min (e fica em 5 min depois)", () => {
    expect([...BACKOFF_SECONDS]).toEqual([15, 60, 300]);
    expect([1, 2, 3, 4, 9].map(backoffSeconds)).toEqual([15, 60, 300, 300, 300]);
    expect(backoffSeconds(0)).toBe(15);
  });
  it("código de falha fora da lista vira OTHER; os da lista passam", () => {
    for (const code of FAILURE_CODES) expect(normalizeFailureCode(code)).toBe(code);
    for (const bad of ["EXPLODIU", "", "printer_offline", null, undefined, 42, { a: 1 }, "OTHER\n"]) expect(normalizeFailureCode(bad), String(bad)).toBe("OTHER");
  });
  it("texto do cliente: sem controle C0/C1, sem bidi/separadores, uma linha, ≤ 200", () => {
    expect(sanitizeDeviceText("a\u0000b\u001bc\u0085d\u200Fe\u202Ef\u2028g\u2069h\ufeffi")).toBe("a b c d e f g h i");
    expect(sanitizeDeviceText("linha1\r\nlinha2\ttab")).toBe("linha1 linha2 tab");
    expect(sanitizeDeviceText("x".repeat(500))!.length).toBe(200);
    expect(sanitizeDeviceText("   ")).toBeNull();
    expect(sanitizeDeviceText(123)).toBeNull();
    expect(sanitizeDeviceText(undefined)).toBeNull();
  });
});

// ───────────── Integração ─────────────
describe("API-12 — PrintJob", () => {
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

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const { id: storeId, slug } = json(response).store;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
    const productId = json(
      await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } }),
    ).product.id as string;
    const mkToken = async (label: string) => json(await app.inject({ method: "POST", url: "/api/device-tokens", headers: { cookie: cookie! }, payload: { label } })).token.token as string;
    return { owner: cookie!, storeId: storeId as string, slug: slug as string, productId, mkToken };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const order = async (ctx: Ctx, extra: Record<string, unknown> = {}) => {
    const res = await app.inject({ method: "POST", url: `/stores/${ctx.slug}/orders`, payload: { type: "BALCAO", items: [{ productId: ctx.productId, quantity: 1 }], ...extra } });
    expect(res.statusCode, res.body).toBe(201);
    return json(res).orderId as string;
  };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const claim = (token: string) => app.inject({ method: "POST", url: "/api/device/print-jobs/claim", headers: bearer(token), payload: {} });
  const ack = (token: string, jobId: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url: `/api/device/print-jobs/${jobId}/ack`, headers: bearer(token), payload: body });
  const jobsOf = (orderId: string) => prisma.printJob.findMany({ where: { orderId }, orderBy: { createdAt: "asc" } });
  const pastLease = (id: string) => prisma.printJob.update({ where: { id }, data: { leaseUntil: new Date(Date.now() - 5000) } });
  const releaseBackoff = (id: string) => prisma.printJob.update({ where: { id }, data: { availableAt: new Date(Date.now() - 1000) } });
  const sockets = (storeId: string) => {
    const sent: string[] = [];
    subscribe(storeId, { readyState: 1, OPEN: 1, send: (m: string) => sent.push(m), on: vi.fn() } as never);
    return (type: string) => sent.filter((m) => JSON.parse(m).type === type);
  };

  // ───────────── Criação do job ─────────────
  it("pedido sem PIX nasce COM o job (mesma transação): 1 ORDER_KITCHEN por pedido, e acorda a impressora pelo WS sem dado nenhum", async () => {
    const ctx = await setup();
    const ws = sockets(ctx.storeId);
    const id = await order(ctx);
    const jobs = await jobsOf(id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "ORDER_KITCHEN", status: "PENDING", attempts: 0, maxAttempts: 3, storeId: ctx.storeId });
    const wake = ws("print.available");
    expect(wake).toHaveLength(1);
    expect(JSON.parse(wake[0])).toEqual({ type: "print.available" }); // só "acorde e peça job"
  });

  it("pedido PIX só ganha job quando o pagamento é APROVADO pelo webhook — e 1 só, mesmo com entregas repetidas e simultâneas", async () => {
    const ctx = await setup();
    const providerPaymentId = `mp-pj-${Date.now()}`;
    vi.mocked(mp.createPixPayment).mockResolvedValueOnce({ providerPaymentId, status: "pending", pixQrCode: "x", pixQrCodeBase64: "y", expiresAt: new Date(Date.now() + 600_000) });
    const id = await order(ctx, { paymentMethod: "PIX" });
    expect(await jobsOf(id)).toHaveLength(0); // aguardando pagamento: não vai para a cozinha

    const pay = await prisma.payment.findUniqueOrThrow({ where: { orderId: id } });
    vi.mocked(mp.getPayment).mockResolvedValue({ providerPaymentId, status: "approved", externalReference: id, amountCents: pay.amountCents, currency: "BRL" } as never);
    const sign = () => {
      const ts = String(Date.now());
      const requestId = `r-${Math.random()}`;
      const v1 = createHmac("sha256", "test-webhook-secret").update(`id:${providerPaymentId};request-id:${requestId};ts:${ts};`).digest("hex");
      return app.inject({ method: "POST", url: "/api/payments/webhook", headers: { "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId }, payload: { type: "payment", data: { id: providerPaymentId } } });
    };
    await Promise.all([sign(), sign(), sign()]);
    await sign();
    expect(await jobsOf(id)).toHaveLength(1);
    expect((await jobsOf(id))[0].kind).toBe("ORDER_KITCHEN");
  });

  // ───────────── Tabela de contrato do Ritchie (ADR-0004 §8) ─────────────
  it("§8.2 claim devolve {job:{id,kind,attempt,leaseSeconds,ticket}} com ticket no schema do §6; leaseSeconds é relativo", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const res = await claim(token);
    expect(res.statusCode).toBe(200);
    const { job } = json(res);
    expect(job).toMatchObject({ kind: "ORDER_KITCHEN", attempt: 1 });
    expect(Number.isInteger(job.leaseSeconds) && job.leaseSeconds >= 1 && job.leaseSeconds <= 120).toBe(true);
    expect(printableOrderSchema.safeParse(job.ticket).success).toBe(true);
    expect(job.ticket).toMatchObject({ orderId: id, ticketSchemaVersion: 3, paymentStatus: "A_COBRAR", cancelNotice: false, reprintCount: 0 });
    const row = (await jobsOf(id))[0];
    expect(row).toMatchObject({ status: "CLAIMED", attempts: 1 });
    expect(row.leaseUntil!.getTime()).toBeGreaterThan(Date.now() - 2000); // lease pelo relógio do banco
  });

  it("§8.1 fila vazia: sempre 200 {job:null}", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const res = await claim(token);
    expect([res.statusCode, json(res)]).toEqual([200, { job: null }]);
  });

  it("§8.4 mesmo dono com lease válida recebe o MESMO job sem gastar tentativa; outro token recebe {job:null}", async () => {
    const ctx = await setup();
    const a = await ctx.mkToken("A");
    const b = await ctx.mkToken("B");
    const id = await order(ctx);
    const first = json(await claim(b)).job;
    const again = json(await claim(b)).job;
    expect([again.id, again.attempt]).toEqual([first.id, 1]);
    expect((await jobsOf(id))[0].attempts).toBe(1);
    expect(json(await claim(a))).toEqual({ job: null }); // CLAIMED por outro com lease válida
  });

  it("§8.5 ack de OUTRO dono ⇒ 409 e o job continua CLAIMED", async () => {
    const ctx = await setup();
    const a = await ctx.mkToken("A");
    const b = await ctx.mkToken("B");
    const id = await order(ctx);
    const job = json(await claim(b)).job;
    const res = await ack(a, job.id, { status: "PRINTED" });
    expect(res.statusCode).toBe(409);
    expect((await jobsOf(id))[0].status).toBe("CLAIMED");
  });

  it("§8.3 FAILED do dono ⇒ 200 e volta a PENDING com availableAt no futuro; o claim NÃO devolve antes; depois do recuo volta com attempt 2", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const job = json(await claim(token)).job;
    const res = await ack(token, job.id, { status: "FAILED", code: "NO_PAPER", error: "sem papel" });
    expect(res.statusCode).toBe(200);
    const row = (await jobsOf(id))[0];
    expect(row).toMatchObject({ status: "PENDING", lastErrorCode: "NO_PAPER", ackStatus: "FAILED" });
    expect(row.availableAt.getTime() - Date.now()).toBeGreaterThan(10_000); // 15 s de recuo, pelo relógio do banco
    expect(row.availableAt.getTime() - Date.now()).toBeLessThanOrEqual(16_000);
    expect(json(await claim(token))).toEqual({ job: null });
    await releaseBackoff(job.id);
    const retry = json(await claim(token)).job;
    expect([retry.id, retry.attempt]).toEqual([job.id, 2]);
  });

  it("§8.3 o recuo cresce a cada falha (15 s, 60 s, 5 min)", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const esperado = [15, 60];
    for (let i = 0; i < 2; i++) {
      const job = json(await claim(token)).job;
      await ack(token, job.id, { status: "FAILED", code: "OTHER" });
      const row = (await jobsOf(id))[0];
      const wait = (row.availableAt.getTime() - Date.now()) / 1000;
      expect(wait, `falha ${i + 1}`).toBeGreaterThan(esperado[i] - 5);
      expect(wait, `falha ${i + 1}`).toBeLessThanOrEqual(esperado[i] + 1);
      await releaseBackoff(row.id);
    }
  });

  it("§8.5 PRINTED do dono ⇒ 200, job PRINTED; repetido ⇒ 200 idempotente; o claim NUNCA devolve PRINTED; pedido ganha printedAt (compat. legado)", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const job = json(await claim(token)).job;
    expect((await ack(token, job.id, { status: "PRINTED" })).statusCode).toBe(200);
    expect((await ack(token, job.id, { status: "PRINTED" })).statusCode).toBe(200);
    expect((await ack(token, job.id, { status: "PRINTED" })).statusCode).toBe(200);
    expect((await jobsOf(id))[0]).toMatchObject({ status: "PRINTED", attempts: 1 });
    expect(json(await claim(token))).toEqual({ job: null });
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).printedAt).not.toBeNull();
  });

  it("§8.5 job inexistente ⇒ 404; de OUTRA loja ⇒ 404 IDÊNTICO (corpo igual)", async () => {
    const a = await setup();
    const b = await setup();
    const tokenB = await b.mkToken("PC-B");
    const id = await order(a);
    const real = (await jobsOf(id))[0].id;
    const alheio = await ack(tokenB, real, { status: "PRINTED" });
    const inexistente = await ack(tokenB, "nao-existe-xyz", { status: "PRINTED" });
    expect([alheio.statusCode, inexistente.statusCode]).toEqual([404, 404]);
    expect(alheio.body).toBe(inexistente.body);
  });

  it("§8.5 ack com a lease VENCIDA ⇒ 409 e o job volta a PENDING; é reoferecido e fecha com PRINTED", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const job = json(await claim(token)).job;
    await pastLease(job.id);
    const res = await ack(token, job.id, { status: "PRINTED" });
    expect(res.statusCode).toBe(409);
    expect((await jobsOf(id))[0].status).toBe("PENDING");
    const again = json(await claim(token)).job;
    expect([again.id, again.attempt]).toEqual([job.id, 2]);
    expect((await ack(token, again.id, { status: "PRINTED" })).statusCode).toBe(200);
  });

  it("lease vencida e OUTRO token reclama: recebe o job (attempt 2); o ack tardio do primeiro dono ⇒ 409 e não reimprime", async () => {
    const ctx = await setup();
    const a = await ctx.mkToken("A");
    const b = await ctx.mkToken("B");
    const id = await order(ctx);
    const jobA = json(await claim(a)).job;
    await pastLease(jobA.id);
    const jobB = json(await claim(b)).job;
    expect([jobB.id, jobB.attempt]).toEqual([jobA.id, 2]);
    expect((await ack(a, jobA.id, { status: "PRINTED" })).statusCode).toBe(409); // A perdeu a lease
    expect((await jobsOf(id))[0].status).toBe("CLAIMED");
    expect((await ack(b, jobB.id, { status: "PRINTED" })).statusCode).toBe(200);
  });

  it("§8.3/§8.6 estourar as 3 tentativas ⇒ FAILED DEFINITIVO e alerta ao painel (print.job_failed); não volta mais à fila", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const ws = sockets(ctx.storeId);
    const id = await order(ctx);
    for (let i = 0; i < 3; i++) {
      const job = json(await claim(token)).job;
      expect(job.attempt).toBe(i + 1);
      await ack(token, job.id, { status: "FAILED", code: "PRINTER_OFFLINE" });
      if (i < 2) await releaseBackoff(job.id);
    }
    const row = (await jobsOf(id))[0];
    expect(row).toMatchObject({ status: "FAILED", attempts: 3 });
    expect(ws("print.job_failed")).toHaveLength(1);
    expect(JSON.parse(ws("print.job_failed")[0])).toEqual({ type: "print.job_failed", jobId: row.id });
    await releaseBackoff(row.id);
    expect(json(await claim(token))).toEqual({ job: null });
  });

  it("lease vencida na última tentativa ⇒ FAILED definitivo no próximo claim (não volta à fila para sempre) + alerta", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const ws = sockets(ctx.storeId);
    const id = await order(ctx);
    await prisma.printJob.updateMany({ where: { orderId: id }, data: { attempts: 2 } });
    const job = json(await claim(token)).job; // 3ª e última tentativa
    expect(job.attempt).toBe(3);
    await pastLease(job.id);
    expect(json(await claim(token))).toEqual({ job: null });
    expect((await jobsOf(id))[0].status).toBe("FAILED");
    expect(ws("print.job_failed")).toHaveLength(1);
  });

  // ───────────── Concorrência e ordem ─────────────
  it("impressoras reclamando ao mesmo tempo NÃO pegam o mesmo job (SKIP LOCKED); cada impressora segura 1 job por vez", async () => {
    const ctx = await setup();
    const tokens = [await ctx.mkToken("A"), await ctx.mkToken("B"), await ctx.mkToken("C")];
    const solo = await order(ctx);
    const duelo = await Promise.all([claim(tokens[0]), claim(tokens[1])]);
    const got = duelo.map((r) => json(r).job).filter(Boolean);
    expect(got).toHaveLength(1); // 1 job na fila: um ganha, o outro recebe null
    expect(got[0].ticket.orderId).toBe(solo);

    for (let i = 0; i < 5; i++) await order(ctx);
    // 9 claims simultâneos de 3 impressoras sobre 6 jobs: cada impressora fica com UM job (re-entrega ao mesmo dono),
    // e nenhum job vai para dois donos nem gasta mais de uma tentativa.
    const results = await Promise.all(Array.from({ length: 9 }, (_, i) => claim(tokens[i % 3])));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const claimed = await prisma.printJob.findMany({ where: { storeId: ctx.storeId, status: "CLAIMED" }, select: { id: true, claimedByTokenId: true, attempts: true } });
    expect(claimed).toHaveLength(3);
    expect(new Set(claimed.map((j) => j.claimedByTokenId)).size).toBe(3); // um dono por job, um job por dono
    for (const j of claimed) expect(j.attempts, "nenhum job foi entregue duas vezes a donos diferentes").toBe(1);
    expect(await prisma.printJob.count({ where: { storeId: ctx.storeId, status: "PENDING" } })).toBe(3);
  });

  it("entrega por ordem de criação (o mais antigo primeiro)", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const primeiro = await order(ctx);
    await new Promise((r) => setTimeout(r, 15));
    const segundo = await order(ctx);
    const j1 = json(await claim(token)).job;
    expect(j1.ticket.orderId).toBe(primeiro);
    await ack(token, j1.id, { status: "PRINTED" });
    expect(json(await claim(token)).job.ticket.orderId).toBe(segundo);
  });

  it("um job que sempre falha (em recuo) NÃO trava a fila: o claim entrega o próximo", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const ruim = await order(ctx);
    await new Promise((r) => setTimeout(r, 15));
    const bom = await order(ctx);
    const j = json(await claim(token)).job;
    expect(j.ticket.orderId).toBe(ruim);
    await ack(token, j.id, { status: "FAILED", code: "DRIVER_ERROR" });
    const next = json(await claim(token)).job;
    expect(next.ticket.orderId).toBe(bom); // o ruim está em recuo, o bom passa na frente
  });

  // ───────────── Isolamento entre lojas ─────────────
  it("token da loja B nunca recebe job da loja A", async () => {
    const a = await setup();
    const b = await setup();
    const tokenB = await b.mkToken("PC-B");
    await order(a);
    expect(json(await claim(tokenB))).toEqual({ job: null });
  });

  it("o BANCO recusa job que liga um pedido de uma loja a OUTRA loja (FK composta, ADR-0009), mesmo por SQL direto", async () => {
    const a = await setup();
    const b = await setup();
    const idA = await order(a);
    await expect(
      prisma.$executeRaw`INSERT INTO "PrintJob" ("id", "storeId", "kind", "orderId", "updatedAt") VALUES ('cruzado-1', ${b.storeId}, 'ORDER_KITCHEN', ${idA}, now())`,
    ).rejects.toThrow(/foreign key|PrintJob_orderId_storeId_fkey/i);
    // O mesmo job na loja certa é aceito (o teste prova que a recusa é do vínculo, não de outra coisa).
    await expect(
      prisma.$executeRaw`INSERT INTO "PrintJob" ("id", "storeId", "kind", "orderId", "updatedAt") VALUES ('certo-1', ${a.storeId}, 'ORDER_REPRINT', ${idA}, now())`,
    ).resolves.toBe(1);
    // TEST não tem pedido (orderId nulo) e não é barrado pela FK composta.
    await expect(prisma.$executeRaw`INSERT INTO "PrintJob" ("id", "storeId", "kind", "updatedAt") VALUES ('teste-1', ${b.storeId}, 'TEST', now())`).resolves.toBe(1);
  });

  it("autenticação: sem token ⇒ 401; token revogado ⇒ 401", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    expect((await app.inject({ method: "POST", url: "/api/device/print-jobs/claim", payload: {} })).statusCode).toBe(401);
    const list = json(await app.inject({ method: "GET", url: "/api/device-tokens", headers: { cookie: ctx.owner } })).tokens;
    await app.inject({ method: "POST", url: `/api/device-tokens/${list[0].id}/revoke`, headers: { cookie: ctx.owner } });
    expect((await claim(token)).statusCode).toBe(401);
  });

  // ───────────── Erro NÃO confiável (Nightingale, ADR-0004 §8.8) ─────────────
  it("ack FAILED: código fora da lista vira OTHER; texto sanitizado; o painel mostra a FRASE do código, nunca o texto do cliente", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const job = json(await claim(token)).job;
    const hostil = "\\\\SERVIDOR\\HP-Joao C:\\Users\\joao.silva\u202E\u0000<script>alert(1)</script>" + "x".repeat(400);
    expect((await ack(token, job.id, { status: "FAILED", code: "FORMATAR_O_DISCO", error: hostil })).statusCode).toBe(200);
    const row = (await jobsOf(id))[0];
    expect(row.lastErrorCode).toBe("OTHER");
    expect(row.lastError!.length).toBeLessThanOrEqual(200);
    expect(row.lastError).not.toMatch(/[\u0000-\u001f\u202e]/);

    const painel = await app.inject({ method: "GET", url: `/api/print-jobs?orderId=${id}`, headers: { cookie: ctx.owner } });
    const dump = painel.body;
    expect(json(painel).jobs[0].failure).toEqual({ code: "OTHER", message: "Não foi possível imprimir." });
    for (const proibido of ["SERVIDOR", "HP-Joao", "joao.silva", "script", "lastError", "claimedByTokenId", "dedupeKey"]) expect(dump, proibido).not.toContain(proibido);
  });

  it("ack inválido (status desconhecido, corpo vazio) ⇒ 400 e o job não muda", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const job = json(await claim(token)).job;
    for (const body of [{}, { status: "TALVEZ" }, { status: 1 }, { status: "FAILED", error: "x".repeat(5000) }]) {
      expect((await ack(token, job.id, body)).statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await jobsOf(id))[0].status).toBe("CLAIMED");
  });

  // ───────────── Cancelamento ─────────────
  it("pedido cancelado ANTES de imprimir: o job vira CANCELED, o claim não entrega e não há aviso", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const res = await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect(res.statusCode).toBe(200);
    const jobs = await jobsOf(id);
    expect(jobs.map((j) => [j.kind, j.status])).toEqual([["ORDER_KITCHEN", "CANCELED"]]);
    expect(json(await claim(token))).toEqual({ job: null });
  });

  it("pedido cancelado DEPOIS de impresso: nasce o AVISO de cancelamento (1 só), sem itens, valores nem contato", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const ws = sockets(ctx.storeId);
    const id = await order(ctx, { customerName: "Ana Secreta", customerPhone: "11987654321", notes: "sem cebola" });
    const original = json(await claim(token)).job;
    await ack(token, original.id, { status: "PRINTED" });
    ws("print.available"); // limpa referência
    const cancel = () => app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect((await cancel()).statusCode).toBe(200);
    await cancel(); // repetido: não duplica
    const notices = (await jobsOf(id)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE");
    expect(notices).toHaveLength(1);

    const next = json(await claim(token)).job;
    expect(next.kind).toBe("ORDER_CANCEL_NOTICE");
    expect(next.ticket).toMatchObject({ cancelNotice: true, orderId: id, items: [], totalCents: 0, address: null, customerName: null, customerPhone: null, notes: null });
    expect(next.ticket.printedAtOriginal).not.toBeNull();
    const dump = JSON.stringify(next.ticket);
    for (const proibido of ["Ana Secreta", "11987654321", "sem cebola"]) expect(dump, proibido).not.toContain(proibido);
  });

  it("C-1 (Nightingale): aviso falha DENTRO da saga de estorno ⇒ pagamento e pedido intactos (PENDENTE, nada dobrado); 'Tentar estorno' conclui com 1 aviso e o provedor é chamado UMA só vez", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const kitchen = json(await claim(token)).job;
    await ack(token, kitchen.id, { status: "PRINTED" }); // o tíquete já saiu: cancelar exige o aviso
    await prisma.order.update({ where: { id }, data: { paymentMethod: "PIX", awaitingPayment: false } });
    await prisma.payment.create({ data: { orderId: id, providerPaymentId: `mp-c1-${id}`, amountCents: 1000, status: "APROVADO" } });
    vi.mocked(mp.refundPayment).mockResolvedValue(undefined);
    vi.mocked(mp.refundPayment).mockClear();

    vi.mocked(queue.enqueueCancelNoticeIfPrinted).mockRejectedValueOnce(new Error("banco falhou ao gravar o aviso"));
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    expect([cancel.statusCode, json(cancel).refund]).toEqual([202, "PENDING"]); // pendente e VISÍVEL, não 500 mudo
    const meio = await prisma.order.findUniqueOrThrow({ where: { id }, include: { payment: true } });
    expect({ status: meio.status, payment: meio.payment?.status, attempts: meio.payment?.refundAttempts }).toEqual({ status: "PENDENTE", payment: "ESTORNO_PENDENTE", attempts: 1 });
    expect(meio.payment?.refundLastError).toContain("falta concluir o cancelamento");
    expect((await jobsOf(id)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE")).toHaveLength(0);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, kind: "CANCEL" } })).toBe(0);
    expect(vi.mocked(mp.refundPayment)).toHaveBeenCalledTimes(1);

    const retry = await app.inject({ method: "POST", url: `/api/orders/${id}/refund/retry`, headers: { cookie: ctx.owner } });
    expect([retry.statusCode, json(retry).refund]).toEqual([200, "DONE"]);
    const fim = await prisma.order.findUniqueOrThrow({ where: { id }, include: { payment: true } });
    expect({ status: fim.status, payment: fim.payment?.status }).toEqual({ status: "CANCELADO", payment: "REEMBOLSADO" });
    expect((await jobsOf(id)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE")).toHaveLength(1);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, kind: "CANCEL" } })).toBe(1);
    expect(vi.mocked(mp.refundPayment)).toHaveBeenCalledTimes(1); // o dinheiro foi devolvido UMA vez: a retentativa só refez a Tx 2
  });

  it("R-1: 2ª via de pedido cancelado ou aguardando pagamento é recusada ANTES de gravar rastro de contato", async () => {
    const ctx = await setup();
    const id = await order(ctx, { type: "DELIVERY", customerPhone: "11987654321", address: "Rua Sigilosa, 77", customerName: "Ana" });
    await app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    const r = await app.inject({ method: "POST", url: `/api/orders/${id}/reprint`, headers: { cookie: ctx.owner } });
    expect([r.statusCode, json(r).code]).toEqual([409, "ORDER_CANCELED"]);
    expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.view_contact", targetId: id } })).toBe(0);
  });

  it("C1 (Deming): se o aviso de cancelamento não puder ser gravado, o cancelamento NÃO acontece (mesma transação); repetido, cancela COM o aviso", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const printed = json(await claim(token)).job;
    await ack(token, printed.id, { status: "PRINTED" });

    vi.mocked(queue.enqueueCancelNoticeIfPrinted).mockRejectedValueOnce(new Error("banco falhou ao gravar o aviso"));
    const cancel = () => app.inject({ method: "POST", url: `/api/orders/${id}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    const falhou = await cancel();
    expect(falhou.statusCode).toBeGreaterThanOrEqual(500); // falha ALTA e visível, não silenciosa
    const aposFalha = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect(aposFalha.status).not.toBe("CANCELADO"); // nada pela metade: o pedido não ficou cancelado sem aviso
    expect((await jobsOf(id)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE")).toHaveLength(0);
    expect(await prisma.orderStatusHistory.count({ where: { orderId: id, kind: "CANCEL" } })).toBe(0);

    const ok = await cancel();
    expect(ok.statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELADO");
    expect((await jobsOf(id)).filter((j) => j.kind === "ORDER_CANCEL_NOTICE")).toHaveLength(1); // cancelou COM o aviso
  });

  // ───────────── Reimpressão e teste ─────────────
  it("reimpressão: job ORDER_REPRINT com contador 1, 2, 3…; a 2ª via leva reprintCount e a hora da 1ª impressão; auditado com o usuário", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const id = await order(ctx);
    const original = json(await claim(token)).job;
    await ack(token, original.id, { status: "PRINTED" });
    const reprint = () => app.inject({ method: "POST", url: `/api/orders/${id}/reprint`, headers: { cookie: ctx.owner } });
    const r1 = await reprint();
    const r2 = await reprint();
    expect([r1.statusCode, json(r1).job.reprintNumber, json(r2).job.reprintNumber]).toEqual([201, 1, 2]);
    expect(Object.keys(json(r1).job).sort()).toEqual(["attempts", "availableAt", "createdAt", "failure", "id", "kind", "maxAttempts", "orderId", "printedAt", "reprintNumber", "status"]);

    const via1 = json(await claim(token)).job;
    expect(via1.kind).toBe("ORDER_REPRINT");
    expect(via1.ticket.reprintCount).toBe(1);
    expect(via1.ticket.printedAtOriginal).not.toBeNull();
    await ack(token, via1.id, { status: "PRINTED" });
    expect(json(await claim(token)).job.ticket.reprintCount).toBe(2);
    await vi.waitFor(async () => expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "print.reprint" } })).toBe(2));
    const log = await prisma.auditLog.findFirstOrThrow({ where: { storeId: ctx.storeId, action: "print.reprint" } });
    expect(log.userId).not.toBeNull();
  });

  it("reimpressão simultânea numera sem repetir (1..5); limite de 10 por pedido; pedido cancelado e de outra loja recusados", async () => {
    const ctx = await setup();
    const other = await setup();
    const id = await order(ctx);
    const reprint = (cookie: string, oid: string) => app.inject({ method: "POST", url: `/api/orders/${oid}/reprint`, headers: { cookie } });
    const burst = await Promise.all(Array.from({ length: 5 }, () => reprint(ctx.owner, id)));
    expect(burst.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201]);
    expect(burst.map((r) => json(r).job.reprintNumber).sort()).toEqual([1, 2, 3, 4, 5]);
    for (let i = 0; i < 5; i++) expect((await reprint(ctx.owner, id)).statusCode).toBe(201);
    const over = await reprint(ctx.owner, id);
    expect([over.statusCode, json(over).code]).toEqual([409, "REPRINT_LIMIT"]);

    const alheio = await reprint(other.owner, id);
    expect([alheio.statusCode, json(alheio).code]).toEqual([404, "ORDER_NOT_FOUND"]);
    const cancelado = await order(ctx);
    await app.inject({ method: "POST", url: `/api/orders/${cancelado}/cancel`, headers: { cookie: ctx.owner }, payload: { reason: { code: "ITEM_EM_FALTA" } } });
    const r = await reprint(ctx.owner, cancelado);
    expect([r.statusCode, json(r).code]).toEqual([409, "ORDER_CANCELED"]);
  });

  it("J1 (Nightingale): STAFF só reimprime pedido ABERTO ou encerrado há < 24 h; pedido antigo ⇒ 403 e nada é criado; OWNER sempre pode", async () => {
    const ctx = await setup();
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    const staff = (login.headers["set-cookie"] as string).split(";")[0];
    const reprint = (cookie: string, oid: string) => app.inject({ method: "POST", url: `/api/orders/${oid}/reprint`, headers: { cookie } });

    const id = await order(ctx, { customerPhone: "11987654321", address: "Rua Sigilosa, 77", type: "DELIVERY", customerName: "Ana" });
    expect((await reprint(staff, id)).statusCode).toBe(201); // aberto

    for (const to of ["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"]) {
      expect((await app.inject({ method: "POST", url: `/api/orders/${id}/transition`, headers: { cookie: ctx.owner }, payload: { to } })).statusCode, to).toBe(200);
    }
    expect((await reprint(staff, id)).statusCode).toBe(201); // encerrado agora (< 24 h)

    await prisma.orderStatusHistory.updateMany({ where: { orderId: id }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });
    const antes = await prisma.printJob.count({ where: { orderId: id, kind: "ORDER_REPRINT" } });
    const negado = await reprint(staff, id);
    expect([negado.statusCode, json(negado).code]).toEqual([403, "FORBIDDEN_ROLE"]);
    expect(await prisma.printJob.count({ where: { orderId: id, kind: "ORDER_REPRINT" } })).toBe(antes); // nada criado
    expect((await reprint(ctx.owner, id)).statusCode).toBe(201); // o dono não tem limite de idade
  });

  it("API-54b: a 2ª via é divulgação de contato — grava order.view_contact ANTES de criar o job (OWNER e STAFF), com dedupe de 10 min", async () => {
    const ctx = await setup();
    const id = await order(ctx, { type: "DELIVERY", customerPhone: "11987654321", address: "Rua Sigilosa, 77", customerName: "Ana" });
    const reprint = () => app.inject({ method: "POST", url: `/api/orders/${id}/reprint`, headers: { cookie: ctx.owner } });
    const views = () => prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.view_contact", targetId: id } });
    expect((await reprint()).statusCode).toBe(201);
    expect(await views()).toBe(1); // sem vi.waitFor: o rastro é parte da resposta
    expect((await reprint()).statusCode).toBe(201);
    expect(await views()).toBe(1); // dedupe de 10 min
    const log = await prisma.auditLog.findFirstOrThrow({ where: { storeId: ctx.storeId, action: "order.view_contact" } });
    expect(JSON.stringify(log)).not.toMatch(/11987654321|Sigilosa|Ana/);
  });

  it("API-54b: se o rastro do contato não puder ser gravado, a 2ª via é RECUSADA (503) e NENHUM job é criado — falha fechada", async () => {
    const ctx = await setup();
    const id = await order(ctx, { type: "DELIVERY", customerPhone: "11987654321", address: "Rua Sigilosa, 77", customerName: "Ana" });
    const user = await prisma.user.findFirstOrThrow({ where: { storeId: ctx.storeId } });
    const quebrado = { log: () => {}, logStrict: async () => { throw new Error("banco indisponível"); } };
    const svc = new PrintJobService(prisma, quebrado, () => {});
    await expect(svc.reprint({ storeId: ctx.storeId, userId: user.id, role: "OWNER" }, id)).rejects.toMatchObject({ statusCode: 503, code: "CONTACT_AUDIT_UNAVAILABLE" });
    expect(await prisma.printJob.count({ where: { orderId: id, kind: "ORDER_REPRINT" } })).toBe(0);
  });

  it("API-54b: pedido sem contato (retirada sem telefone) reimprime sem pedir rastro de contato", async () => {
    const ctx = await setup();
    const id = await order(ctx); // BALCAO sem telefone nem endereço
    const user = await prisma.user.findFirstOrThrow({ where: { storeId: ctx.storeId } });
    const strict = vi.fn(async () => {});
    const svc = new PrintJobService(prisma, { log: () => {}, logStrict: strict }, () => {});
    await svc.reprint({ storeId: ctx.storeId, userId: user.id, role: "OWNER" }, id);
    expect(strict).not.toHaveBeenCalled();
  });

  it("job de TESTE: só o dono cria; o claim traz ticket FICTÍCIO (nenhum dado de loja/cliente); fecha com PRINTED", async () => {
    const ctx = await setup();
    const token = await ctx.mkToken("PC");
    const staffInvite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: ctx.owner }, payload: { email: `staff-${Date.now()}@t.com`, password: "provisoria1" } });
    const staffLogin = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(staffInvite).user.email, password: "provisoria1" } });
    const staff = (staffLogin.headers["set-cookie"] as string).split(";")[0];
    expect((await app.inject({ method: "POST", url: "/api/print-jobs/test", headers: { cookie: staff } })).statusCode).toBe(403);

    const created = await app.inject({ method: "POST", url: "/api/print-jobs/test", headers: { cookie: ctx.owner } });
    expect([created.statusCode, json(created).job.kind, json(created).job.orderId]).toEqual([201, "TEST", null]);
    const job = json(await claim(token)).job;
    expect(job.kind).toBe("TEST");
    expect(printableOrderSchema.safeParse(job.ticket).success).toBe(true);
    expect(job.ticket).toMatchObject({ code: "TESTE", storeName: "Teste de impressora", customerName: null, customerPhone: null, address: null, notes: null });
    // Nada que pareça cobrança (ADR-0004 §8.11): sem paymentStatus, sem forma de pagamento, sem itens, totais zerados.
    expect(job.ticket).not.toHaveProperty("paymentStatus");
    expect(job.ticket).toMatchObject({ paymentMethod: null, items: [], totalCents: 0, deliveryFeeCents: 0, tipCents: 0 });
    for (const campo of ["subtotalCents", "discountCents", "couponCode", "changeForCents", "tableLabel"]) expect(job.ticket, campo).not.toHaveProperty(campo);
    expect(JSON.stringify(job.ticket)).not.toContain(ctx.slug);
    expect((await ack(token, job.id, { status: "PRINTED" })).statusCode).toBe(200);
  });

  it("lista do painel: allowlist, só da própria loja, exige sessão", async () => {
    const a = await setup();
    const b = await setup();
    await order(a);
    await order(b);
    expect((await app.inject({ method: "GET", url: "/api/print-jobs" })).statusCode).toBe(401);
    const jobs = json(await app.inject({ method: "GET", url: "/api/print-jobs", headers: { cookie: a.owner } })).jobs;
    expect(jobs).toHaveLength(1);
    expect(jobs[0].orderId).not.toBeNull();
    expect(await prisma.printJob.count({ where: { storeId: b.storeId } })).toBe(1); // o da B existe e não aparece para A
  });
});
