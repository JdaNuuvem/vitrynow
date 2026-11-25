// SEC-32 (ST-77) aplicado ao kanban: o fuso do BANCO muda (ALTER DATABASE ... SET timezone) e o "hoje" e o cursor dos encerrados do dia
// não podem deslocar. Mesmo método do `sql-timezone.test.ts`: conexões recriadas, São Paulo e Tóquio, com controle positivo do fuso da sessão.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@meucardapio/db";
import { orderStore, productStore } from "./helpers";
import { startOfStoreDay } from "../src/lib/storeTime";
import { makeApp, registerStore, resetDb } from "./helpers";

vi.mock("../src/lib/mercadopago", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/lib/mercadopago")>();
  return { ...original, createPixPayment: vi.fn(), getPayment: vi.fn(), cancelPayment: vi.fn(), refundPayment: vi.fn() };
});

const ZONES = ["America/Sao_Paulo", "Asia/Tokyo"] as const;
const TZ = "America/Sao_Paulo"; // fuso da LOJA (padrão); independente do fuso do banco

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

describe.each(ZONES)("kanban com o banco em %s", (zone) => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    await setDbTimezone(zone);
    expect(await sessionZone()).toBe(zone); // controle positivo: a sessão de fato está no fuso pedido
    vi.clearAllMocks();
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

  async function closedOrder(storeId: string, closedAt: Date, status: "CONCLUIDO" | "CANCELADO" = "CONCLUIDO") {
    seq += 1;
    const createdAt = new Date(closedAt.getTime() - 3_600_000);
    const order = await prisma.order.create({
      data: { storeId, code: `T${String(seq).padStart(5, "0")}`, type: "BALCAO", status, customerName: "Cliente", totalCents: 1500, awaitingPayment: false, createdAt, updatedAt: createdAt },
    });
    await prisma.orderStatusHistory.create({ data: { orderId: order.id, storeId: await orderStore(order.id), status, createdAt: closedAt } });
    return order.id;
  }

  it("o 'hoje' do kanban é o da LOJA: encerrado 1 ms antes da meia-noite da loja fica fora; o da meia-noite exata e o de agora entram", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const todayStart = startOfStoreDay(new Date(), TZ, 0);
    const ontem = await closedOrder(storeId, new Date(todayStart.getTime() - 1));
    const naMeiaNoite = await closedOrder(storeId, todayStart);
    const agora = await closedOrder(storeId, new Date(Date.now() - 1000));
    const res = await app.inject({ method: "GET", url: "/api/orders", headers: { cookie: cookie! } });
    expect(res.statusCode, res.body).toBe(200);
    const ids = json(res).orders.map((o: { id: string }) => o.id) as string[];
    expect(ids).toContain(naMeiaNoite);
    expect(ids).toContain(agora);
    expect(ids).not.toContain(ontem);
  });

  it("o cursor dos encerrados do dia não perde nem repete item (páginas de 2 com 5 pedidos, ordem do instante do encerramento)", async () => {
    const { cookie, response } = await registerStore(app);
    const storeId = json(response).store.id as string;
    const todayStart = startOfStoreDay(new Date(), TZ, 0);
    const criados: string[] = [];
    for (let i = 0; i < 5; i++) criados.push(await closedOrder(storeId, new Date(todayStart.getTime() + 1_000 + i * 1_000))); // do mais antigo ao mais novo
    const esperado = [...criados].reverse(); // mais recente primeiro
    const vistos: string[] = [];
    let cursor: string | null = null;
    let paginas = 0;
    do {
      const res = await app.inject({ method: "GET", url: `/api/orders?limit=2${cursor ? `&cursor=${cursor}` : ""}`, headers: { cookie: cookie! } });
      expect(res.statusCode, res.body).toBe(200);
      const body = json(res);
      vistos.push(...body.orders.map((o: { id: string }) => o.id));
      cursor = body.nextCursor;
      paginas += 1;
    } while (cursor);
    expect(paginas).toBe(3); // 2 + 2 + 1: com o deslocamento do fuso, o cursor pulava página
    expect(vistos).toEqual(esperado);
  });
});
