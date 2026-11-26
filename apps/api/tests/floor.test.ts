// SALÃO 3D: planta (posição/formato/lugares/setor das mesas + elementos do salão), status calculado na API e avisos do QR guardados.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { tableStatusOf } from "@meucardapio/shared-types";
import { resetLimits } from "../src/lib/slidingLimit";
import { makeApp, registerStore, resetDb } from "./helpers";

describe("salão 3D — regra pura do status", () => {
  it("ordem de urgência: inativa > pediu a conta > chamou garçom > aguardando > ocupada > livre", () => {
    const base = { active: true, pendingOrders: 0, accountOrders: 0, callWaiterAt: null, askBillAt: null };
    expect(tableStatusOf(base)).toBe("FREE");
    expect(tableStatusOf({ ...base, accountOrders: 2 })).toBe("OCCUPIED");
    expect(tableStatusOf({ ...base, accountOrders: 2, pendingOrders: 1 })).toBe("WAITING");
    expect(tableStatusOf({ ...base, accountOrders: 2, callWaiterAt: new Date() })).toBe("CALL_WAITER");
    expect(tableStatusOf({ ...base, callWaiterAt: new Date(), askBillAt: new Date() })).toBe("ASK_BILL");
    expect(tableStatusOf({ ...base, active: false, askBillAt: new Date() })).toBe("INACTIVE");
  });
});

describe("salão 3D — integração", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    resetLimits();
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

  async function loja(opts: { plan?: "BASICO" } = {}) {
    const { cookie, response } = await registerStore(app, opts);
    const store = json(response).store as { id: string; slug: string };
    const owner = cookie!;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: owner }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: owner }, payload: { categoryId: cat, name: "Pizza", priceCents: 4000 } })).product.id as string;
    return { owner, store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const mesa = async (l: Loja, label: string) => json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: l.owner }, payload: { label } })).table as { id: string; qrToken: string };
  const lista = async (l: Loja) => json(await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: l.owner } })).tables as {
    id: string; label: string; status: string; openedAt: string | null; callWaiterAt: string | null; askBillAt: string | null; layout: { posX: number; posZ: number; rotation: number; shape: string; seats: number; area: string | null };
  }[];

  it("mesa nova nasce na grade; PATCH muda a planta; PUT /api/floor salva mesas + elementos de uma vez", async () => {
    const l = await loja();
    const a = await mesa(l, "01");
    const b = await mesa(l, "02");
    let tables = await lista(l);
    expect(tables.find((t) => t.id === a.id)!.layout).toEqual({ posX: 0, posZ: 0, rotation: 0, shape: "SQUARE", seats: 4, area: null });
    expect(tables.find((t) => t.id === b.id)!.layout.posX).toBe(2.5);

    const patch = await app.inject({ method: "PATCH", url: `/api/tables/${a.id}`, headers: { cookie: l.owner }, payload: { shape: "ROUND", seats: 2, area: "Varanda" } });
    expect(patch.statusCode).toBe(200);
    expect(json(patch).table.layout).toMatchObject({ shape: "ROUND", seats: 2, area: "Varanda" });

    const put = await app.inject({
      method: "PUT",
      url: "/api/floor",
      headers: { cookie: l.owner },
      payload: {
        tables: [{ id: a.id, posX: 3, posZ: -1.5, rotation: 45 }, { id: b.id, posX: 6, posZ: 2, rotation: 90, shape: "RECT", seats: 6 }],
        elements: [
          { kind: "WALL", posX: 0, posZ: -4, width: 12, depth: 0.15, rotation: 0 },
          { kind: "COUNTER", posX: 4, posZ: 5, width: 4, depth: 0.8, rotation: 0, area: "Bar" },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    tables = await lista(l);
    expect(tables.find((t) => t.id === a.id)!.layout).toMatchObject({ posX: 3, posZ: -1.5, rotation: 45, shape: "ROUND" });
    expect(tables.find((t) => t.id === b.id)!.layout).toMatchObject({ shape: "RECT", seats: 6 });
    const floor = json(await app.inject({ method: "GET", url: "/api/floor", headers: { cookie: l.owner } }));
    expect(floor.elements).toHaveLength(2);
    expect(floor.elements[0]).not.toHaveProperty("storeId");

    // salvar de novo SUBSTITUI os elementos
    await app.inject({ method: "PUT", url: "/api/floor", headers: { cookie: l.owner }, payload: { tables: [], elements: [] } });
    expect(json(await app.inject({ method: "GET", url: "/api/floor", headers: { cookie: l.owner } })).elements).toHaveLength(0);
  });

  it("validação e isolamento: rotação/lugares fora do limite = 400; mesa de outra loja = 404; BASICO não tem o salão (402)", async () => {
    const l = await loja();
    const t = await mesa(l, "01");
    expect((await app.inject({ method: "PATCH", url: `/api/tables/${t.id}`, headers: { cookie: l.owner }, payload: { rotation: 400 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/api/tables/${t.id}`, headers: { cookie: l.owner }, payload: { seats: 0 } })).statusCode).toBe(400);

    const outra = await loja();
    const res = await app.inject({ method: "PUT", url: "/api/floor", headers: { cookie: outra.owner }, payload: { tables: [{ id: t.id, posX: 1 }], elements: [] } });
    expect(res.statusCode).toBe(404);
    expect((await lista(l))[0].layout.posX).toBe(0);

    const basico = await loja({ plan: "BASICO" });
    expect((await app.inject({ method: "GET", url: "/api/floor", headers: { cookie: basico.owner } })).statusCode).toBe(402);
  });

  it("status vem da API; aviso do QR fica guardado até ser atendido; receber a mesa limpa os avisos", async () => {
    const l = await loja();
    await app.inject({ method: "POST", url: "/api/store/qr-settings", headers: { cookie: l.owner }, payload: { qrOrderingEnabled: true, qrOrdersNeedApproval: false, confirmNoApproval: true } });
    const t = await mesa(l, "07");
    expect((await lista(l))[0].status).toBe("FREE");

    const order = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${t.qrToken}/orders`, payload: { items: [{ productId: l.productId, quantity: 1 }] } });
    expect(order.statusCode).toBe(201);
    let row = (await lista(l))[0];
    expect(row.status).toBe("OCCUPIED");
    expect(row.openedAt).not.toBeNull();

    await app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${t.qrToken}/call-waiter` });
    row = (await lista(l))[0];
    expect(row.status).toBe("CALL_WAITER");
    const firstCall = row.callWaiterAt;
    expect(firstCall).not.toBeNull();

    await app.inject({ method: "POST", url: `/stores/${l.store.slug}/tables/${t.qrToken}/ask-bill` });
    expect((await lista(l))[0].status).toBe("ASK_BILL");

    const clear = await app.inject({ method: "POST", url: `/api/tables/${t.id}/alerts/clear`, headers: { cookie: l.owner }, payload: { kind: "CALL_WAITER" } });
    expect(clear.statusCode).toBe(200);
    row = (await lista(l))[0];
    expect(row.callWaiterAt).toBeNull();
    expect(row.status).toBe("ASK_BILL");

    const receive = await app.inject({ method: "POST", url: `/api/tables/${t.id}/receive`, headers: { cookie: l.owner }, payload: { paymentMethod: "PIX" } });
    expect(receive.statusCode).toBe(201);
    row = (await lista(l))[0];
    expect(row.askBillAt).toBeNull();
    expect(row.status).toBe("FREE");
  });
});
