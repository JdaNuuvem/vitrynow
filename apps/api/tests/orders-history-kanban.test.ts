// API-54 / API-62 — kanban (RN-KB), histórico (RN-HP), observação interna e statusChangedAt/serverNow.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { HISTORY_RATE_LIMIT, assertHistoryRate, foldText, parseSearch, resetHistoryRate, resolvePeriod } from "../src/modules/orders/orders.history";
import { startOfStoreDay } from "../src/lib/storeTime";
import { login, makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TZ = "America/Sao_Paulo";

describe("puros: período, busca e limite", () => {
  const now = new Date("2026-11-17T15:00:00Z"); // 12:00 em São Paulo

  it("o dia da loja começa à meia-noite DO FUSO (03:00Z), não à meia-noite UTC", () => {
    expect(startOfStoreDay(now, TZ, 0).toISOString()).toBe("2026-11-17T03:00:00.000Z");
    expect(startOfStoreDay(new Date("2026-11-17T02:00:00Z"), TZ, 0).toISOString()).toBe("2026-11-16T03:00:00.000Z"); // 23:00 de domingo ainda é o dia 16
  });

  it("períodos: hoje, ontem, 7d (padrão), 30d e personalizado com fim inclusivo", () => {
    expect(resolvePeriod({ period: "today" }, now, TZ)).toEqual({ start: new Date("2026-11-17T03:00:00Z"), end: new Date("2026-11-18T03:00:00Z") });
    expect(resolvePeriod({ period: "yesterday" }, now, TZ)).toEqual({ start: new Date("2026-11-16T03:00:00Z"), end: new Date("2026-11-17T03:00:00Z") });
    expect(resolvePeriod({}, now, TZ).start.toISOString()).toBe("2026-11-11T03:00:00.000Z");
    expect(resolvePeriod({ period: "30d" }, now, TZ).start.toISOString()).toBe("2026-10-19T03:00:00.000Z");
    expect(resolvePeriod({ period: "custom", from: "2026-11-01", to: "2026-11-03" }, now, TZ)).toEqual({ start: new Date("2026-11-01T03:00:00Z"), end: new Date("2026-11-04T03:00:00Z") });
  });

  it("período inválido, invertido ou maior que 90 dias é recusado com código", () => {
    expect(() => resolvePeriod({ period: "custom", from: "2026-11-01" }, now, TZ)).toThrow(expect.objectContaining({ code: "PERIOD_INVALID" }));
    expect(() => resolvePeriod({ period: "custom", from: "2026-13-45", to: "2026-11-01" }, now, TZ)).toThrow(expect.objectContaining({ code: "PERIOD_INVALID" }));
    expect(() => resolvePeriod({ period: "custom", from: "2026-11-10", to: "2026-11-01" }, now, TZ)).toThrow(expect.objectContaining({ code: "PERIOD_INVALID" }));
    expect(() => resolvePeriod({ period: "custom", from: "2026-01-01", to: "2026-06-01" }, now, TZ)).toThrow(expect.objectContaining({ code: "PERIOD_TOO_LONG" }));
    expect(() => resolvePeriod({ period: "custom", from: "2026-08-19", to: "2026-11-16" }, now, TZ)).not.toThrow(); // 90 dias cravados
  });

  it("busca: acento e caixa não importam; telefone só com 4+ dígitos; 1 caractere é recusado", () => {
    expect(foldText("Conceição ÁGUA")).toBe("conceicao agua");
    expect(parseSearch("")).toBeNull();
    expect(() => parseSearch("a")).toThrow(expect.objectContaining({ code: "SEARCH_TOO_SHORT" }));
    expect(parseSearch("#0012")).toEqual({ code: "0012", name: null, phone: "0012" });
    expect(parseSearch("12")).toEqual({ code: "12", name: null, phone: null });
    expect(parseSearch("Ana")).toEqual({ code: null, name: "ana", phone: null });
    expect(parseSearch("(11) 98765-4321")).toMatchObject({ phone: "11987654321", name: null });
  });

  it("limite de buscas: 60 por minuto por usuário; a janela anda", () => {
    resetHistoryRate();
    const t0 = 1_000_000;
    for (let i = 0; i < HISTORY_RATE_LIMIT; i++) assertHistoryRate("u1", t0 + i);
    expect(() => assertHistoryRate("u1", t0 + 100)).toThrow(expect.objectContaining({ statusCode: 429, code: "RATE_LIMITED" }));
    expect(() => assertHistoryRate("u2", t0 + 100)).not.toThrow(); // outro usuário não é afetado
    expect(() => assertHistoryRate("u1", t0 + 61_000)).not.toThrow(); // a janela de 1 min passou
    resetHistoryRate();
  });
});

describe("API-54 / API-62 — kanban, histórico e observação interna", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    vi.clearAllMocks();
    resetHistoryRate();
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
  let seq = 0;

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-${Date.now()}-${seq++}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // Cria o pedido direto no banco para controlar data e estado (o que se testa aqui é a LEITURA).
  async function mk(
    ctx: Pick<Ctx, "storeId">,
    data: { ago?: number; status?: "PENDENTE" | "CONFIRMADO" | "EM_PREPARO" | "PRONTO" | "CONCLUIDO" | "CANCELADO"; name?: string; phone?: string; address?: string; awaiting?: boolean; code?: string; history?: { status: "PENDENTE" | "CONFIRMADO" | "CONCLUIDO" | "CANCELADO"; ago: number }[] } = {},
  ) {
    seq += 1;
    const createdAt = new Date(Date.now() - (data.ago ?? 0));
    const order = await prisma.order.create({
      data: {
        storeId: ctx.storeId,
        code: data.code ?? String(seq).padStart(4, "0"),
        type: "DELIVERY",
        status: data.status ?? "PENDENTE",
        customerName: data.name ?? "Cliente",
        customerPhone: data.phone ?? "11987654321",
        address: data.address ?? "Rua das Acácias, 1234",
        totalCents: 1500,
        awaitingPayment: data.awaiting ?? false,
        createdAt,
        updatedAt: createdAt,
      },
    });
    for (const h of data.history ?? []) await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: h.status, createdAt: new Date(Date.now() - h.ago) } });
    return order.id;
  }

  const kanban = async (cookie: string) => json(await app.inject({ method: "GET", url: "/api/orders", headers: { cookie } }));
  const hist = async (cookie: string, qs = "") => app.inject({ method: "GET", url: `/api/orders/history${qs}`, headers: { cookie } });

  describe("kanban (RN-KB)", () => {
    it("pedido ABERTO de dias atrás continua no kanban (selo de ontem); encerrado de ontem sai; encerrado de hoje fica", async () => {
      const ctx = await setup();
      const antigoAberto = await mk(ctx, { ago: 3 * DAY, status: "EM_PREPARO", history: [{ status: "PENDENTE", ago: 3 * DAY }, { status: "CONFIRMADO", ago: 3 * DAY - HOUR }] });
      const abertoHoje = await mk(ctx, { ago: 5 * 60_000, status: "PENDENTE" });
      const concluidoOntem = await mk(ctx, { ago: 2 * DAY, status: "CONCLUIDO", history: [{ status: "CONCLUIDO", ago: 2 * DAY }] });
      const concluidoHoje = await mk(ctx, { ago: 60_000, status: "CONCLUIDO", history: [{ status: "CONCLUIDO", ago: 30_000 }] });
      const pixNaoPago = await mk(ctx, { ago: 60_000, status: "PENDENTE", awaiting: true });

      for (const cookie of [ctx.owner, ctx.staff]) {
        const body = await kanban(cookie);
        const ids = body.orders.map((o: { id: string }) => o.id);
        expect(ids).toContain(antigoAberto);
        expect(ids).toContain(abertoHoje);
        expect(ids).toContain(concluidoHoje);
        expect(ids).not.toContain(concluidoOntem);
        expect(ids).not.toContain(pixNaoPago); // RN-KB-07: só aparece depois de pago
        expect(body).toMatchObject({ timezone: TZ, openCount: 2, staleOpenCount: 1, openCapped: false });
        expect(new Date(body.todayStartsAt).getTime()).toBe(startOfStoreDay(new Date(body.serverNow), TZ, 0).getTime());
      }
    });

    it("dentro dos abertos o que espera há mais tempo no estado vem primeiro; os encerrados do dia vêm depois", async () => {
      const ctx = await setup();
      const recente = await mk(ctx, { ago: 10 * 60_000, status: "PENDENTE" });
      const velho = await mk(ctx, { ago: 40 * 60_000, status: "PENDENTE" });
      const encerrado = await mk(ctx, { ago: 20 * 60_000, status: "CANCELADO", history: [{ status: "CANCELADO", ago: 5 * 60_000 }] });
      const { orders } = await kanban(ctx.owner);
      expect(orders.map((o: { id: string }) => o.id)).toEqual([velho, recente, encerrado]);
    });

    it("encerrado sem registro de histórico entra pelo `updatedAt` de hoje (pedido legado)", async () => {
      const ctx = await setup();
      const legadoHoje = await mk(ctx, { ago: 2 * HOUR, status: "CONCLUIDO" });
      await prisma.order.update({ where: { id: legadoHoje }, data: { status: "CONCLUIDO" } }); // updatedAt = agora
      const legadoAntigo = await mk(ctx, { ago: 3 * DAY, status: "CONCLUIDO" });
      const ids = (await kanban(ctx.owner)).orders.map((o: { id: string }) => o.id);
      expect(ids).toContain(legadoHoje);
      expect(ids).not.toContain(legadoAntigo);
    });

    it("encerrados do dia são paginados por cursor, sem repetir nem perder", async () => {
      const ctx = await setup();
      const created: string[] = [];
      for (let i = 0; i < 5; i++) created.push(await mk(ctx, { ago: (10 + i) * 60_000, status: "CONCLUIDO", history: [{ status: "CONCLUIDO", ago: (5 + i) * 60_000 }] }));
      const first = json(await app.inject({ method: "GET", url: "/api/orders?limit=2", headers: { cookie: ctx.owner } }));
      expect(first.orders).toHaveLength(2);
      expect(first.nextCursor).toBeTruthy();
      const seen = first.orders.map((o: { id: string }) => o.id);
      let cursor: string | null = first.nextCursor;
      while (cursor) {
        const page = json(await app.inject({ method: "GET", url: `/api/orders?limit=2&cursor=${cursor}`, headers: { cookie: ctx.owner } }));
        seen.push(...page.orders.map((o: { id: string }) => o.id));
        cursor = page.nextCursor;
      }
      expect([...seen].sort()).toEqual([...created].sort());
      expect(new Set(seen).size).toBe(5);
    });

    it("API-62: cada pedido leva statusChangedAt (última mudança, ou a criação) e a resposta leva serverNow", async () => {
      const ctx = await setup();
      const semHistorico = await mk(ctx, { ago: 30 * 60_000, status: "PENDENTE" });
      const comHistorico = await mk(ctx, { ago: 50 * 60_000, status: "CONFIRMADO", history: [{ status: "PENDENTE", ago: 50 * 60_000 }, { status: "CONFIRMADO", ago: 12 * 60_000 }] });
      const body = await kanban(ctx.owner);
      const by = (id: string) => body.orders.find((o: { id: string }) => o.id === id);
      expect(new Date(by(semHistorico).statusChangedAt).getTime()).toBe(new Date(by(semHistorico).createdAt).getTime());
      const ms = new Date(body.serverNow).getTime() - new Date(by(comHistorico).statusChangedAt).getTime();
      expect(ms).toBeGreaterThan(11 * 60_000);
      expect(ms).toBeLessThan(13 * 60_000);
      expect(by(comHistorico).serverNow).toBeTruthy();
      expect(Math.abs(new Date(by(comHistorico).serverNow).getTime() - Date.now())).toBeLessThan(10_000);
    });

    it("isolamento: nunca devolve pedido de outra loja", async () => {
      const a = await setup();
      const b = await setup();
      const deB = await mk(b, { status: "PENDENTE" });
      const { orders } = await kanban(a.owner);
      expect(orders.map((o: { id: string }) => o.id)).not.toContain(deB);
    });

    it("a lista não traz endereço nem telefone completo nem a observação interna", async () => {
      const ctx = await setup();
      const id = await mk(ctx, { status: "PENDENTE" });
      await prisma.order.update({ where: { id }, data: { internalNote: "NOTA-INTERNA-SEGREDO" } });
      const body = await kanban(ctx.staff);
      const dump = JSON.stringify(body);
      expect(dump).not.toContain("NOTA-INTERNA-SEGREDO");
      expect(dump).not.toContain("11987654321");
      expect(dump).not.toContain("Acácias");
      expect(body.orders[0]).not.toHaveProperty("internalNote");
    });
  });

  describe("histórico (RN-HP)", () => {
    it("exige sessão", async () => {
      expect((await app.inject({ method: "GET", url: "/api/orders/history" })).statusCode).toBe(401);
    });

    it("período padrão = 7 dias: pedido de 10 dias atrás não aparece; o de 3 dias aparece; STAFF e OWNER veem igual", async () => {
      const ctx = await setup();
      const recente = await mk(ctx, { ago: 3 * DAY, status: "CONCLUIDO" });
      const antigo = await mk(ctx, { ago: 10 * DAY, status: "CONCLUIDO" });
      for (const cookie of [ctx.owner, ctx.staff]) {
        const res = await hist(cookie);
        expect(res.statusCode, res.body).toBe(200);
        const ids = json(res).rows.map((r: { id: string }) => r.id);
        expect(ids).toContain(recente);
        expect(ids).not.toContain(antigo);
        expect(json(res)).toMatchObject({ total: 1, nextCursor: null, timezone: TZ });
      }
      const alt = json(await hist(ctx.owner, "?period=30d")).rows.map((r: { id: string }) => r.id);
      expect(alt).toEqual(expect.arrayContaining([recente, antigo]));
    });

    it("a linha é por allowlist: telefone mascarado, sem endereço e sem nota interna, em qualquer papel", async () => {
      const ctx = await setup();
      const id = await mk(ctx, { status: "CONCLUIDO" });
      await prisma.order.update({ where: { id }, data: { internalNote: "NOTA-INTERNA-SEGREDO" } });
      for (const cookie of [ctx.owner, ctx.staff]) {
        const res = await hist(cookie);
        const dump = res.body;
        for (const proibido of ["11987654321", "Acácias", "address", "NOTA-INTERNA-SEGREDO", "storeId", "publicTokenHash"]) expect(dump, proibido).not.toContain(proibido);
        const [row] = json(res).rows;
        expect(row.customerPhone).toBe("*******4321");
        expect(Object.keys(row).sort()).toEqual(
          ["code", "createdAt", "customerName", "customerPhone", "display", "hasPhone", "id", "notPrinted", "paymentMethod", "paymentStatus", "refundPending", "status", "totalCents", "type"].sort(),
        );
      }
    });

    it("busca única por código, nome (sem acento/caixa) e telefone (4+ dígitos); o endereço NÃO é pesquisável", async () => {
      const ctx = await setup();
      const maria = await mk(ctx, { name: "Maria Conceição", phone: "21999990001", code: "0042", address: "Av. Brasil 10" });
      const joao = await mk(ctx, { name: "João", phone: "11955554321", code: "0043" });
      const ids = async (qs: string) => json(await hist(ctx.owner, qs)).rows.map((r: { id: string }) => r.id);

      expect(await ids("?q=0042")).toEqual([maria]);
      expect(await ids("?q=%2342")).toEqual([maria]); // "#42"
      expect(await ids("?q=conceicao")).toEqual([maria]);
      expect(await ids("?q=CONCEIÇÃO")).toEqual([maria]);
      expect(await ids("?q=joao")).toEqual([joao]);
      expect(await ids("?q=4321")).toEqual([joao]);
      expect(await ids(`?q=${encodeURIComponent("(11) 95555-4321")}`)).toEqual([joao]);
      expect(await ids("?q=Brasil")).toEqual([]); // endereço nunca é buscável
      expect(await ids("?q=zzzz")).toEqual([]);

      const curto = await hist(ctx.owner, "?q=a");
      expect(curto.statusCode).toBe(400);
      expect(json(curto).code).toBe("SEARCH_TOO_SHORT");
    });

    it("a busca não vaza pedidos de outra loja (nem por código, nome ou telefone)", async () => {
      const a = await setup();
      const b = await setup();
      await mk(b, { name: "Fulano Secreto", phone: "11977776666", code: "0099" });
      for (const q of ["0099", "fulano", "7666"]) expect(json(await hist(a.owner, `?q=${q}`)).rows, q).toEqual([]);
      expect(json(await hist(a.owner)).total).toBe(0);
    });

    it("caracteres especiais na busca são literais (sem injeção nem curinga)", async () => {
      const ctx = await setup();
      await mk(ctx, { name: "Ana Souza" });
      for (const q of ["%%", "__", "'; DROP TABLE \"Order\"; --", "a\\"]) {
        const res = await hist(ctx.owner, `?q=${encodeURIComponent(q)}`);
        expect(res.statusCode, q).toBe(200);
        expect(json(res).rows, q).toEqual([]);
      }
      expect(await prisma.order.count()).toBe(1);
    });

    it("filtros: status, tipo, pagamento e estorno pendente", async () => {
      const ctx = await setup();
      const concluido = await mk(ctx, { status: "CONCLUIDO" });
      const cancelado = await mk(ctx, { status: "CANCELADO" });
      const aguardando = await mk(ctx, { status: "PENDENTE", awaiting: true });
      const expirado = await mk(ctx, { status: "CANCELADO", awaiting: true });
      await prisma.order.updateMany({ where: { id: { in: [aguardando, expirado] } }, data: { paymentMethod: "PIX" } });
      await prisma.payment.create({ data: { orderId: expirado, amountCents: 1500, status: "EXPIRADO" } });
      const estorno = await mk(ctx, { status: "CANCELADO" });
      await prisma.order.update({ where: { id: estorno }, data: { paymentMethod: "PIX" } });
      await prisma.payment.create({ data: { orderId: estorno, amountCents: 1500, status: "ESTORNO_PENDENTE" } });

      const ids = async (qs: string) => (json(await hist(ctx.owner, qs)).rows.map((r: { id: string }) => r.id) as string[]).sort();
      expect(await ids("?status=CONCLUIDO")).toEqual([concluido]);
      expect(await ids("?status=CANCELADO")).toEqual([cancelado, estorno].sort());
      expect(await ids("?status=AGUARDANDO_PAGAMENTO")).toEqual([aguardando]);
      expect(await ids("?status=PAGAMENTO_EXPIRADO")).toEqual([expirado]);
      expect(await ids("?refundPending=true")).toEqual([estorno]);
      expect(await ids("?paymentMethod=PIX")).toEqual([aguardando, expirado, estorno].sort());
      expect(await ids("?type=MESA")).toEqual([]);
      expect((await ids("?type=DELIVERY")).length).toBe(5);

      const rows = json(await hist(ctx.owner)).rows as { id: string; display: string }[];
      const display = (id: string) => rows.find((r) => r.id === id)!.display;
      expect(display(aguardando)).toBe("AGUARDANDO_PAGAMENTO");
      expect(display(expirado)).toBe("PAGAMENTO_EXPIRADO"); // o PIX que ninguém pagou não vira "cancelado" na tela
      expect(display(concluido)).toBe("CONCLUIDO");

      const invalido = await hist(ctx.owner, "?status=QUALQUER");
      expect(invalido.statusCode).toBe(400);
      expect(json(invalido).code).toBe("FILTER_INVALID");
    });

    it("período personalizado: recusa mais de 90 dias, data inválida e fim antes do início", async () => {
      const ctx = await setup();
      const erro = async (qs: string) => {
        const res = await hist(ctx.owner, qs);
        expect(res.statusCode, qs).toBe(400);
        return json(res).code;
      };
      expect(await erro("?period=custom&from=2026-01-01&to=2026-11-01")).toBe("PERIOD_TOO_LONG");
      expect(await erro("?period=custom&from=2026-11-10&to=2026-11-01")).toBe("PERIOD_INVALID");
      expect(await erro("?period=custom&from=ontem&to=hoje")).toBe("PERIOD_INVALID");
      expect(await erro("?period=custom")).toBe("PERIOD_INVALID");
      expect(await erro("?period=semana")).toBe("FILTER_INVALID");
    });

    it("paginação por cursor: páginas sem repetir nem perder, mais novo primeiro; total vale o filtro inteiro", async () => {
      const ctx = await setup();
      const created: string[] = [];
      for (let i = 0; i < 7; i++) created.push(await mk(ctx, { ago: i * 60_000 + 1000, status: "CONCLUIDO" }));
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res = await hist(ctx.owner, `?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
        expect(res.statusCode, res.body).toBe(200);
        const body = json(res);
        expect(body.total).toBe(7);
        seen.push(...body.rows.map((r: { id: string }) => r.id));
        cursor = body.nextCursor;
        pages += 1;
      } while (cursor);
      expect(pages).toBe(3);
      expect(seen).toEqual(created); // criados do mais novo ao mais antigo
      expect((await hist(ctx.owner, "?cursor=lixo")).statusCode).toBe(400);
      expect(json(await hist(ctx.owner, "?cursor=lixo")).code).toBe("CURSOR_INVALID");
    });

    it("limite por usuário: a 61ª busca no minuto leva 429 RATE_LIMITED; o outro usuário segue livre", async () => {
      const ctx = await setup();
      for (let i = 0; i < HISTORY_RATE_LIMIT; i++) expect((await hist(ctx.owner)).statusCode).toBe(200);
      const barrado = await hist(ctx.owner);
      expect(barrado.statusCode).toBe(429);
      expect(json(barrado).code).toBe("RATE_LIMITED");
      expect((await hist(ctx.staff)).statusCode).toBe(200);
    });
  });

  describe("observação interna", () => {
    const note = (cookie: string, id: string, body: unknown) => app.inject({ method: "POST", url: `/api/orders/${id}/internal-note`, headers: { cookie }, payload: body as object });

    it("grava, aparece SÓ no detalhe do painel, e apagar com null ou texto vazio", async () => {
      const ctx = await setup();
      const id = await mk(ctx, { status: "PENDENTE" });
      const res = await note(ctx.staff, id, { note: "  Cliente pediu sem cebola  " });
      expect(res.statusCode, res.body).toBe(200);
      expect(json(res)).toEqual({ internalNote: "Cliente pediu sem cebola" });

      const detail = json(await app.inject({ method: "GET", url: `/api/orders/${id}`, headers: { cookie: ctx.owner } })).order;
      expect(detail.internalNote).toBe("Cliente pediu sem cebola");
      expect(JSON.stringify(await kanban(ctx.owner))).not.toContain("sem cebola");
      expect((await hist(ctx.owner)).body).not.toContain("sem cebola");

      expect(json(await note(ctx.owner, id, { note: "   " }))).toEqual({ internalNote: null });
      await note(ctx.owner, id, { note: "de novo" });
      expect(json(await note(ctx.owner, id, { note: null }))).toEqual({ internalNote: null });
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).internalNote).toBeNull();
    });

    it("corta em 500 caracteres; corpo inválido ou nota enorme é recusado", async () => {
      const ctx = await setup();
      const id = await mk(ctx, {});
      const ok = json(await note(ctx.owner, id, { note: "x".repeat(900) }));
      expect(ok.internalNote).toHaveLength(500);
      expect((await note(ctx.owner, id, { note: "x".repeat(2001) })).statusCode).toBe(400);
      expect((await note(ctx.owner, id, { note: 123 })).statusCode).toBe(400);
      expect((await note(ctx.owner, id, {})).statusCode).toBe(400);
    });

    it("pedido de outra loja: 404 e nada é alterado; sem sessão: 401", async () => {
      const a = await setup();
      const b = await setup();
      const deB = await mk(b, {});
      const res = await note(a.owner, deB, { note: "invasão" });
      expect(res.statusCode).toBe(404);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: deB } })).internalNote).toBeNull();
      expect((await app.inject({ method: "POST", url: `/api/orders/${deB}/internal-note`, payload: { note: "x" } })).statusCode).toBe(401);
    });

    it("a auditoria registra QUE mudou e o tamanho, nunca o texto", async () => {
      const ctx = await setup();
      const id = await mk(ctx, {});
      await note(ctx.owner, id, { note: "TEXTO-COM-DADO-PESSOAL 11999998888" });
      await vi.waitFor(async () => {
        const rows = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "order.internal_note", targetId: id } });
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0])).not.toContain("DADO-PESSOAL");
        expect(rows[0].metadata).toEqual({ length: 34 });
      });
    });
  });
});
