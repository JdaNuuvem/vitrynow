// QA — exclusão no catálogo (achado grave da Da Vinci na página 3; spec do Leonardo: "excluir só OWNER, bloqueado
// se o produto está em pedido em aberto, com 'ocultar' no lugar"). Convenção: bug(...) = it.fails; QA_STRICT=1 roda
// como teste normal. A Da Vinci não testou com STAFF: estas sondas cobrem o papel e a regra de negócio no servidor.
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "../helpers";
import { activateSubscription } from "../../src/lib/subscription";

const bug = process.env.QA_STRICT ? it : it.fails;

describe("QA catálogo: exclusão", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => { app = makeApp(); await app.ready(); });
  afterEach(async () => { await app.close(); await resetDb(); });
  afterAll(async () => { await prisma.$disconnect(); });

  async function lojaComStaff() {
    const { cookie, response } = await registerStore(app);
    const store = JSON.parse(response.body).store as { id: string; slug: string };
    const categoryId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "Lanches" } })).body).category.id as string;
    const productId = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId, name: "X-Burger", priceCents: 2800 } })).body).product.id as string;
    // equipe é recurso do PRO (D2/API-08): ativa o PRO só para montar o cenário de STAFF
    await activateSubscription({ subscriptionId: (await prisma.subscription.findFirstOrThrow()).id, planCode: "PRO" });
    const invite = await app.inject({ method: "POST", url: "/api/users", headers: { cookie: cookie! }, payload: { email: "staff-cat@teste.com", password: "senha123" } });
    expect(invite.statusCode).toBe(201);
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "staff-cat@teste.com", password: "senha123" } });
    return { owner: cookie!, staff: (login.headers["set-cookie"] as string).split(";")[0], store, categoryId, productId };
  }

  bug("D34 (RN do catálogo) STAFF NÃO exclui produto: 403 e o produto continua existindo", async () => {
    const l = await lojaComStaff();
    const res = await app.inject({ method: "POST", url: `/api/catalog/products/${l.productId}/delete`, headers: { cookie: l.staff } });
    expect(res.statusCode).toBe(403);
    expect(await prisma.product.count({ where: { id: l.productId } })).toBe(1);
  });

  bug("D35 STAFF NÃO exclui categoria: 403 e a categoria continua existindo", async () => {
    const l = await lojaComStaff();
    await prisma.product.delete({ where: { id: l.productId } }); // categoria sem produto: a única barreira que sobra é o papel
    const res = await app.inject({ method: "POST", url: `/api/catalog/categories/${l.categoryId}/delete`, headers: { cookie: l.staff } });
    expect(res.statusCode).toBe(403);
    expect(await prisma.category.count({ where: { id: l.categoryId } })).toBe(1);
  });

  bug("D36 produto que está em PEDIDO EM ABERTO não pode ser excluído (409): fica 'ocultar'", async () => {
    const l = await lojaComStaff();
    const pedido = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: l.productId, quantity: 1 }] } });
    expect(pedido.statusCode).toBe(201);
    const res = await app.inject({ method: "POST", url: `/api/catalog/products/${l.productId}/delete`, headers: { cookie: l.owner } });
    expect(res.statusCode).toBe(409);
    expect(await prisma.product.count({ where: { id: l.productId } })).toBe(1);
  });

  it("D37 (controle) o DONO exclui produto sem pedido em aberto e o pedido antigo continua com o nome do produto", async () => {
    const l = await lojaComStaff();
    const pedido = await app.inject({ method: "POST", url: `/stores/${l.store.slug}/orders`, payload: { type: "BALCAO", paymentMethod: "DINHEIRO", items: [{ productId: l.productId, quantity: 1 }] } });
    const orderId = JSON.parse(pedido.body).orderId as string;
    await prisma.order.update({ where: { id: orderId }, data: { status: "CONCLUIDO" } }); // pedido encerrado: não bloqueia
    const res = await app.inject({ method: "POST", url: `/api/catalog/products/${l.productId}/delete`, headers: { cookie: l.owner } });
    expect(res.statusCode).toBe(200);
    const item = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    expect(item.productName).toBe("X-Burger");
  });
});
