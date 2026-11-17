// API-54 / API-62 — kanban (RN-KB), histórico (RN-HP), observação interna e statusChangedAt/serverNow.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { HISTORY_PHONE_RATE_LIMIT, HISTORY_RATE_LIMIT, assertHistoryRate, assertPhoneSearchRate, foldText, parseSearch, recordPhoneRefusal, resetHistoryRate, resolvePeriod } from "../src/modules/orders/orders.history";
import { OrderService } from "../src/modules/orders/orders.service";
import { prismaAuditLogger, type AuditLogger } from "../src/shared/audit";
import { startOfStoreDay } from "../src/lib/storeTime";
import { buildPrintableOrder } from "../src/lib/printable";
import { login, makeApp, orderTokenHeader, registerStore, resetDb } from "./helpers";

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
    expect(parseSearch("#0012")).toMatchObject({ code: "0012", name: null, phone: "0012" });
    expect(parseSearch("12")).toMatchObject({ code: "12", name: null, phone: null });
    expect(parseSearch("Ana")).toMatchObject({ code: null, name: "ana", phone: null });
    expect(parseSearch("(11) 98765-4321")).toMatchObject({ phone: "11987654321", name: null });
  });

  it("busca por telefone do STAFF: só 4 dígitos (final) ou 10+; entre 5 e 9 não é critério; OWNER mantém trecho", () => {
    const phoneOf = (q: string, role: "OWNER" | "STAFF") => parseSearch(q, role)?.phone ?? null;
    for (const q of ["1234", "1198765432", "11987654321"]) expect(phoneOf(q, "STAFF"), q).toBe(q);
    for (const q of ["12345", "123456", "1234567", "12345678", "123456789"]) {
      expect(phoneOf(q, "STAFF"), q).toBeNull();
      expect(phoneOf(q, "OWNER"), q).toBe(q);
    }
    expect(parseSearch("1234", "STAFF")?.phoneMatch).toBe("suffix");
    expect(parseSearch("1234", "OWNER")?.phoneMatch).toBe("contains");
  });

  it('código do país: 12/13 dígitos com "55" perdem o "55"; até 11 dígitos não mudam (DDD 55); o STAFF usa o termo já normalizado', () => {
    expect(parseSearch("5511912345678", "OWNER")?.phone).toBe("11912345678");
    expect(parseSearch("551191234567", "OWNER")?.phone).toBe("1191234567"); // 12 dígitos (fixo com DDD)
    expect(parseSearch("+55 (11) 91234-5678", "OWNER")?.phone).toBe("11912345678");
    expect(parseSearch("55991234567", "OWNER")?.phone).toBe("55991234567"); // 11 dígitos: DDD 55, intacto
    expect(parseSearch("5591234567", "OWNER")?.phone).toBe("5591234567"); // 10 dígitos: intacto
    expect(parseSearch("4455912345678", "OWNER")?.phone).toBe("4455912345678"); // não começa em 55: intacto
    expect(parseSearch("5511912345678", "STAFF")?.phone).toBe("11912345678"); // 13 -> 11 dígitos: vale (>= 10, ancorado no final)
    expect(parseSearch("5512345", "STAFF")?.phone).toBeNull(); // 7 dígitos: continua fora para o STAFF
    expect(parseSearch("551234", "STAFF")?.phone).toBeNull(); // 6 dígitos
  });

  it("limite de telefone do STAFF: 10 por hora por usuário; a janela de 1 h anda; outro usuário não é afetado", () => {
    resetHistoryRate();
    const t0 = 5_000_000;
    for (let i = 0; i < HISTORY_PHONE_RATE_LIMIT; i++) assertPhoneSearchRate("u1", t0 + i);
    expect(() => assertPhoneSearchRate("u1", t0 + 60_000)).toThrow(expect.objectContaining({ statusCode: 429, code: "RATE_LIMITED" }));
    expect(() => assertPhoneSearchRate("u2", t0 + 60_000)).not.toThrow();
    expect(() => assertPhoneSearchRate("u1", t0 + 3_600_001 + HISTORY_PHONE_RATE_LIMIT)).not.toThrow(); // passou 1 h
    resetHistoryRate();
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

    it("encerrados do dia ordenados pelo INSTANTE DO ENCERRAMENTO: gravar observação não reordena nem traz de volta pedido antigo (H1)", async () => {
      const ctx = await setup();
      const a = await mk(ctx, { ago: HOUR, status: "CONCLUIDO", history: [{ status: "CONCLUIDO", ago: 10 * 60_000 }] });
      const b = await mk(ctx, { ago: 2 * HOUR, status: "CONCLUIDO", history: [{ status: "CONCLUIDO", ago: 20 * 60_000 }] });
      const c = await mk(ctx, { ago: 3 * HOUR, status: "CANCELADO", history: [{ status: "CANCELADO", ago: 30 * 60_000 }] });
      const velho = await mk(ctx, { ago: 3 * DAY, status: "CONCLUIDO" }); // legado, sem registro de encerramento
      const ordem = async () => (await kanban(ctx.owner)).orders.map((o: { id: string }) => o.id);
      expect(await ordem()).toEqual([a, b, c]);
      for (const id of [c, velho]) expect((await app.inject({ method: "POST", url: `/api/orders/${id}/internal-note`, headers: { cookie: ctx.owner }, payload: { note: "anotei" } })).statusCode).toBe(200);
      expect(await ordem()).toEqual([a, b, c]); // `c` não subiu para o topo e o legado não voltou
    });

    it("teto de abertos: 501 de dias anteriores + 3 de hoje ⇒ os 3 de hoje e os 500 mais ANTIGOS aparecem; openHidden=1, openCapped=true", async () => {
      const ctx = await setup();
      const base = Date.now() - 3 * DAY;
      await prisma.order.createMany({
        data: Array.from({ length: 501 }, (_, i) => ({
          storeId: ctx.storeId, code: `V${String(i).padStart(4, "0")}`, type: "BALCAO" as const, status: "PENDENTE" as const, customerName: "Antigo",
          totalCents: 1000, awaitingPayment: false, createdAt: new Date(base + i * 1000), updatedAt: new Date(base + i * 1000),
        })),
      });
      const hoje = [await mk(ctx, { ago: 3 * 60_000 }), await mk(ctx, { ago: 2 * 60_000 }), await mk(ctx, { ago: 60_000 })];
      const body = await kanban(ctx.owner);
      const codes = new Set(body.orders.map((o: { code: string }) => o.code));
      expect(body).toMatchObject({ openCapped: true, openHidden: 1, openCount: 503, staleOpenCount: 500 });
      for (const id of hoje) expect(body.orders.map((o: { id: string }) => o.id)).toContain(id); // o que acabou de chegar NUNCA some
      expect(codes.has("V0000")).toBe(true);
      expect(codes.has("V0499")).toBe(true);
      expect(codes.has("V0500"), "o mais novo dos antigos é o que fica de fora").toBe(false);
      // o escondido aparece no histórico por ABERTO (período de até 90 dias)
      const aberto = json(await hist(ctx.owner, "?status=ABERTO&period=7d&limit=100"));
      expect(aberto.total).toBe(504); // 501 antigos + 3 de hoje
    });

    it("sem estourar o teto: openCapped=false e openHidden=0", async () => {
      const ctx = await setup();
      await mk(ctx, { ago: 2 * DAY, status: "PENDENTE" });
      await mk(ctx, { status: "PENDENTE" });
      expect(await kanban(ctx.owner)).toMatchObject({ openCapped: false, openHidden: 0, openCount: 2 });
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

    it("telefone do STAFF: 4 finais achou, 4 do meio NÃO, 5–9 dígitos NÃO, número completo achou; OWNER acha por trecho (Nightingale)", async () => {
      const ctx = await setup();
      const id = await mk(ctx, { phone: "11987654321", name: "Zeca" });
      const ids = async (cookie: string, q: string) => json(await hist(cookie, `?q=${encodeURIComponent(q)}`)).rows.map((r: { id: string }) => r.id);

      expect(await ids(ctx.staff, "4321")).toEqual([id]); // os 4 que a máscara já mostra
      expect(await ids(ctx.staff, "6543")).toEqual([]); // 4 do MEIO: não é critério
      expect(await ids(ctx.staff, "8765")).toEqual([]);
      for (const q of ["54321", "654321", "7654321", "87654321", "987654321"]) expect(await ids(ctx.staff, q), `staff ${q}`).toEqual([]); // 5–9 dígitos: o oráculo de reconstrução
      expect(await ids(ctx.staff, "1198765432")).toEqual([]); // 10 dígitos que NÃO terminam no número: não acha
      expect(await ids(ctx.staff, "1987654321")).toEqual([id]); // 10 dígitos ancorados no final
      expect(await ids(ctx.staff, "11987654321")).toEqual([id]); // número completo
      expect(await ids(ctx.staff, "(11) 98765-4321")).toEqual([id]); // com formatação
      expect(await ids(ctx.staff, "zeca")).toEqual([id]); // nome continua funcionando

      for (const q of ["4321", "6543", "54321", "987654", "11987654321"]) expect(await ids(ctx.owner, q), `owner ${q}`).toEqual([id]); // OWNER: trecho
    });

    it("telefone do STAFF não vira oráculo: tentar reconstruir o número dígito a dígito não devolve nada além dos 4 finais", async () => {
      const ctx = await setup();
      await mk(ctx, { phone: "11987654321" });
      let achou = 0;
      for (const prefix of ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
        if ((json(await hist(ctx.staff, `?q=${prefix}4321`)).rows as unknown[]).length) achou += 1; // 5 dígitos: nunca é critério
      }
      expect(achou).toBe(0);
    });

    it("auditoria de contagem: busca por telefone do STAFF grava `order.history_phone_search` SEM os dígitos; OWNER e busca por nome não gravam", async () => {
      const ctx = await setup();
      await mk(ctx, { phone: "11987654321", name: "Zeca" });
      await hist(ctx.staff, "?q=4321");
      await hist(ctx.staff, "?q=zeca");
      await hist(ctx.owner, "?q=4321");
      await vi.waitFor(async () => {
        const rows = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "order.history_phone_search" } });
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0])).not.toContain("4321");
        expect(rows[0].metadata).toEqual({ termLength: 4 });
      });
    });

    it("telefone do STAFF vale só em pedido ABERTO ou encerrado há < 24 h, NA CONSULTA (total e linhas); o OWNER acha todos", async () => {
      const ctx = await setup();
      const aberto = await mk(ctx, { ago: 5 * DAY, status: "EM_PREPARO", phone: "11911112222", name: "Aberto", history: [{ status: "PENDENTE", ago: 5 * DAY }] });
      const recente = await mk(ctx, { ago: 2 * DAY, status: "CONCLUIDO", phone: "11911112222", name: "Recente", history: [{ status: "CONCLUIDO", ago: 2 * HOUR }] });
      const antigo = await mk(ctx, { ago: 3 * DAY, status: "CONCLUIDO", phone: "11911112222", name: "Antigo", history: [{ status: "CONCLUIDO", ago: 30 * HOUR }] });
      const cancelado = await mk(ctx, { ago: 3 * DAY, status: "CANCELADO", phone: "11911112222", name: "Cancelado", history: [{ status: "CANCELADO", ago: 26 * HOUR }] });
      const semHistorico = await mk(ctx, { ago: 3 * DAY, status: "CONCLUIDO", phone: "11911112222", name: "Legado" }); // sem registro de encerramento: o mais restritivo
      const busca = async (cookie: string, q: string) => json(await hist(cookie, `?period=7d&q=${encodeURIComponent(q)}`));

      for (const q of ["2222", "11911112222"]) {
        const staff = await busca(ctx.staff, q);
        expect((staff.rows.map((r: { id: string }) => r.id) as string[]).sort(), q).toEqual([aberto, recente].sort());
        expect(staff.total, `total ${q}`).toBe(2); // a contagem nunca inclui pedido fora da regra
        const owner = await busca(ctx.owner, q);
        expect((owner.rows.map((r: { id: string }) => r.id) as string[]).sort(), `owner ${q}`).toEqual([aberto, recente, antigo, cancelado, semHistorico].sort());
      }
      // o STAFF continua achando o pedido antigo pelo NOME e pelo CÓDIGO (só o telefone tem a janela)
      expect((await busca(ctx.staff, "antigo")).rows.map((r: { id: string }) => r.id)).toEqual([antigo]);
    });

    it("cota de 10 buscas por telefone por hora (STAFF) esgotada: busca SÓ de telefone leva 429; busca que cabe num CÓDIGO cai para código/nome; nome e OWNER seguem livres", async () => {
      const ctx = await setup();
      const pedido = await mk(ctx, { phone: "11987654321", name: "Zeca", code: "1234" });
      for (let i = 0; i < HISTORY_PHONE_RATE_LIMIT; i++) expect((await hist(ctx.staff, "?q=4321")).statusCode, String(i)).toBe(200);

      // 4 dígitos sem match de código: não é 429 (poderia ser um código), mas também NÃO usa o telefone: nenhuma linha, sem oráculo
      const queda = await hist(ctx.staff, "?q=4321");
      expect(queda.statusCode).toBe(200);
      expect(json(queda).rows).toEqual([]);
      // com a cota gasta o STAFF ainda acha pelo CÓDIGO e pelo nome
      expect(json(await hist(ctx.staff, "?q=1234")).rows.map((r: { id: string }) => r.id)).toEqual([pedido]);
      expect(json(await hist(ctx.staff, "?q=%231234")).rows.map((r: { id: string }) => r.id)).toEqual([pedido]);
      expect(json(await hist(ctx.staff, "?q=zeca")).rows.map((r: { id: string }) => r.id)).toEqual([pedido]);

      // busca que seria SÓ de telefone: 429 (10+ dígitos ou com formatação)
      for (const q of ["11987654321", "(11) 98765-4321", "+55 11 98765-4321"]) {
        const barrada = await hist(ctx.staff, `?q=${encodeURIComponent(q)}`);
        expect(barrada.statusCode, q).toBe(429);
        expect(json(barrada).code).toBe("RATE_LIMITED");
      }
      expect((await hist(ctx.owner, "?q=4321")).statusCode).toBe(200);
      expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.history_phone_search" } })).toBe(HISTORY_PHONE_RATE_LIMIT); // só as 10 liberadas

      // rastro das recusas: a 1ª da hora grava (com a contagem); as seguintes não geram linha
      await vi.waitFor(async () => {
        const rows = await prisma.auditLog.findMany({ where: { storeId: ctx.storeId, action: "order.history_phone_search_blocked" } });
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0])).not.toContain("4321");
        expect(rows[0].metadata).toEqual({ termLength: 4, refusals: 1 }); // a queda para código/nome foi a 1ª recusa
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(await prisma.auditLog.count({ where: { storeId: ctx.storeId, action: "order.history_phone_search_blocked" } })).toBe(1);
    });

    it("recusas por limite: a auditoria grava a 1ª da hora e as marcas 10, 100 e 1000 (contagem), nunca as demais; a hora seguinte recomeça", () => {
      resetHistoryRate();
      const t0 = 9_000_000;
      const gravadas: number[] = [];
      for (let i = 1; i <= 1000; i++) {
        const n = recordPhoneRefusal("u1", t0 + i);
        if (n !== null) gravadas.push(n);
      }
      expect(gravadas).toEqual([1, 10, 100, 1000]); // 4 linhas, não 1.000
      expect(recordPhoneRefusal("u2", t0)).toBe(1); // outro usuário tem a própria contagem
      expect(recordPhoneRefusal("u1", t0 + 3_600_000 + 5_000)).toBe(1); // passou a hora: recomeça
      resetHistoryRate();
    });

    it("falha ao gravar o rastro: a ROTA devolve 503 AUDIT_UNAVAILABLE sem dado e sem o erro bruto, e nada vai para console.error (o motivo vai pelo log estruturado)", async () => {
      const ctx = await setup();
      await mk(ctx, { phone: "11987654321", name: "Zeca" });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
      const quebra = vi.spyOn(prismaAuditLogger, "logStrict").mockRejectedValue(new Error("auditoria fora do ar"));
      let res: Awaited<ReturnType<typeof hist>>;
      let doConsole: unknown[][];
      try {
        res = await hist(ctx.staff, "?q=4321");
        doConsole = consoleError.mock.calls.filter((c) => String(c[0]).includes("busca por telefone"));
      } finally {
        quebra.mockRestore();
        consoleError.mockRestore();
      }
      expect(res.statusCode).toBe(503);
      expect(json(res)).toMatchObject({ code: "AUDIT_UNAVAILABLE" });
      expect(res.body).not.toContain("auditoria fora do ar");
      expect(res.body).not.toContain("11987654321");
      expect(doConsole).toEqual([]);
    });

    it("auditoria ESTRITA da busca por telefone: se o rastro não grava, a resposta é 503 AUDIT_UNAVAILABLE e NENHUM dado sai (falha fechada)", async () => {
      const ctx = await setup();
      await mk(ctx, { phone: "11987654321", name: "Zeca" });
      const falha = vi.fn(async () => {
        throw new Error("banco indisponível");
      });
      const audit: AuditLogger = { log: () => {}, logStrict: falha };
      const service = new OrderService(prisma, audit, () => {});
      const staff = { storeId: ctx.storeId, userId: "u-staff", role: "STAFF" as const };
      const erro = await service.history(staff, { q: "4321" }).then(() => null, (e: unknown) => e as { statusCode: number; code: string });
      expect(erro).toMatchObject({ statusCode: 503, code: "AUDIT_UNAVAILABLE" });
      expect(falha).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(falha.mock.calls[0])).not.toContain("4321");
      // nome e OWNER não dependem desse rastro
      expect((await service.history(staff, { q: "zeca" })).rows).toHaveLength(1);
      expect((await service.history({ ...staff, role: "OWNER" }, { q: "4321" })).rows).toHaveLength(1);
      expect(falha).toHaveBeenCalledTimes(1);
    });

    it('código do país: "5511912345678" e "11912345678" acham o mesmo pedido, guardado com ou sem 55; "55991234567" (DDD 55) fica intacto', async () => {
      const ctx = await setup();
      const sem = await mk(ctx, { phone: "11912345678", name: "Sem" });
      const com = await mk(ctx, { phone: "5511912345678", name: "Com" });
      const ddd55 = await mk(ctx, { phone: "55991234567", name: "Gaucho" });
      const ids = async (cookie: string, q: string) => (json(await hist(cookie, `?q=${encodeURIComponent(q)}`)).rows.map((r: { id: string }) => r.id) as string[]).sort();
      for (const cookie of [ctx.owner, ctx.staff]) {
        expect(await ids(cookie, "5511912345678"), "13 dígitos").toEqual([sem, com].sort());
        expect(await ids(cookie, "11912345678"), "11 dígitos").toEqual([sem, com].sort());
        expect(await ids(cookie, "+55 (11) 91234-5678"), "formatado").toEqual([sem, com].sort());
        expect(await ids(cookie, "55991234567"), "DDD 55").toEqual([ddd55]);
      }
      // o STAFF continua sem achar com 5 a 9 dígitos
      expect(await ids(ctx.staff, "912345678")).toEqual([]);
      expect(await ids(ctx.staff, "12345678")).toEqual([]);
    });

    it("nome em Unicode DECOMPOSTO (NFD) já gravado é achado por 'conceicao'; e o checkout grava o nome em NFC", async () => {
      const ctx = await setup();
      const nfd = await mk(ctx, { name: "Conceição Álvares".normalize("NFD") });
      expect(json(await hist(ctx.owner, "?q=conceicao")).rows.map((r: { id: string }) => r.id)).toEqual([nfd]);
      expect(json(await hist(ctx.owner, `?q=${encodeURIComponent("Álvares".normalize("NFD"))}`)).rows.map((r: { id: string }) => r.id)).toEqual([nfd]);

      const { cookie, response } = await registerStore(app);
      const { slug } = json(response).store;
      const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
      const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
      const created = await app.inject({
        method: "POST",
        url: `/stores/${slug}/orders`,
        payload: { type: "DELIVERY", customerName: "João da Conceição".normalize("NFD"), customerPhone: "11987654321", address: "Rua A, 1", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      const gravado = (await prisma.order.findUniqueOrThrow({ where: { id: json(created).orderId } })).customerName!;
      expect(gravado).toBe("João da Conceição".normalize("NFC"));
      expect(gravado.normalize("NFD")).not.toBe(gravado); // o nome tem acento: só a forma mudou
    });

    it("status ABERTO: tudo que o kanban considera em andamento (fora PIX não pago, concluídos e cancelados), de QUALQUER data", async () => {
      const ctx = await setup();
      const pendente = await mk(ctx, { status: "PENDENTE" });
      const preparo = await mk(ctx, { ago: 20 * DAY, status: "EM_PREPARO" });
      const esquecido = await mk(ctx, { ago: 120 * DAY, status: "PRONTO" }); // mais velho que a janela máxima de 90 dias
      await mk(ctx, { status: "CONCLUIDO" });
      await mk(ctx, { ago: 120 * DAY, status: "CONCLUIDO" });
      await mk(ctx, { status: "CANCELADO" });
      await mk(ctx, { status: "PENDENTE", awaiting: true });
      const ids = async (qs: string) => (json(await hist(ctx.owner, qs)).rows.map((r: { id: string }) => r.id) as string[]).sort();
      expect(await ids("?status=ABERTO")).toEqual([pendente, preparo, esquecido].sort()); // sem período: o de 120 dias aparece
      expect(await ids("?status=ABERTO&period=today")).toEqual([pendente, preparo, esquecido].sort()); // período, from e to são IGNORADOS
      expect(await ids("?status=ABERTO&period=custom&from=2026-11-01&to=2026-11-02")).toEqual([pendente, preparo, esquecido].sort());
      expect(await ids("?status=ABERTO&period=custom&from=lixo&to=lixo")).toEqual([pendente, preparo, esquecido].sort()); // nem é validado
      // os outros status mantêm a janela: o de 120 dias NÃO aparece no padrão de 7 dias nem no ALL
      expect(await ids("")).not.toContain(esquecido);
      expect(await ids("?status=ALL")).not.toContain(esquecido);
      expect(await ids("?period=30d")).not.toContain(esquecido);
      expect(await ids("?period=30d")).toContain(preparo);
      const body = json(await hist(ctx.owner, "?status=ABERTO"));
      expect(body).toMatchObject({ total: 3, period: null, timezone: TZ });
      expect(json(await hist(ctx.owner, "")).period).toMatchObject({ from: expect.any(String), to: expect.any(String) }); // os demais seguem com período
    });

    it("ABERTO: cursor percorre TODOS os abertos (mais recente primeiro) sem repetir nem perder; a contagem é a de TODOS", async () => {
      const ctx = await setup();
      const criados: string[] = [];
      for (const dias of [0, 1, 40, 100, 200]) criados.push(await mk(ctx, { ago: dias * DAY + 1000, status: "EM_PREPARO" }));
      const vistos: string[] = [];
      let cursor: string | null = null;
      let paginas = 0;
      do {
        const res = await hist(ctx.owner, `?status=ABERTO&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        expect(res.statusCode, res.body).toBe(200);
        const corpo = json(res);
        expect(corpo.total).toBe(5);
        vistos.push(...corpo.rows.map((r: { id: string }) => r.id));
        cursor = corpo.nextCursor;
        paginas += 1;
      } while (cursor);
      expect(paginas).toBe(3);
      expect(vistos).toEqual(criados); // do mais novo ao mais antigo
    });

    it("ABERTO é isolado por loja e o STAFF vê o telefone mascarado; a busca por telefone do STAFF acha o pedido aberto de qualquer idade", async () => {
      const a = await setup();
      const b = await setup();
      const antigo = await mk(a, { ago: 150 * DAY, status: "CONFIRMADO", phone: "11987654321", name: "Esquecido" });
      await mk(a, { ago: 150 * DAY, status: "CONCLUIDO", phone: "11987654321", name: "Fechado", history: [{ status: "CONCLUIDO", ago: 149 * DAY }] }); // encerrado: fora do ABERTO
      const deB = await mk(b, { ago: 150 * DAY, status: "CONFIRMADO" });
      for (const cookie of [a.owner, a.staff]) {
        const rows = json(await hist(cookie, "?status=ABERTO")).rows as { id: string; customerPhone: string }[];
        expect(rows.map((r) => r.id)).toEqual([antigo]);
        expect(rows[0].customerPhone).toBe("*******4321");
      }
      expect(JSON.stringify(json(await hist(a.owner, "?status=ABERTO")))).not.toContain(deB);
      // STAFF: telefone completo acha o aberto antigo (o aberto está dentro da regra do contato)
      const achados = (json(await hist(a.staff, `?status=ABERTO&q=${encodeURIComponent("11987654321")}`)).rows as { id: string }[]).map((r) => r.id);
      expect(achados).toEqual([antigo]);
    });

    it("a contagem do ABERTO é IGUAL aos abertos do kanban (exibidos + openHidden), com o teto estourado", async () => {
      const ctx = await setup();
      const base = Date.now() - 3 * DAY;
      await prisma.order.createMany({
        data: Array.from({ length: 502 }, (_, i) => ({
          storeId: ctx.storeId, code: `W${String(i).padStart(4, "0")}`, type: "BALCAO" as const, status: i % 2 ? ("PRONTO" as const) : ("PENDENTE" as const), customerName: "Antigo",
          totalCents: 1000, awaitingPayment: false, createdAt: new Date(base + i * 1000), updatedAt: new Date(base + i * 1000),
        })),
      });
      await mk(ctx, { ago: 60_000 });
      await mk(ctx, { ago: 30_000, awaiting: true }); // PIX não pago: fora dos dois
      const kb = await kanban(ctx.owner);
      expect(kb).toMatchObject({ openCapped: true, openHidden: 2 });
      expect(json(await hist(ctx.owner, "?status=ABERTO&limit=1")).total).toBe(kb.openCount + kb.openHidden); // 503 + 2 = 505
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

    it("aceita 500 caracteres; acima disso é 400 NOTE_TOO_LONG e NADA é cortado nem gravado; corpo inválido é recusado", async () => {
      const ctx = await setup();
      const id = await mk(ctx, {});
      expect(json(await note(ctx.owner, id, { note: "x".repeat(500) })).internalNote).toHaveLength(500);
      for (const size of [501, 900, 5000]) {
        const res = await note(ctx.owner, id, { note: "y".repeat(size) });
        expect(res.statusCode, String(size)).toBe(400);
        expect(json(res)).toMatchObject({ code: "NOTE_TOO_LONG", error: "A observação pode ter até 500 caracteres." });
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).internalNote).toBe("x".repeat(500)); // a anterior segue intacta
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

    it("a nota interna NUNCA sai pelo tíquete (buildPrintableOrder), pelo payment-status nem pelo cardápio público", async () => {
      const { cookie, response } = await registerStore(app);
      const { slug } = json(response).store;
      const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "X" } })).category.id;
      const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "P", priceCents: 1000 } })).product.id as string;
      const created = await app.inject({
        method: "POST",
        url: `/stores/${slug}/orders`,
        payload: { type: "DELIVERY", customerName: "Ana", customerPhone: "11987654321", address: "Rua A, 1", paymentMethod: "DINHEIRO", items: [{ productId, quantity: 1 }] },
      });
      expect(created.statusCode, created.body).toBe(201);
      const orderId = json(created).orderId as string;
      const SEGREDO = "NOTA-INTERNA-SEGREDO-777";
      expect((await note(cookie!, orderId, { note: SEGREDO })).statusCode).toBe(200);

      const ticket = await buildPrintableOrder(orderId);
      expect(ticket, "o tíquete tem que existir para a varredura valer").not.toBeNull();
      expect(JSON.stringify(ticket)).not.toContain(SEGREDO);
      expect(JSON.stringify(ticket)).not.toContain("internalNote");

      const status = await app.inject({ method: "GET", url: `/stores/${slug}/orders/${orderId}/payment-status`, headers: orderTokenHeader(orderId) });
      expect(status.statusCode, status.body).toBe(200);
      const menu = await app.inject({ method: "GET", url: `/stores/${slug}/menu` });
      expect(menu.statusCode).toBe(200);
      for (const body of [status.body, menu.body]) {
        expect(body).not.toContain(SEGREDO);
        expect(body).not.toContain("internalNote");
      }
    });

    it("anotar NÃO conta como atividade do pedido: `updatedAt` não muda", async () => {
      const ctx = await setup();
      const id = await mk(ctx, { ago: 3 * HOUR, status: "CONCLUIDO", history: [{ status: "CONCLUIDO", ago: 2 * HOUR }] });
      const antes = (await prisma.order.findUniqueOrThrow({ where: { id } })).updatedAt;
      expect((await note(ctx.owner, id, { note: "uma nota" })).statusCode).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id } })).updatedAt.getTime()).toBe(antes.getTime());
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
