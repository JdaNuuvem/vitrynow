import Fastify from "fastify";
import { Writable } from "node:stream";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { buildApp } from "../src/app";
import { loggerOptions, redactLogUrl } from "../src/lib/logging";
import { newOrderToken, orderTokenMatches } from "../src/lib/orderToken";
import { hashToken } from "../src/lib/tokenHash";
import { makeApp, orderTokenOf, registerStore, resetDb } from "./helpers";

// NG-16: token de acesso do cliente ao próprio pedido (cardápio público). Antes, o id do pedido bastava para ver o
// pagamento e cancelar (e cancelar estorna PIX). Aqui: 404 igual ao de pedido inexistente quando o token falta ou erra.

describe("orderTokenMatches (unitário)", () => {
  it("só aceita o token certo; ausente, vazio, longo demais, array e tipo errado são recusados", () => {
    const { token, hash } = newOrderToken();
    expect(orderTokenMatches(token, hash)).toBe(true);
    for (const bad of [undefined, null, "", "x", token + "x", token.slice(0, -1), "a".repeat(5000), ["a", token], 123, {}]) {
      expect(orderTokenMatches(bad, hash), String(bad).slice(0, 20)).toBe(false);
    }
  });

  it("pedido sem hash gravado (anterior ao NG-16) nunca aceita nada, nem 'vazio contra vazio'", () => {
    const { token } = newOrderToken();
    expect(orderTokenMatches(token, null)).toBe(false);
    expect(orderTokenMatches(token, undefined)).toBe(false);
    expect(orderTokenMatches("", "")).toBe(false);
    expect(orderTokenMatches(token, "lixo")).toBe(false);
    expect(orderTokenMatches(hashToken(token), hashToken(token))).toBe(false); // o hash não vale como token
  });

  it("token com 256 bits aleatórios, prefixo mco_, e dois tokens nunca repetem", () => {
    const a = newOrderToken();
    const b = newOrderToken();
    expect(a.token).toMatch(/^mco_[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashToken(a.token));
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("rotas públicas do pedido (integração)", () => {
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

  async function loja(label: string) {
    const { cookie } = await registerStore(app, { slug: `loja-${label}`, code: label.toUpperCase(), email: `${label}@teste.com` });
    const headers = { cookie: cookie! };
    const cat = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers, payload: { name: "C", position: 0 } })).body).category.id;
    const productId = JSON.parse(
      (await app.inject({ method: "POST", url: "/api/catalog/products", headers, payload: { categoryId: cat, name: "Lanche", priceCents: 1000 } })).body,
    ).product.id as string;
    return { slug: `loja-${label}`, productId, headers };
  }
  async function pedido(l: { slug: string; productId: string }) {
    const res = await app.inject({
      method: "POST",
      url: `/stores/${l.slug}/orders`,
      payload: { type: "BALCAO", items: [{ productId: l.productId, quantity: 1 }] },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body) as { orderId: string; code: string; token: string };
  }
  const status = (slug: string, id: string, token?: string, query = "") =>
    app.inject({ method: "GET", url: `/stores/${slug}/orders/${id}/payment-status${query}`, headers: token ? { "x-order-token": token } : {} });
  const cancel = (slug: string, id: string, token?: string) =>
    app.inject({ method: "POST", url: `/stores/${slug}/orders/${id}/cancel`, headers: token ? { "x-order-token": token } : {} });

  it("a criação devolve o token UMA vez e o banco guarda só o hash", async () => {
    const l = await loja("a");
    const o = await pedido(l);
    expect(o.token).toMatch(/^mco_[A-Za-z0-9_-]{43}$/);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: o.orderId } });
    expect(row.publicTokenHash).toBe(hashToken(o.token));
    expect(JSON.stringify(row)).not.toContain(o.token);
    expect(orderTokenOf(o.orderId)).toBe(o.token);
  });

  it("payment-status: sem token ou com token errado = 404 IDÊNTICO ao de pedido inexistente; com o token certo = 200", async () => {
    const l = await loja("a");
    const o = await pedido(l);
    const inexistente = await status(l.slug, "pedido-que-nao-existe", o.token);
    expect(inexistente.statusCode).toBe(404);
    for (const res of [await status(l.slug, o.orderId), await status(l.slug, o.orderId, "mco_errado"), await status(l.slug, o.orderId, o.token + "x")]) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toBe(inexistente.body); // não confirma que o pedido existe
    }
    const ok = await status(l.slug, o.orderId, o.token);
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).orderStatus).toBe("PENDENTE");
  });

  it("o token NÃO vale na URL (query): só o cabeçalho", async () => {
    const l = await loja("a");
    const o = await pedido(l);
    expect((await status(l.slug, o.orderId, undefined, `?token=${o.token}`)).statusCode).toBe(404);
    expect((await status(l.slug, o.orderId, undefined, `?x-order-token=${o.token}`)).statusCode).toBe(404);
  });

  it("cancelar: sem token ou com token de OUTRO pedido = 404 e o pedido segue PENDENTE; com o próprio token cancela", async () => {
    const l = await loja("a");
    const a = await pedido(l);
    const b = await pedido(l);
    expect((await cancel(l.slug, a.orderId)).statusCode).toBe(404);
    expect((await cancel(l.slug, a.orderId, b.token)).statusCode).toBe(404); // token do pedido B no pedido A
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe("PENDENTE");
    expect((await cancel(l.slug, a.orderId, a.token)).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: a.orderId } })).status).toBe("CANCELADO");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: b.orderId } })).status).toBe("PENDENTE");
  });

  it("isolamento entre lojas: token de pedido da loja A não abre pedido da loja B, mesmo com o id certo", async () => {
    const a = await loja("a");
    const b = await loja("b");
    const pa = await pedido(a);
    const pb = await pedido(b);
    expect((await status(b.slug, pa.orderId, pa.token)).statusCode).toBe(404); // id de A consultado pelo slug de B
    expect((await status(a.slug, pb.orderId, pb.token)).statusCode).toBe(404);
    expect((await cancel(b.slug, pa.orderId, pa.token)).statusCode).toBe(404);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: pa.orderId } })).status).toBe("PENDENTE");
  });

  it("pedido anterior ao NG-16 (sem hash): fail-closed, nenhum acesso público", async () => {
    const l = await loja("a");
    const o = await pedido(l);
    await prisma.order.update({ where: { id: o.orderId }, data: { publicTokenHash: null } });
    expect((await status(l.slug, o.orderId, o.token)).statusCode).toBe(404);
    expect((await cancel(l.slug, o.orderId, o.token)).statusCode).toBe(404);
  });

  it("o painel continua consultando o pedido pela rota autenticada, sem token do cliente", async () => {
    const l = await loja("a");
    const o = await pedido(l);
    const res = await app.inject({ method: "GET", url: "/api/orders", headers: l.headers });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).orders.map((x: { id: string }) => x.id)).toContain(o.orderId);
    expect(res.body).not.toContain(o.token);
    expect(res.body).not.toContain(hashToken(o.token));
  });

  it("o token não aparece em nenhuma listagem do painel nem no printable do print-client", async () => {
    const l = await loja("a");
    const o = await pedido(l);
    const lista = await app.inject({ method: "GET", url: "/api/orders", headers: l.headers });
    expect(lista.body).not.toContain(o.token);
    expect(lista.body).not.toContain(hashToken(o.token));
    expect(lista.body).not.toContain("publicTokenHash");
  });
});

describe("CORS do cardápio (preflight) e redação de log", () => {
  it("preflight aceita x-order-token e content-type, e NÃO aceita cabeçalho arbitrário", async () => {
    const app = makeApp();
    await app.ready();
    const preflight = (requested: string) =>
      app.inject({
        method: "OPTIONS",
        url: "/stores/loja/orders/abc/cancel",
        headers: { origin: "http://localhost:3000", "access-control-request-method": "POST", "access-control-request-headers": requested },
      });
    const ok = await preflight("x-order-token,content-type");
    expect(ok.statusCode).toBeLessThan(300);
    const allowed = String(ok.headers["access-control-allow-headers"]).toLowerCase();
    expect(allowed).toContain("x-order-token");
    expect(allowed).toContain("content-type");
    const evil = await preflight("x-cabecalho-qualquer");
    expect(String(evil.headers["access-control-allow-headers"] ?? "").toLowerCase()).not.toContain("x-cabecalho-qualquer");
    await app.close();
  });

  it("o token do pedido, a sessão e o MFA não aparecem nas linhas de log, nem quando alguém loga os cabeçalhos", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = buildApp({ logger: { ...loggerOptions(), level: "info", stream } as never });
    await app.ready();
    const TOKEN = "mco_SEGREDO-DO-PEDIDO-nao-pode-aparecer-no-log-0123456789";
    const COOKIE = "mc_session=SESSAO-SECRETA-123";
    await app.inject({ method: "GET", url: "/stores/x/orders/y/payment-status", headers: { "x-order-token": TOKEN, cookie: COOKIE } });
    // alguém (hoje ou no futuro) loga o objeto da requisição com os cabeçalhos: a redação tem de cobrir
    const sensitive = { "x-order-token": TOKEN, cookie: COOKIE, authorization: "Bearer XYZ", "x-mfa-challenge": "MFA-SECRETO", "x-admin-token": "ADMIN-SECRETO" };
    app.log.info({ req: { headers: sensitive } }, "diagnóstico com req"); // o serializador do Fastify já descarta os cabeçalhos
    app.log.info({ headers: sensitive }, "diagnóstico com headers"); // aqui quem protege é o `redact`
    await app.close();
    const all = lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("SESSAO-SECRETA-123");
    expect(all).not.toContain("Bearer XYZ");
    expect(all).not.toContain("MFA-SECRETO");
    expect(all).not.toContain("ADMIN-SECRETO");
    // prova da redação em si (não só do serializador): a linha com `headers` sai com o censor no lugar de cada segredo
    const redacted = lines.map((l) => JSON.parse(l)).find((l) => l.msg === "diagnóstico com headers");
    expect(redacted.headers["x-order-token"]).toBe("[redigido]");
    expect(redacted.headers.cookie).toBe("[redigido]");
    expect(redacted.headers.authorization).toBe("[redigido]");
    expect(redacted.headers["x-mfa-challenge"]).toBe("[redigido]");
    expect(redacted.headers["x-admin-token"]).toBe("[redigido]");
  });

  it("token (ou code/state/senha) mandado na QUERY não vai para o log: o valor some, o nome e os outros parâmetros ficam", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, done) {
        lines.push(String(chunk));
        done();
      },
    });
    const app = buildApp({ logger: { ...loggerOptions(), level: "info", stream } as never });
    await app.ready();
    const TOKEN = "mco_TOKEN-NA-QUERY-nao-pode-aparecer-0123456789";
    await app.inject({ method: "GET", url: `/stores/x/orders/y/payment-status?token=${TOKEN}&x-order-token=${TOKEN}&page=2` });
    await app.inject({ method: "GET", url: "/api/store/payments/mercadopago/callback?code=CODIGO-OAUTH-SECRETO&state=ESTADO-SECRETO&motivo=ok" });
    await app.inject({ method: "GET", url: "/qualquer?%74oken=CODIFICADO-SECRETO&senha=SENHA-SECRETA#frag" });
    await app.close();
    const all = lines.join("\n");
    for (const secret of [TOKEN, "CODIGO-OAUTH-SECRETO", "ESTADO-SECRETO", "CODIFICADO-SECRETO", "SENHA-SECRETA"]) expect(all).not.toContain(secret);
    expect(all).toContain("page=2"); // parâmetro comum continua legível para diagnóstico
    expect(all).toContain("motivo=ok");
    expect(all).toContain("token=[redigido]");
  });

  it("o 404 de rota inexistente tem o MESMO corpo e status do Fastify puro, em vários métodos e caminhos (só a query sensível some)", async () => {
    const bare = Fastify({ logger: false });
    await bare.ready();
    const app = buildApp();
    await app.ready();
    const cases: { method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"; url: string }[] = [
      { method: "GET", url: "/nao-existe" },
      { method: "POST", url: "/nao-existe/aninhado/rota" },
      { method: "PUT", url: "/stores/x/orders/nao-e-rota" },
      { method: "DELETE", url: "/api/store/qualquer-coisa" },
      { method: "PATCH", url: "/%C3%A7/acentuado" },
      { method: "GET", url: "/nao-existe?page=2&motivo=ok" },
    ];
    for (const c of cases) {
      const a = await app.inject({ method: c.method, url: c.url });
      const b = await bare.inject({ method: c.method, url: c.url });
      expect(a.statusCode, c.url).toBe(b.statusCode);
      expect(a.json(), c.url).toEqual(b.json());
      expect(String(a.headers["content-type"]).split(";")[0], c.url).toBe(String(b.headers["content-type"]).split(";")[0]);
    }
    // com segredo na query: o corpo muda SÓ nesse valor (nunca o ecoa de volta nem cai em 500)
    const secret = await app.inject({ method: "GET", url: "/nao-existe?token=SEGREDO-NA-URL&page=2" });
    expect(secret.statusCode).toBe(404);
    expect(secret.body).not.toContain("SEGREDO-NA-URL");
    expect(secret.json()).toEqual({ message: "Route GET:/nao-existe?token=[redigido]&page=2 not found", error: "Not Found", statusCode: 404 });
    await app.close();
    await bare.close();
  });

  it("redactLogUrl: sem query intacta; sem nome sensível intacta; nome malformado não quebra; fragmento preservado", () => {
    expect(redactLogUrl(undefined)).toBeUndefined();
    expect(redactLogUrl("/a/b")).toBe("/a/b");
    expect(redactLogUrl("/a?page=1&q=pizza")).toBe("/a?page=1&q=pizza");
    expect(redactLogUrl("/a?token=1&page=1")).toBe("/a?token=[redigido]&page=1");
    expect(redactLogUrl("/a?%E0%A4%A=x&token=1")).toBe("/a?%E0%A4%A=x&token=[redigido]");
    expect(redactLogUrl("/a?code=1#f")).toBe("/a?code=[redigido]#f");
  });
});
