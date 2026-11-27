// SALÃO 3D (opcionais): garçom responsável, pessoas na mesa, reservas (status Reservada) e pedido lançado pelo painel na conta da mesa.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { resetLimits } from "../src/lib/slidingLimit";
import { login, makeApp, registerStore, resetDb } from "./helpers";

describe("salão 3D — opcionais", () => {
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

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const owner = cookie!;
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: owner }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: owner }, payload: { categoryId: cat, name: "Chopp", priceCents: 1650 } })).product.id as string;
    const email = `g-${Math.random().toString(36).slice(2, 8)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email, password: "senha-forte-123" } });
    const staff = (await login(app, email, "senha-forte-123")).cookie!;
    const staffId = (await prisma.user.findFirstOrThrow({ where: { email } })).id;
    const table = json(await app.inject({ method: "POST", url: "/api/tables", headers: { cookie: owner }, payload: { label: "07" } })).table as { id: string; qrToken: string };
    return { owner, staff, staffId, store, productId, table };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const row = async (l: Loja) => (json(await app.inject({ method: "GET", url: "/api/tables", headers: { cookie: l.owner } })).tables as Record<string, unknown>[])[0];

  it("garçom: dono escolhe qualquer um; garçom só assume para si e larga a própria; pessoa de outra loja = 404", async () => {
    const l = await loja();
    const assign = (cookie: string, userId: string | null) => app.inject({ method: "POST", url: `/api/tables/${l.table.id}/waiter`, headers: { cookie }, payload: { userId } });
    expect((await assign(l.staff, l.staffId)).statusCode).toBe(200);
    expect(await row(l)).toMatchObject({ waiter: { id: l.staffId } });

    const ownerId = (await prisma.user.findFirstOrThrow({ where: { storeId: l.store.id, role: "OWNER" } })).id;
    expect((await assign(l.staff, ownerId)).statusCode).toBe(403); // staff não põe outro
    expect((await assign(l.staff, null)).statusCode).toBe(200); // larga a própria
    expect((await assign(l.owner, ownerId)).statusCode).toBe(200);
    expect((await assign(l.staff, null)).statusCode).toBe(403); // não larga a do dono

    const other = await loja();
    expect((await assign(l.owner, other.staffId)).statusCode).toBe(404);
  });

  it("nome de exibição: o dono define, o salão mostra; sem nome, parte do e-mail; equipe não edita; outra loja = 404", async () => {
    const l = await loja();
    await app.inject({ method: "POST", url: `/api/tables/${l.table.id}/waiter`, headers: { cookie: l.owner }, payload: { userId: l.staffId } });
    expect(((await row(l)).waiter as { name: string }).name).toMatch(/^g-/); // sem nome: parte do e-mail
    const set = (cookie: string, userId: string, displayName: string | null) => app.inject({ method: "POST", url: `/api/users/${userId}/name`, headers: { cookie }, payload: { displayName } });
    expect((await set(l.owner, l.staffId, "Ana")).statusCode).toBe(200);
    expect(await row(l)).toMatchObject({ waiter: { id: l.staffId, name: "Ana" } });
    const users = json(await app.inject({ method: "GET", url: "/api/users", headers: { cookie: l.owner } })).users as { id: string; displayName: string | null }[];
    expect(users.find((u) => u.id === l.staffId)?.displayName).toBe("Ana");
    expect((await set(l.staff, l.staffId, "Outra")).statusCode).toBe(403);
    expect((await set(l.owner, l.staffId, "x".repeat(41))).statusCode).toBe(400);
    const other = await loja();
    expect((await set(other.owner, l.staffId, "Hack")).statusCode).toBe(404);
    expect((await set(l.owner, l.staffId, null)).statusCode).toBe(200);
    expect(((await row(l)).waiter as { name: string }).name).toMatch(/^g-/);
  });
  it("pessoas na mesa: mesa sem pedido fica Ocupada; receber a mesa zera", async () => {
    const l = await loja();
    expect((await app.inject({ method: "POST", url: `/api/tables/${l.table.id}/guests`, headers: { cookie: l.staff }, payload: { guests: 4 } })).statusCode).toBe(200);
    expect(await row(l)).toMatchObject({ guests: 4, status: "OCCUPIED" });
    expect((await app.inject({ method: "POST", url: `/api/tables/${l.table.id}/guests`, headers: { cookie: l.staff }, payload: { guests: 0 } })).statusCode).toBe(400);
  });

  it("pedido pelo painel NA MESA: entra na conta, sem pagamento; receber fecha e zera as pessoas", async () => {
    const l = await loja();
    await app.inject({ method: "POST", url: `/api/tables/${l.table.id}/guests`, headers: { cookie: l.staff }, payload: { guests: 2 } });
    const bad = await app.inject({ method: "POST", url: "/api/orders", headers: { cookie: l.staff }, payload: { type: "MESA", tableId: l.table.id, items: [{ productId: l.productId, quantity: 2 }], paymentMethod: "PIX", alreadyPaid: true } });
    expect(bad.statusCode).toBe(400);
    expect(json(bad).code).toBe("TABLE_PAYS_AT_CLOSE");
    expect((await app.inject({ method: "POST", url: "/api/orders", headers: { cookie: l.staff }, payload: { type: "MESA", items: [{ productId: l.productId, quantity: 1 }] } })).statusCode).toBe(400);

    const ok = await app.inject({ method: "POST", url: "/api/orders", headers: { cookie: l.staff }, payload: { type: "MESA", tableId: l.table.id, items: [{ productId: l.productId, quantity: 2 }] } });
    expect(ok.statusCode).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: json(ok).orderId } });
    expect(order).toMatchObject({ tableId: l.table.id, type: "MESA", status: "CONFIRMADO", paymentMethod: null, source: "PAINEL", totalCents: 3300 });
    expect(await row(l)).toMatchObject({ status: "OCCUPIED", accountCents: 3300 });

    const account = json(await app.inject({ method: "GET", url: `/api/tables/${l.table.id}/account`, headers: { cookie: l.staff } }));
    expect(account.totalCents).toBe(3300);
    expect((await app.inject({ method: "POST", url: `/api/tables/${l.table.id}/receive`, headers: { cookie: l.owner }, payload: { paymentMethod: "PIX" } })).statusCode).toBe(201);
    expect(await row(l)).toMatchObject({ status: "FREE", guests: null, accountCents: 0 });
  });

  it("reservas: mesa fica Reservada perto do horário; horário sobreposto = 409; Chegou põe as pessoas na mesa", async () => {
    const l = await loja();
    const soon = new Date(Date.now() + 20 * 60_000).toISOString();
    const later = new Date(Date.now() + 5 * 3600_000).toISOString();
    const create = (startsAt: string, extra: Record<string, unknown> = {}) =>
      app.inject({ method: "POST", url: "/api/reservations", headers: { cookie: l.staff }, payload: { tableId: l.table.id, customerName: "Carla", partySize: 3, startsAt, ...extra } });

    const far = await create(later);
    expect(far.statusCode).toBe(201);
    expect(await row(l)).toMatchObject({ status: "FREE", nextReservation: { customerName: "Carla", partySize: 3 } });

    const near = await create(soon);
    expect(near.statusCode).toBe(201);
    expect(await row(l)).toMatchObject({ status: "RESERVED" });

    const clash = await create(new Date(Date.now() + 40 * 60_000).toISOString());
    expect(clash.statusCode).toBe(409);
    expect(json(clash).code).toBe("RESERVATION_OVERLAP");
    expect((await create(soon, { customerPhone: "123" })).statusCode).toBe(400); // telefone pela regra única

    const id = json(near).reservation.id;
    expect((await app.inject({ method: "PATCH", url: `/api/reservations/${id}`, headers: { cookie: l.staff }, payload: { status: "SEATED" } })).statusCode).toBe(200);
    expect(await row(l)).toMatchObject({ status: "OCCUPIED", guests: 3 });

    const list = json(await app.inject({ method: "GET", url: "/api/reservations", headers: { cookie: l.staff } }));
    expect(list.reservations.map((r: { status: string }) => r.status).sort()).toEqual(["BOOKED", "SEATED"]);

    const other = await loja();
    expect((await app.inject({ method: "PATCH", url: `/api/reservations/${id}`, headers: { cookie: other.owner }, payload: { status: "CANCELED" } })).statusCode).toBe(404);
  });
});
