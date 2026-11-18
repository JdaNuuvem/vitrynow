import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { customDomainSchema } from "@meucardapio/shared-types";
import { prisma } from "@meucardapio/db";
import { makeApp, registerStore, resetDb } from "./helpers";

// SEC-14 (ST-18): `customDomain` é um nome de host válido, normalizado em minúsculas e ÚNICO entre as lojas.

describe("SEC-14/ST-18: validação do domínio próprio", () => {
  it.each([
    ["cardapio.minhaloja.com.br", "cardapio.minhaloja.com.br"],
    ["  CARDAPIO.MinhaLoja.com.br  ", "cardapio.minhaloja.com.br"],
    ["minhaloja.com.", "minhaloja.com"],
    ["xn--caf-dma.example.xn--p1ai", "xn--caf-dma.example.xn--p1ai"],
  ])("aceita e normaliza %j", (entrada, esperado) => {
    expect(customDomainSchema.parse(entrada)).toBe(esperado);
  });

  it.each([
    "http://minhaloja.com",
    "https://minhaloja.com/cardapio",
    "minhaloja.com:8443",
    "minhaloja.com/",
    "localhost",
    "minhaloja",
    "192.168.0.10",
    "10.0.0.1",
    "-minhaloja.com",
    "minha_loja.com",
    "minha loja.com",
    "minhaloja..com",
    "a".repeat(64) + ".com",
    "x." + "a".repeat(250) + ".com",
    "minhaloja.c0m",
    "",
    "javascript:alert(1)",
    "minhaloja.com\r\nHost: evil.com",
  ])("recusa %j", (entrada) => {
    expect(customDomainSchema.safeParse(entrada).success).toBe(false);
  });
});

describe("SEC-14/ST-18: unicidade e rota de configurações", () => {
  let app: ReturnType<typeof makeApp>;
  beforeEach(async () => {
    await resetDb();
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

  const settings = (cookie: string, customDomain: string) =>
    app.inject({ method: "POST", url: "/api/store/settings", headers: { cookie }, payload: { customDomain } });

  it("grava normalizado; a MESMA loja repete sem erro; trocar e limpar funcionam", async () => {
    const { cookie } = await registerStore(app);
    const first = await settings(cookie!, "  Cardapio.MinhaLoja.com.br ");
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).store.customDomain).toBe("cardapio.minhaloja.com.br");
    expect((await settings(cookie!, "cardapio.minhaloja.com.br")).statusCode).toBe(200);
    expect(JSON.parse((await settings(cookie!, "outro.minhaloja.com.br")).body).store.customDomain).toBe("outro.minhaloja.com.br");
    expect(JSON.parse((await settings(cookie!, "")).body).store.customDomain).toBeNull();
  });

  it("formato inválido ⇒ 400 e nada é gravado", async () => {
    const { cookie } = await registerStore(app);
    for (const bad of ["http://x.com", "localhost", "10.0.0.1", "x.com/caminho"]) {
      expect((await settings(cookie!, bad)).statusCode, bad).toBe(400);
    }
    expect(await prisma.store.count({ where: { customDomain: { not: null } } })).toBe(0);
  });

  it("OUTRA loja pedindo o mesmo domínio (mesmo com maiúsculas) ⇒ 409 CUSTOM_DOMAIN_TAKEN; a dona original segue com ele", async () => {
    const a = await registerStore(app);
    const b = await registerStore(app);
    expect((await settings(a.cookie!, "loja-a.com.br")).statusCode).toBe(200);
    const taken = await settings(b.cookie!, "LOJA-A.com.br");
    expect(taken.statusCode).toBe(409);
    expect(JSON.parse(taken.body).code).toBe("CUSTOM_DOMAIN_TAKEN");
    const owners = await prisma.store.findMany({ where: { customDomain: "loja-a.com.br" }, select: { id: true } });
    expect(owners).toHaveLength(1);
    expect((await settings(b.cookie!, "loja-b.com.br")).statusCode).toBe(200); // a recusa não travou a loja B
  });

  it("CORRIDA: duas lojas pedem o MESMO domínio ao mesmo tempo ⇒ exatamente uma leva (o índice decide), a outra 409, nenhuma 500", async () => {
    const lojas = [await registerStore(app), await registerStore(app), await registerStore(app)];
    const respostas = await Promise.all(lojas.map((l) => settings(l.cookie!, "disputa.com.br")));
    const codes = respostas.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409, 409]);
    expect(await prisma.store.count({ where: { customDomain: "disputa.com.br" } })).toBe(1);
  });
});
