// API-16 (B9): taxa de entrega por bairro — CA-B9-01..11 (parte de API; endereço estruturado e pedido manual ficam fora).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { applyFreeShipping, parseMoneyToCents, parseZonePaste, zoneNameKey } from "../src/lib/deliveryZones";
import { makeApp, registerStore, resetDb } from "./helpers";

const json = (r: { body: string }) => JSON.parse(r.body);

describe("regras puras (B9)", () => {
  it("nome do bairro é único sem acento/caixa/espaços repetidos (RN-B9-09)", () => {
    expect(zoneNameKey("  São   JOSÉ ")).toBe("sao jose");
  });
  it("taxa em texto vira centavos", () => {
    expect(parseMoneyToCents("6")).toBe(600);
    expect(parseMoneyToCents("6,5")).toBe(650);
    expect(parseMoneyToCents("R$ 6,00")).toBe(600);
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-3")).toBeNull();
    expect(parseMoneyToCents("1,234")).toBeNull();
  });
  it("CA-B9-08: colagem de 30 linhas com 2 inválidas => 28 entram e 2 voltam com o motivo", () => {
    const lines = Array.from({ length: 28 }, (_, i) => `Bairro ${i + 1}; ${i + 1},00`);
    lines.splice(5, 0, "sem ponto e vírgula");
    lines.splice(20, 0, "Fulano; talvez");
    const { valid, errors } = parseZonePaste(lines.join("\n"), new Set());
    expect(valid).toHaveLength(28);
    expect(errors.map((e) => e.line)).toEqual([6, 21]);
    expect(errors.every((e) => e.reason.length > 0)).toBe(true);
  });
  it("repetidos (na colagem e já cadastrados) viram erro", () => {
    const { valid, errors } = parseZonePaste("Centro; 5\ncentro; 6\nPraia; 7", new Set([zoneNameKey("Praia")]));
    expect(valid.map((v) => v.name)).toEqual(["Centro"]);
    expect(errors.map((e) => e.reason)).toEqual(["Bairro repetido", "Bairro repetido"]);
  });
  it("CA-B9-05: frete grátis olha o subtotal LÍQUIDO; regra do bairro vale antes da geral", () => {
    expect(applyFreeShipping(600, 5500, 6000, null)).toBe(600); // R$ 61 bruto, cupom => R$ 55 líquido: cobra
    expect(applyFreeShipping(600, 6100, 6000, null)).toBe(0);
    expect(applyFreeShipping(600, 6100, null, 6000)).toBe(0);
    expect(applyFreeShipping(600, 6100, 9000, 6000)).toBe(600); // bairro manda
    expect(applyFreeShipping(600, 999999, null, null)).toBe(600);
  });
});

describe("taxa por bairro (rotas)", () => {
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

  async function setup(slug: string, code: string, feeCents = 800) {
    const { cookie } = await registerStore(app, { slug, code });
    await app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie: cookie! }, payload: { deliveryFeeCents: feeCents } });
    const category = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } })).category;
    const product = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: category.id, name: "Combo", priceCents: 5000 } })).product;
    return { cookie: cookie!, slug, productId: product.id as string };
  }
  const staffCookie = async (owner: string) => {
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: owner }, payload: { email: `staff-${Math.random().toString(36).slice(2, 8)}@t.com`, password: "provisoria1" } });
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: json(invite).user.email, password: "provisoria1" } });
    return (login.headers["set-cookie"] as string).split(";")[0];
  };
  const addZone = async (cookie: string, payload: Record<string, unknown>) => json(await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie }, payload })).zone as { id: string };
  const orderDelivery = (slug: string, productId: string, extra: Record<string, unknown> = {}) =>
    app.inject({
      method: "POST",
      url: `/stores/${slug}/orders`,
      payload: { type: "DELIVERY", address: "Rua A, 10", customerPhone: "21999999999", items: [{ productId, quantity: 1 }], ...extra },
    });

  it("CA-B9-09: loja sem bairros usa a taxa única, como hoje", async () => {
    const { slug, productId } = await setup("zn-a", "ZA1");
    const res = await orderDelivery(slug, productId);
    expect(res.statusCode).toBe(201);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: json(res).orderId } });
    expect(order.deliveryFeeCents).toBe(800);
    expect(order.totalCents).toBe(5800);
    expect(order.deliveryZoneName).toBeNull();
  });

  it("CA-B9-01/06/07: taxa do bairro entra no total; pedido guarda cópia; editar o bairro depois não muda o pedido; retirada não tem taxa", async () => {
    const { cookie, slug, productId } = await setup("zn-b", "ZB1");
    const centro = await addZone(cookie, { name: "Centro", feeCents: 600, etaMinMinutes: 30, etaMaxMinutes: 45 });
    const res = await orderDelivery(slug, productId, { neighborhoodId: centro.id, expectedDeliveryFeeCents: 600 });
    expect(res.statusCode).toBe(201);
    const id = json(res).orderId;
    let order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect([order.deliveryFeeCents, order.totalCents, order.deliveryZoneName, order.deliveryEtaMinMinutes, order.deliveryEtaMaxMinutes]).toEqual([600, 5600, "Centro", 30, 45]);

    await app.inject({ method: "POST", url: `/api/delivery-zones/${centro.id}`, headers: { cookie }, payload: { name: "Centro Velho", feeCents: 900 } });
    order = await prisma.order.findUniqueOrThrow({ where: { id } });
    expect([order.deliveryFeeCents, order.totalCents, order.deliveryZoneName]).toEqual([600, 5600, "Centro"]);

    const pickup = await app.inject({ method: "POST", url: `/stores/${slug}/orders`, payload: { type: "BALCAO", neighborhoodId: centro.id, items: [{ productId, quantity: 1 }] } });
    expect(pickup.statusCode).toBe(201);
    const pickupOrder = await prisma.order.findUniqueOrThrow({ where: { id: json(pickup).orderId } });
    expect([pickupOrder.deliveryFeeCents, pickupOrder.deliveryZoneName]).toEqual([0, null]);
  });

  it("CA-B9-02: taxa alterada entre abrir o checkout e enviar => 409 DELIVERY_FEE_CHANGED com o novo total, nada gravado", async () => {
    const { cookie, slug, productId } = await setup("zn-c", "ZC1");
    const centro = await addZone(cookie, { name: "Centro", feeCents: 600 });
    await app.inject({ method: "POST", url: `/api/delivery-zones/${centro.id}`, headers: { cookie }, payload: { feeCents: 700 } });
    const res = await orderDelivery(slug, productId, { neighborhoodId: centro.id, expectedDeliveryFeeCents: 600 });
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("DELIVERY_FEE_CHANGED");
    expect(json(res).details).toEqual({ deliveryFeeCents: 700, totalCents: 5700 });
    expect(await prisma.order.count()).toBe(0);
  });

  it("CA-B9-03/04: bairro fora da lista => 400 (padrão); com 'taxa padrão' usa a taxa única; id desconhecido sempre 400", async () => {
    const { cookie, slug, productId } = await setup("zn-d", "ZD1");
    await addZone(cookie, { name: "Centro", feeCents: 600 });
    const refused = await orderDelivery(slug, productId);
    expect(refused.statusCode).toBe(400);
    expect(json(refused).code).toBe("NEIGHBORHOOD_REQUIRED");
    expect(json(refused).details.zones).toHaveLength(1);
    expect((await orderDelivery(slug, productId, { neighborhoodId: "inexistente" })).statusCode).toBe(400);

    const cfg = await app.inject({ method: "POST", url: "/api/delivery-zones/config", headers: { cookie }, payload: { outsideMode: "DEFAULT_FEE" } });
    expect(cfg.statusCode).toBe(200);
    const ok = await orderDelivery(slug, productId);
    expect(ok.statusCode).toBe(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: json(ok).orderId } })).deliveryFeeCents).toBe(800);
    expect((await orderDelivery(slug, productId, { neighborhoodId: "inexistente" })).statusCode).toBe(400);
  });

  it("bairro desativado: recusa com a lista atual de bairros ativos; some do endpoint público", async () => {
    const { cookie, slug, productId } = await setup("zn-e", "ZE1");
    const centro = await addZone(cookie, { name: "Centro", feeCents: 600 });
    await addZone(cookie, { name: "Praia", feeCents: 700 });
    await app.inject({ method: "POST", url: `/api/delivery-zones/${centro.id}`, headers: { cookie }, payload: { active: false } });
    const res = await orderDelivery(slug, productId, { neighborhoodId: centro.id });
    expect(res.statusCode).toBe(400);
    expect(json(res).code).toBe("NEIGHBORHOOD_UNAVAILABLE");
    expect(json(res).details.zones.map((z: { name: string }) => z.name)).toEqual(["Praia"]);
    const pub = json(await app.inject({ method: "GET", url: `/stores/${slug}/delivery-zones` }));
    expect(pub.zones.map((z: { name: string }) => z.name)).toEqual(["Praia"]);
    expect(pub.outsideMode).toBe("REFUSE");
  });

  it("CA-B9-05: frete grátis sobre o subtotal líquido no pedido real (cupom derruba abaixo do limite => cobra)", async () => {
    const { cookie, slug, productId } = await setup("zn-f", "ZF1");
    const centro = await addZone(cookie, { name: "Centro", feeCents: 600, freeFromCents: 5000 });
    const free = await orderDelivery(slug, productId, { neighborhoodId: centro.id });
    expect(json(free).orderId).toBeTruthy();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: json(free).orderId } })).deliveryFeeCents).toBe(0); // R$ 50 >= R$ 50
    await app.inject({ method: "POST", url: "/api/coupons", headers: { cookie }, payload: { code: "DEZ", discountType: "PERCENT", discountValue: 10 } });
    const charged = await orderDelivery(slug, productId, { neighborhoodId: centro.id, couponCode: "DEZ" }); // líquido R$ 45
    expect(charged.statusCode).toBe(201);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: json(charged).orderId } })).deliveryFeeCents).toBe(600);
  });

  it("importação: pré-visualização não grava; confirmar grava só as válidas e audita; limite e duplicados", async () => {
    const { cookie } = await setup("zn-g", "ZG1");
    const text = "Centro; 6,00\nPraia; 7\nlinha ruim\ncentro; 9";
    const preview = json(await app.inject({ method: "POST", url: "/api/delivery-zones/import", headers: { cookie }, payload: { text, dryRun: true } }));
    expect(preview.accepted).toHaveLength(2);
    expect(preview.errors.map((e: { line: number }) => e.line)).toEqual([3, 4]);
    expect(await prisma.deliveryZone.count()).toBe(0);
    const done = json(await app.inject({ method: "POST", url: "/api/delivery-zones/import", headers: { cookie }, payload: { text } }));
    expect(done.accepted).toHaveLength(2);
    expect(await prisma.deliveryZone.count()).toBe(2);
    const again = json(await app.inject({ method: "POST", url: "/api/delivery-zones/import", headers: { cookie }, payload: { text: "Centro; 1" } }));
    expect(again.accepted).toHaveLength(0);
    expect(again.errors[0].reason).toBe("Bairro repetido");

    // limite de 300 por loja
    const store = await prisma.store.findFirstOrThrow({ where: { slug: "zn-g" } });
    await prisma.deliveryZone.createMany({ data: Array.from({ length: 298 }, (_, i) => ({ storeId: store.id, name: `B${i}`, nameKey: `b${i}`, feeCents: 100 })) });
    const over = json(await app.inject({ method: "POST", url: "/api/delivery-zones/import", headers: { cookie }, payload: { text: "Novo1; 1\nNovo2; 2" } }));
    expect(over.accepted).toHaveLength(0);
    expect(over.errors).toHaveLength(2);
    const create = await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie }, payload: { name: "Mais um", feeCents: 100 } });
    expect(create.statusCode).toBe(409);
    expect(json(create).code).toBe("ZONE_LIMIT");
  });

  it("CA-B9-10/RN-B9-11: só OWNER escreve (STAFF lê e leva 403); validação 400; nome duplicado 409; tudo auditado", async () => {
    const { cookie } = await setup("zn-h", "ZH1");
    const staff = await staffCookie(cookie);
    const created = await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie }, payload: { name: "Centro", feeCents: 600 } });
    expect(created.statusCode).toBe(201);
    const id = json(created).zone.id;
    expect((await app.inject({ method: "GET", url: "/api/delivery-zones", headers: { cookie: staff } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie: staff }, payload: { name: "X", feeCents: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/delivery-zones/${id}`, headers: { cookie: staff }, payload: { feeCents: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/delivery-zones/${id}/delete`, headers: { cookie: staff } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/delivery-zones/import", headers: { cookie: staff }, payload: { text: "A; 1" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/delivery-zones/config", headers: { cookie: staff }, payload: { outsideMode: "DEFAULT_FEE" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/delivery-zones" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie }, payload: { name: "", feeCents: -1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie }, payload: { name: "Y", feeCents: 1, etaMinMinutes: 60, etaMaxMinutes: 30 } })).statusCode).toBe(400);
    const dup = await app.inject({ method: "POST", url: "/api/delivery-zones", headers: { cookie }, payload: { name: " CENTRO ", feeCents: 1 } });
    expect(dup.statusCode).toBe(409);
    expect(json(dup).code).toBe("ZONE_DUPLICATE");
    await app.inject({ method: "POST", url: `/api/delivery-zones/${id}`, headers: { cookie }, payload: { feeCents: 650 } });
    await app.inject({ method: "POST", url: `/api/delivery-zones/${id}/delete`, headers: { cookie } });
    let actions: string[] = [];
    for (let i = 0; i < 30 && actions.length < 3; i++) {
      await new Promise((r) => setTimeout(r, 100));
      actions = (await prisma.auditLog.findMany({ where: { action: { startsWith: "delivery_zone." } } })).map((a) => a.action);
    }
    expect(actions.sort()).toEqual(["delivery_zone.create", "delivery_zone.delete", "delivery_zone.update"]);
  });

  it("CA-B9-11: isolamento — a loja B não vê, edita, apaga nem usa bairros da loja A", async () => {
    const a = await setup("zn-i", "ZI1");
    const b = await setup("zn-j", "ZJ1");
    const zone = await addZone(a.cookie, { name: "Centro", feeCents: 600 });
    expect(json(await app.inject({ method: "GET", url: "/api/delivery-zones", headers: { cookie: b.cookie } })).zones).toHaveLength(0);
    expect((await app.inject({ method: "POST", url: `/api/delivery-zones/${zone.id}`, headers: { cookie: b.cookie }, payload: { feeCents: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/delivery-zones/${zone.id}/delete`, headers: { cookie: b.cookie } })).statusCode).toBe(404);
    expect(await prisma.deliveryZone.count({ where: { id: zone.id } })).toBe(1);
    // loja B sem bairros: id da loja A é "não encontrado" só se a loja B tiver bairros; sem bairros, taxa única e o id é ignorado
    await addZone(b.cookie, { name: "Praia", feeCents: 700 });
    const res = await orderDelivery(b.slug, b.productId, { neighborhoodId: zone.id });
    expect(res.statusCode).toBe(400);
    expect(json(res).code).toBe("NEIGHBORHOOD_NOT_FOUND");
    expect(json(await app.inject({ method: "GET", url: `/stores/${b.slug}/delivery-zones` })).zones.map((z: { name: string }) => z.name)).toEqual(["Praia"]);
  });
});
