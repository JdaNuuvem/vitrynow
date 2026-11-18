import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { createNoticeSchema, createProductSchema, httpsUrl, updateStoreSettingsSchema } from "@meucardapio/shared-types";
import { makeApp, registerStore, resetDb } from "./helpers";

// ST-17 / SEC-14 / NG-07: URL de imagem só em https. O CSP do web recusa http:// no navegador; aqui a API
// recusa na entrada, com mensagem clara, em vez de aceitar e a foto sumir.

describe("httpsUrl (esquema compartilhado)", () => {
  const ok = (v: string) => httpsUrl.safeParse(v).success;

  it("aceita https com caminho, porta e parâmetros; corta espaços das pontas", () => {
    expect(ok("https://cdn.exemplo.com.br/fotos/x.jpg")).toBe(true);
    expect(ok("https://cdn.exemplo.com:8443/x.png?v=2&w=300")).toBe(true);
    expect(httpsUrl.parse("  https://cdn.exemplo.com/x.jpg  ")).toBe("https://cdn.exemplo.com/x.jpg");
  });

  it("recusa http e esquemas perigosos ou estranhos", () => {
    for (const bad of [
      "http://cdn.exemplo.com/x.jpg",
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "data:image/svg+xml;base64,PHN2Zz4=",
      "file:///C:/Windows/win.ini",
      "ftp://exemplo.com/x.jpg",
      "blob:https://exemplo.com/abc",
      "//cdn.exemplo.com/x.jpg",
      "cdn.exemplo.com/x.jpg",
      "https:cdn.exemplo.com/x.jpg ",
      "",
      "lixo",
    ]) {
      expect(ok(bad), bad).toBe(false);
    }
  });

  it("recusa usuário e senha na URL e endereço grande demais", () => {
    expect(ok("https://usuario:senha@cdn.exemplo.com/x.jpg")).toBe(false);
    expect(ok("https://usuario@cdn.exemplo.com/x.jpg")).toBe(false);
    expect(ok("https://cdn.exemplo.com/" + "a".repeat(500))).toBe(false);
  });

  it("a mensagem de erro é clara para o lojista", () => {
    const result = httpsUrl.safeParse("http://x.com/a.jpg");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("use um endereço que comece com https://");
  });
});

describe("schemas que usam httpsUrl", () => {
  it("produto: imageUrl https ou vazia (para apagar a foto); http recusada", () => {
    const base = { name: "X", priceCents: 100 };
    expect(createProductSchema.safeParse({ ...base, imageUrl: "https://a.com/x.jpg" }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...base, imageUrl: "" }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...base }).success).toBe(true);
    expect(createProductSchema.safeParse({ ...base, imageUrl: "http://a.com/x.jpg" }).success).toBe(false);
    expect(createProductSchema.safeParse({ ...base, imageUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("loja: logo e capa https ou vazias; http recusada", () => {
    expect(updateStoreSettingsSchema.safeParse({ logoUrl: "https://a.com/l.png", coverImageUrl: "" }).success).toBe(true);
    expect(updateStoreSettingsSchema.safeParse({ logoUrl: "http://a.com/l.png" }).success).toBe(false);
    expect(updateStoreSettingsSchema.safeParse({ coverImageUrl: "data:image/png;base64,AAAA" }).success).toBe(false);
  });

  it("aviso da plataforma: imageUrl https", () => {
    const base = { title: "T", body: "B" };
    expect(createNoticeSchema.safeParse({ ...base, imageUrl: "https://a.com/i.png" }).success).toBe(true);
    expect(createNoticeSchema.safeParse({ ...base, imageUrl: "http://a.com/i.png" }).success).toBe(false);
  });
});

describe("rotas (integração)", () => {
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

  it("configurações da loja: http e javascript: dão 400 e nada é gravado; https grava e vazio limpa", async () => {
    const { cookie } = await registerStore(app);
    const headers = { cookie: cookie! };
    const save = (payload: object) => app.inject({ method: "POST", url: "/api/store/settings", headers, payload });

    expect((await save({ logoUrl: "http://a.com/l.png" })).statusCode).toBe(400);
    expect((await save({ coverImageUrl: "javascript:alert(1)" })).statusCode).toBe(400);
    expect((await prisma.store.findFirstOrThrow()).logoUrl).toBeNull();

    expect((await save({ logoUrl: "https://a.com/l.png" })).statusCode).toBe(200);
    expect((await prisma.store.findFirstOrThrow()).logoUrl).toBe("https://a.com/l.png");

    expect((await save({ logoUrl: "" })).statusCode).toBe(200);
    expect((await prisma.store.findFirstOrThrow()).logoUrl).toBeNull();
  });

  it("catálogo: produto com foto http é recusado (400); com https é criado", async () => {
    const { cookie } = await registerStore(app);
    const headers = { cookie: cookie! };
    const create = (imageUrl: string) =>
      app.inject({ method: "POST", url: "/api/catalog/products", headers, payload: { name: "Lanche", priceCents: 1500, imageUrl } });

    const bad = await create("http://a.com/p.jpg");
    expect(bad.statusCode).toBe(400);
    expect(await prisma.product.count()).toBe(0);
    expect((await create("https://a.com/p.jpg")).statusCode).toBe(201);
  });
});
