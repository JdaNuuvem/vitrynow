// PR-04b — contrato do fuso da loja: `timezone` em GET/POST /api/store/settings e no DTO público; só OWNER escreve; lista fechada (TIMEZONE_INVALID); auditoria com
// valor anterior e novo; mudar o fuso NÃO reescreve pedidos (instantes em UTC), só o "dia" daqui para a frente. Manaus, Noronha e Tóquio.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { STORE_TIMEZONES } from "@meucardapio/shared-types";
import { login, makeApp, registerStore, resetDb } from "./helpers";

describe("PR-04b — fuso da loja no contrato", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
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
  const post = (cookie: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie }, payload });
  const get = (cookie: string) => app.inject({ method: "GET", url: "/api/store/settings", headers: { cookie } });

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    return { owner: cookie!, storeId: store.id, slug: store.slug };
  }

  it("GET traz o fuso (padrão do produto); OWNER muda para Manaus; o cardápio PÚBLICO passa a mostrar o novo fuso", async () => {
    const c = await loja();
    expect(json(await get(c.owner)).store.timezone).toBe("America/Sao_Paulo");
    const r = await post(c.owner, { timezone: "America/Manaus" });
    expect(r.statusCode).toBe(200);
    expect(json(r).store.timezone).toBe("America/Manaus");
    expect(json(await get(c.owner)).store.timezone).toBe("America/Manaus");
    const menu = json(await app.inject({ method: "GET", url: `/stores/${c.slug}/menu` }));
    expect(menu.store.timezone).toBe("America/Manaus");
  });

  it("fora da lista (Tóquio, lixo, número, vazio) = 400 TIMEZONE_INVALID e NADA é gravado", async () => {
    const c = await loja();
    for (const bad of ["Asia/Tokyo", "Lixo/Invalido", "", 3, null]) {
      const r = await post(c.owner, { timezone: bad });
      expect(r.statusCode, String(bad)).toBe(400);
      expect(json(r).code).toBe("TIMEZONE_INVALID");
    }
    expect((await prisma.store.findUniqueOrThrow({ where: { id: c.storeId } })).timezone).toBe("America/Sao_Paulo");
  });

  it("a lista fechada vale para Manaus e Noronha e só tem fusos do Brasil", async () => {
    expect(STORE_TIMEZONES).toContain("America/Manaus");
    expect(STORE_TIMEZONES).toContain("America/Noronha");
    expect(STORE_TIMEZONES.every((z) => z.startsWith("America/"))).toBe(true);
    const c = await loja();
    for (const tz of ["America/Noronha", "America/Manaus", "America/Sao_Paulo"]) expect((await post(c.owner, { timezone: tz })).statusCode).toBe(200);
  });

  it("STAFF não escreve o fuso (403) e o valor não muda; STAFF lê", async () => {
    const c = await loja();
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: c.owner }, payload: { email: "equipe@t.com", password: "provisoria1" } });
    expect(invite.statusCode).toBe(201);
    const staff = (await login(app, "equipe@t.com", "provisoria1")).cookie!;
    expect((await post(staff, { timezone: "America/Manaus" })).statusCode).toBe(403);
    expect((await prisma.store.findUniqueOrThrow({ where: { id: c.storeId } })).timezone).toBe("America/Sao_Paulo");
    expect(json(await get(staff)).store.timezone).toBe("America/Sao_Paulo");
  });

  it("auditoria: guarda valor anterior e novo; reenviar o MESMO fuso não registra mudança", async () => {
    const c = await loja();
    await post(c.owner, { timezone: "America/Noronha" });
    await post(c.owner, { timezone: "America/Noronha" });
    const rows = await prisma.auditLog.findMany({ where: { storeId: c.storeId, action: "store.settings_update" }, orderBy: { createdAt: "asc" } });
    const mudancas = rows.map((r) => (r.metadata as { timezone?: { from: string; to: string } } | null)?.timezone).filter(Boolean);
    expect(mudancas).toEqual([{ from: "America/Sao_Paulo", to: "America/Noronha" }]);
  });

  it("mudar o fuso NÃO reescreve o pedido: o instante fica em UTC e só o 'dia' do relatório muda", async () => {
    const c = await loja();
    const quando = new Date("2026-11-19T02:30:00Z"); // Manaus 18/11 22:30 · Noronha 19/11 00:30
    const o = await prisma.order.create({ data: { storeId: c.storeId, code: "0001", type: "BALCAO", status: "CONFIRMADO", subtotalCents: 5000, totalCents: 5000, paymentMethod: "PIX", createdAt: quando } });
    const dia = async (d: string) => json(await app.inject({ method: "GET", url: `/api/reports/summary?from=${d}&to=${d}`, headers: { cookie: c.owner } })).revenueCents;
    await post(c.owner, { timezone: "America/Manaus" });
    expect(await dia("2026-11-18")).toBe(5000);
    expect(await dia("2026-11-19")).toBe(0);
    await post(c.owner, { timezone: "America/Noronha" });
    expect(await dia("2026-11-18")).toBe(0);
    expect(await dia("2026-11-19")).toBe(5000);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).createdAt.toISOString()).toBe(quando.toISOString()); // intacto
  });

  it("loja LEGADA com fuso fora da lista (Tóquio, gravado direto no banco) continua calculando o dia certo e o DTO público não quebra", async () => {
    const c = await loja();
    await prisma.store.update({ where: { id: c.storeId }, data: { timezone: "Asia/Tokyo" } });
    await prisma.order.create({ data: { storeId: c.storeId, code: "0001", type: "BALCAO", status: "CONFIRMADO", subtotalCents: 3000, totalCents: 3000, paymentMethod: "PIX", createdAt: new Date("2026-11-18T16:00:00Z") } }); // 19/11 01:00 em Tóquio
    const rel = json(await app.inject({ method: "GET", url: "/api/reports/summary?from=2026-11-19&to=2026-11-19", headers: { cookie: c.owner } }));
    expect(rel.timeZone).toBe("Asia/Tokyo");
    expect(rel.revenueCents).toBe(3000);
    expect(json(await app.inject({ method: "GET", url: `/stores/${c.slug}/menu` })).store.timezone).toBe("Asia/Tokyo");
    // e o dono não consegue "escolher" Tóquio de volta pela API
    expect((await post(c.owner, { timezone: "Asia/Tokyo" })).statusCode).toBe(400);
  });
});
