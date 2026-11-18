// SEC-32 (ST-77) aplicado ao histórico: o fuso do BANCO muda (ALTER DATABASE ... SET timezone) e o período, o cursor e a janela de 24 h do
// telefone do STAFF não podem deslocar. Mesmo método do `sql-timezone.test.ts`: conexões recriadas, São Paulo e Tóquio, com controle positivo.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { startOfStoreDay } from "../src/lib/storeTime";
import { resetHistoryRate } from "../src/modules/orders/orders.history";
import { login, makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const ZONES = ["America/Sao_Paulo", "Asia/Tokyo"] as const;
const TZ = "America/Sao_Paulo"; // fuso da LOJA (padrão); independente do fuso do banco
const HOUR = 3_600_000;

async function setDbTimezone(zone: string | null) {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (zone) await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" SET timezone TO '${zone}'`);
  else await prisma.$executeRawUnsafe(`ALTER DATABASE "${db}" RESET timezone`);
  await prisma.$disconnect(); // as próximas conexões do pool nascem com o fuso novo
}
const sessionZone = async () => (await prisma.$queryRaw<{ tz: string }[]>`SELECT current_setting('TimeZone') AS tz`)[0].tz;

beforeAll(async () => setDbTimezone(null)); // um aborto anterior não pode deixar o banco em outro fuso
afterAll(async () => {
  await setDbTimezone(null);
  await prisma.$disconnect();
});

describe.each(ZONES)("histórico com o banco em %s", (zone) => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    await setDbTimezone(zone);
    expect(await sessionZone()).toBe(zone); // controle positivo: a sessão de fato está no fuso pedido
    vi.clearAllMocks();
    resetHistoryRate();
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
    await setDbTimezone(null);
  });

  const json = (r: { body: string }) => JSON.parse(r.body);
  let seq = 0;

  async function setup() {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const invited = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: `staff-tz-${Date.now()}-${seq++}@t.com`, password: "provisoria1" } });
    const staff = (await login(app, json(invited).user.email, "provisoria1")).cookie!;
    return { owner: cookie!, staff, storeId };
  }
  const hist = async (cookie: string, qs = "") => app.inject({ method: "GET", url: `/api/orders/history${qs}`, headers: { cookie } });
  const idsOf = (res: { body: string }) => (json(res).rows as { id: string }[]).map((r) => r.id);

  async function mk(storeId: string, data: { createdAt: Date; status?: "CONCLUIDO" | "PENDENTE"; closedAt?: Date; phone?: string }) {
    seq += 1;
    const status = data.status ?? "CONCLUIDO";
    const order = await prisma.order.create({
      data: { storeId, code: `Y${String(seq).padStart(5, "0")}`, type: "BALCAO", status, customerName: "Cliente", customerPhone: data.phone ?? "11987654321", totalCents: 1500, awaitingPayment: false, createdAt: data.createdAt, updatedAt: data.createdAt },
    });
    if (data.closedAt) await prisma.orderStatusHistory.create({ data: { orderId: order.id, status: "CONCLUIDO", createdAt: data.closedAt } });
    return order.id;
  }

  it("período: 'hoje' e 'ontem' acompanham a meia-noite da LOJA, 1 ms antes/depois, qualquer que seja o fuso do banco", async () => {
    const ctx = await setup();
    const todayStart = startOfStoreDay(new Date(), TZ, 0);
    const ontemNoFim = await mk(ctx.storeId, { createdAt: new Date(todayStart.getTime() - 1) });
    const hojeNoInicio = await mk(ctx.storeId, { createdAt: todayStart });
    const ontemNoInicio = await mk(ctx.storeId, { createdAt: new Date(todayStart.getTime() - 24 * HOUR) });
    const anteontem = await mk(ctx.storeId, { createdAt: new Date(todayStart.getTime() - 24 * HOUR - 1) });
    const hoje = await hist(ctx.owner, "?period=today");
    expect(idsOf(hoje)).toEqual([hojeNoInicio]);
    const ontem = await hist(ctx.owner, "?period=yesterday");
    expect((idsOf(ontem) as string[]).sort()).toEqual([ontemNoFim, ontemNoInicio].sort());
    expect(idsOf(ontem)).not.toContain(anteontem);
    expect(json(hoje).period.from).toBe(todayStart.toISOString());
  });

  it("cursor: 3 páginas de 3 com 7 pedidos, sem perder nem repetir (o cursor de `createdAt` não desloca com o fuso do banco)", async () => {
    const ctx = await setup();
    const base = Date.now() - 2 * HOUR;
    const criados: string[] = [];
    for (let i = 0; i < 7; i++) criados.push(await mk(ctx.storeId, { createdAt: new Date(base - i * 60_000) })); // do mais novo ao mais antigo
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const res = await hist(ctx.owner, `?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.statusCode, res.body).toBe(200);
      vistos.push(...idsOf(res));
      cursor = json(res).nextCursor;
      paginas += 1;
    } while (cursor);
    expect(paginas).toBe(3);
    expect(vistos).toEqual(criados);
  });

  it("ABERTO: o cursor também não desloca (todos os abertos, de qualquer data, em páginas de 2)", async () => {
    const ctx = await setup();
    const criados: string[] = [];
    for (const dias of [0, 1, 40, 100, 200]) criados.push(await mk(ctx.storeId, { createdAt: new Date(Date.now() - dias * 24 * HOUR - 60_000), status: "PENDENTE" }));
    const vistos: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await hist(ctx.owner, `?status=ABERTO&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      vistos.push(...idsOf(res));
      cursor = json(res).nextCursor;
    } while (cursor);
    expect(vistos).toEqual(criados);
  });

  it("janela de 24 h do telefone do STAFF: encerrado há 20 h e 23 h acha; há 25 h, 28 h e 34 h NÃO acha (um deslocamento de fuso de 3 ou 9 h trocaria o resultado)", async () => {
    const ctx = await setup();
    const agora = Date.now();
    const aberto = await mk(ctx.storeId, { createdAt: new Date(agora - 5 * 24 * HOUR), status: "PENDENTE" });
    const dentro = [20, 23].map((h) => ({ h, closedAt: new Date(agora - h * HOUR) }));
    const fora = [25, 28, 34].map((h) => ({ h, closedAt: new Date(agora - h * HOUR) }));
    const idDentro: string[] = [];
    const idFora: string[] = [];
    for (const { closedAt } of dentro) idDentro.push(await mk(ctx.storeId, { createdAt: new Date(closedAt.getTime() - HOUR), closedAt }));
    for (const { closedAt } of fora) idFora.push(await mk(ctx.storeId, { createdAt: new Date(closedAt.getTime() - HOUR), closedAt }));

    const staff = await hist(ctx.staff, `?period=7d&q=${encodeURIComponent("11987654321")}`);
    expect(staff.statusCode, staff.body).toBe(200);
    expect((idsOf(staff) as string[]).sort()).toEqual([aberto, ...idDentro].sort());
    for (const id of idFora) expect(idsOf(staff), "fora das 24 h não pode abrir o telefone").not.toContain(id);
    expect(json(staff).total).toBe(1 + idDentro.length); // a contagem também respeita a regra
    // o OWNER acha todos (a janela é só do STAFF)
    expect(idsOf(await hist(ctx.owner, `?period=7d&q=${encodeURIComponent("11987654321")}`))).toHaveLength(1 + idDentro.length + idFora.length);
  });
});
