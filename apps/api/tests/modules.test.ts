import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

// Contrato HTTP dos módulos refatorados em camadas (catálogo, cupons, entregadores,
// chaves de impressora, auditoria): mesmos códigos e mensagens de antes da refatoração.
describe("módulos em camadas — contrato HTTP", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;

  const call = (method: "GET" | "POST", url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { cookie }, payload: payload as never });
  const json = (response: { body: string }) => JSON.parse(response.body);

  beforeEach(async () => {
    app = makeApp();
    await app.ready();
    cookie = (await registerStore(app)).cookie!;
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("exige login em todas as rotas dos módulos", async () => {
    for (const url of ["/api/catalog/categories", "/api/coupons", "/api/deliverers", "/api/device-tokens", "/api/audit-log"]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it("categoria com produto não é excluída (409) até o produto sair", async () => {
    const category = json(await call("POST", "/api/catalog/categories", { name: "Lanches", icon: "🍔" })).category;
    expect(category.icon).toBe("🍔");
    const product = json(await call("POST", "/api/catalog/products", { categoryId: category.id, name: "X", priceCents: 1000 })).product;

    const blocked = await call("POST", `/api/catalog/categories/${category.id}/delete`);
    expect(blocked.statusCode).toBe(409);
    expect(json(blocked).error).toContain("categoria tem 1 produto(s)");

    expect((await call("POST", `/api/catalog/products/${product.id}/delete`)).statusCode).toBe(200);
    expect((await call("POST", `/api/catalog/categories/${category.id}/delete`)).statusCode).toBe(200);
  });

  it("emoji vazio limpa o ícone da categoria; produto inexistente é 404", async () => {
    const category = json(await call("POST", "/api/catalog/categories", { name: "Bebidas", icon: "🥤" })).category;
    const cleared = json(await call("POST", `/api/catalog/categories/${category.id}`, { icon: "" })).category;
    expect(cleared.icon).toBeNull();
    const missing = await call("POST", "/api/catalog/products/nao-existe", { name: "x" });
    expect(missing.statusCode).toBe(404);
    expect(json(missing).error).toBe("produto não encontrado");
  });

  it("produto: edita preço e adicionais na mesma chamada", async () => {
    const product = json(
      await call("POST", "/api/catalog/products", { name: "Burger", priceCents: 1500, additionals: [{ name: "Bacon", priceCents: 400 }] }),
    ).product;
    const edited = json(
      await call("POST", `/api/catalog/products/${product.id}`, {
        priceCents: 1700,
        additionals: [{ id: product.additionals[0].id, name: "Bacon duplo", priceCents: 600 }, { name: "Queijo", priceCents: 300 }],
      }),
    ).product;
    expect(edited.priceCents).toBe(1700);
    expect(edited.additionals.map((a: { name: string }) => a.name).sort()).toEqual(["Bacon duplo", "Queijo"]);
  });

  it("cupom: código duplicado é 409 e vem em maiúsculas", async () => {
    const created = await call("POST", "/api/coupons", { code: "promo10", discountType: "PERCENT", discountValue: 10 });
    expect(created.statusCode).toBe(201);
    expect(json(created).coupon.code).toBe("PROMO10");
    const duplicate = await call("POST", "/api/coupons", { code: "PROMO10", discountType: "FIXED", discountValue: 500 });
    expect(duplicate.statusCode).toBe(409);
    expect(json(duplicate)).toMatchObject({ code: "COUPON_CODE_TAKEN", error: "Já existe um cupom com esse código." });
  });

  it("entregador: atribuir a pedido inexistente é 404 e nada quebra", async () => {
    const deliverer = json(await call("POST", "/api/deliverers", { name: "João", phone: "21999999999" })).deliverer;
    const response = await call("POST", "/api/orders/nao-existe/deliverer", { delivererId: deliverer.id });
    expect(response.statusCode).toBe(404);
    expect(json(response).error).toBe("pedido não encontrado");
  });

  it("chave de impressora: cria, aparece offline, revoga; revogar inexistente é 404", async () => {
    const created = json(await call("POST", "/api/device-tokens", { label: "PC do balcão" })).token;
    expect(created.token).toMatch(/^mcd_[A-Za-z0-9_-]{43}$/); // 256 bits, mostrado só nesta resposta
    const listed = json(await call("GET", "/api/device-tokens")).tokens;
    expect(listed[0]).toMatchObject({ id: created.id, online: false, revokedAt: null, tokenPreview: created.token.slice(-4) });
    expect(listed[0]).not.toHaveProperty("token");
    expect(listed[0]).not.toHaveProperty("tokenHash");

    expect((await call("POST", `/api/device-tokens/${created.id}/revoke`)).statusCode).toBe(200);
    expect(json(await call("GET", "/api/device-tokens")).tokens[0].revokedAt).not.toBeNull();

    const missing = await call("POST", "/api/device-tokens/nao-existe/revoke");
    expect(missing.statusCode).toBe(404);
    expect(json(missing).error).toBe("token não encontrado");
  });

  it("ações sensíveis aparecem no log de auditoria do dono", async () => {
    const created = json(await call("POST", "/api/device-tokens", { label: "x" })).token;
    await call("POST", `/api/device-tokens/${created.id}/revoke`);

    // a gravação do log é fire-and-forget: espera aparecer
    let actions: string[] = [];
    for (let i = 0; i < 20 && actions.length < 2; i++) {
      actions = json(await call("GET", "/api/audit-log")).logs.map((l: { action: string }) => l.action);
      if (actions.length < 2) await new Promise((r) => setTimeout(r, 50));
    }
    expect(actions).toEqual(expect.arrayContaining(["device_token.create", "device_token.revoke"]));
  });

  it("equipe: convida, e-mail duplicado é 409, remove; não remove a si mesmo nem o último dono", async () => {
    const invited = await call("POST", "/api/users", { email: "func@teste.com", password: "provisoria1" });
    expect(invited.statusCode).toBe(201);
    const staffId = json(invited).user.id;
    expect(json(invited).user.passwordHash).toBeUndefined();

    const duplicate = await call("POST", "/api/users", { email: "func@teste.com", password: "provisoria1" });
    expect(duplicate.statusCode).toBe(409);
    expect(json(duplicate).error).toBe("já existe um usuário com este e-mail");

    const users = json(await call("GET", "/api/users")).users;
    expect(users.map((u: { role: string }) => u.role).sort()).toEqual(["OWNER", "STAFF"]);
    const ownerId = users.find((u: { role: string }) => u.role === "OWNER").id;

    const self = await call("POST", `/api/users/${ownerId}/delete`);
    expect(self.statusCode).toBe(400);
    expect(json(self).error).toBe("você não pode remover a si mesmo");

    expect((await call("POST", `/api/users/${staffId}/delete`)).statusCode).toBe(200);
    const gone = await call("POST", `/api/users/${staffId}/delete`);
    expect(gone.statusCode).toBe(404);
  });

  it("troca de senha: atual errada é 401; certa funciona e o login passa a usar a nova", async () => {
    const wrong = await call("POST", "/auth/change-password", { currentPassword: "errada", newPassword: "nova-senha1" });
    expect(wrong.statusCode).toBe(401);
    expect(json(wrong).error).toBe("senha atual incorreta");

    const ok = await call("POST", "/auth/change-password", { currentPassword: "senha12345", newPassword: "nova-senha1" });
    expect(ok.statusCode).toBe(200);

    const loginOld = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "dono1@teste.com", password: "senha12345" } });
    expect(loginOld.statusCode).toBe(401);
  });

  it("erros que não são de domínio seguem o tratamento padrão (JSON quebrado = 400)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/catalog/categories",
      headers: { cookie, "content-type": "application/json" },
      payload: "{quebrado",
    });
    expect(response.statusCode).toBe(400);
  });
});
