import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { menuRevalidateJob } from "../src/jobs/menuRevalidate";
import { JobRunner } from "../src/jobs/runner";
import { revalidateBackoffMs, revalidateConfig, scheduleMenuRevalidation, setRevalidateFetch } from "../src/lib/menuRevalidation";
import { isMenuAffectingRoute } from "../src/plugins/menuRevalidation";
import { makeApp, registerStore, resetDb } from "./helpers";

// API-58 (ADR-0013 §2.4): a vitrine refaz em ≤ 5 s quando o cardápio muda. Aqui o web é um fake que anota as chamadas.

const SECRET = "segredo-interno-de-teste";
const silent = { info() {}, warn() {}, error() {} };

type Call = { url: string; secret: string | null; body: unknown };
function fakeWeb(status = 200) {
  const calls: Call[] = [];
  let currentStatus = status;
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), secret: new Headers(init?.headers).get("x-revalidate-secret"), body: JSON.parse(String(init?.body ?? "null")) });
    return new Response("{}", { status: currentStatus });
  }) as typeof fetch;
  return { calls, impl, setStatus: (s: number) => (currentStatus = s) };
}

describe("isMenuAffectingRoute", () => {
  it("só POST do painel em catálogo e dados/horário da loja", () => {
    for (const url of ["/api/catalog/products", "/api/catalog/products/:id", "/api/catalog/categories/reorder", "/api/catalog/option-groups/:id", "/api/store/settings", "/api/store/availability", "/api/store/hours", "/api/store/status", "/api/store/prep-times"]) {
      expect(isMenuAffectingRoute("POST", url), url).toBe(true);
      expect(isMenuAffectingRoute("GET", url), `GET ${url}`).toBe(false);
    }
    for (const url of ["/api/orders/:id/cancel", "/api/cashier/open", "/auth/login", "/api/users", "/stores/:slug/orders", "/api/store/subscription/checkout"]) {
      expect(isMenuAffectingRoute("POST", url), url).toBe(false);
    }
  });
});

describe("revalidação da vitrine (API-58)", () => {
  let app: ReturnType<typeof makeApp>;
  let cookie: string;
  let storeId: string;
  const web = fakeWeb();

  beforeEach(async () => {
    process.env.WEB_INTERNAL_URL = "http://web:3000/";
    process.env.REVALIDATE_SECRET = SECRET;
    setRevalidateFetch(web.impl);
    web.calls.length = 0;
    web.setStatus(200);
    app = makeApp();
    await app.ready();
    const registered = await registerStore(app, { slug: "loja-rev", code: "RV1" });
    cookie = registered.cookie!;
    storeId = JSON.parse(registered.response.body).store.id;
    await prisma.menuRevalidation.deleteMany(); // o cadastro não cria linha, mas garante o ponto de partida
  });
  afterEach(async () => {
    setRevalidateFetch();
    delete process.env.WEB_INTERNAL_URL;
    delete process.env.REVALIDATE_SECRET;
    await app.close();
    await resetDb();
    await prisma.menuRevalidation.deleteMany();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const runner = () => {
    const r = new JobRunner({ db: prisma, log: silent });
    r.register(menuRevalidateJob);
    return r;
  };
  const waitFor = async (check: () => boolean, ms = 4000) => {
    const start = Date.now();
    while (!check() && Date.now() - start < ms) await new Promise((resolve) => setTimeout(resolve, 25));
    return Date.now() - start;
  };

  it("configuração: só liga com URL E segredo; normaliza a barra final", () => {
    expect(revalidateConfig({ WEB_INTERNAL_URL: "http://web:3000//", REVALIDATE_SECRET: "x" })).toEqual({ url: "http://web:3000", secret: "x" });
    expect(revalidateConfig({ WEB_INTERNAL_URL: "http://web:3000" })).toBeNull();
    expect(revalidateConfig({ REVALIDATE_SECRET: "x" })).toBeNull();
    expect(revalidateConfig({})).toBeNull();
  });

  it("mudança de preço pelo painel dispara a chamada ao web em ≤ 5 s, com o segredo no cabeçalho e o slug no corpo", async () => {
    const category = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "Lanches" } })).body).category.id;
    const product = JSON.parse((await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { categoryId: category, name: "X", priceCents: 2000 } })).body).product.id;
    await waitFor(() => web.calls.length > 0);
    web.calls.length = 0;
    await prisma.menuRevalidation.deleteMany();

    const started = Date.now();
    const edit = await app.inject({ method: "POST", url: `/api/catalog/products/${product}`, headers: { cookie }, payload: { priceCents: 2200 } });
    expect(edit.statusCode).toBe(200);
    const elapsed = await waitFor(() => web.calls.length > 0);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(elapsed).toBeLessThan(5000);
    expect(web.calls).toHaveLength(1);
    expect(web.calls[0]).toEqual({ url: "http://web:3000/api/revalidate", secret: SECRET, body: { slug: "loja-rev" } });
    for (let i = 0; i < 400 && (await prisma.menuRevalidation.count()) > 0; i++) await new Promise((resolve) => setTimeout(resolve, 50)); // ate 20 s: sob carga o envio confirmado demora (flaky no CI); o limite de 5 s do produto e provado acima, por `elapsed`
    expect(await prisma.menuRevalidation.count()).toBe(0); // a linha some depois do envio confirmado
  });

  it("rotas que não mudam a vitrine, leituras e respostas de erro NÃO disparam", async () => {
    await app.inject({ method: "GET", url: "/api/catalog/categories", headers: { cookie } });
    await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie }, payload: { name: "sem categoria" } }); // 400
    await app.inject({ method: "POST", url: "/api/catalog/products/nao-existe", headers: { cookie }, payload: { name: "x" } }); // 404
    await app.inject({ method: "POST", url: "/api/cashier/open", headers: { cookie }, payload: { openingBalanceCents: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(web.calls).toHaveLength(0);
    expect(await prisma.menuRevalidation.count()).toBe(0);
  });

  it("sem WEB_INTERNAL_URL/REVALIDATE_SECRET a revalidação fica desligada: nada é gravado nem chamado", async () => {
    delete process.env.REVALIDATE_SECRET;
    expect(await scheduleMenuRevalidation(storeId)).toBe(false);
    const category = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie }, payload: { name: "Lanches" } });
    expect(category.statusCode).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(web.calls).toHaveLength(0);
    expect(await prisma.menuRevalidation.count()).toBe(0);
  });

  it("várias mudanças seguidas viram UMA linha pendente por slug (e uma chamada ao processar)", async () => {
    for (let i = 0; i < 5; i++) expect(await scheduleMenuRevalidation(storeId)).toBe(true);
    expect(await prisma.menuRevalidation.count()).toBe(1);
    const result = await runner().run("menu.revalidate");
    expect(result).toMatchObject({ status: "ok", processed: 1 });
    expect(web.calls).toHaveLength(1);
    expect(await prisma.menuRevalidation.count()).toBe(0);
  });

  it("web fora do ar: a linha fica, com tentativa e recuo; ao voltar, o job reenvia e limpa", async () => {
    web.setStatus(503);
    await scheduleMenuRevalidation(storeId);
    await runner().run("menu.revalidate");
    const pending = await prisma.menuRevalidation.findUniqueOrThrow({ where: { slug: "loja-rev" } });
    expect(pending.attempts).toBe(1);
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // ainda dentro do recuo: o job não reenvia
    await runner().run("menu.revalidate");
    expect(web.calls).toHaveLength(1);

    web.setStatus(200);
    await prisma.menuRevalidation.update({ where: { slug: "loja-rev" }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await runner().run("menu.revalidate");
    expect(web.calls).toHaveLength(2);
    expect(await prisma.menuRevalidation.count()).toBe(0);
  });

  it("depois de 8 tentativas desiste (o TTL do ISR cobre) em vez de crescer para sempre", async () => {
    web.setStatus(500);
    await scheduleMenuRevalidation(storeId);
    await prisma.menuRevalidation.update({ where: { slug: "loja-rev" }, data: { attempts: 7 } });
    await runner().run("menu.revalidate"); // 8ª tentativa
    expect(await prisma.menuRevalidation.count()).toBe(0);
  });

  it("pedido NOVO durante o envio não é apagado pelo envio antigo (requestedAt)", async () => {
    await scheduleMenuRevalidation(storeId);
    let newer: Date | undefined;
    setRevalidateFetch((async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await scheduleMenuRevalidation(storeId); // chega outra mudança enquanto o envio está em andamento
      newer = (await prisma.menuRevalidation.findUniqueOrThrow({ where: { slug: "loja-rev" } })).requestedAt;
      return new Response("{}", { status: 200 });
    }) as typeof fetch);
    await runner().run("menu.revalidate");
    const left = await prisma.menuRevalidation.findUnique({ where: { slug: "loja-rev" } });
    expect(left?.requestedAt.getTime()).toBe(newer!.getTime()); // continua pendente para a próxima rodada
  });

  it("duas instâncias ao mesmo tempo: cada slug é enviado uma vez só", async () => {
    const other = await registerStore(app, { slug: "loja-rev2", code: "RV2" });
    const otherStore = JSON.parse(other.response.body).store.id;
    await scheduleMenuRevalidation(storeId);
    await scheduleMenuRevalidation(otherStore);
    await Promise.all([runner().run("menu.revalidate"), runner().run("menu.revalidate")]);
    const slugs = web.calls.map((c) => (c.body as { slug: string }).slug).sort();
    expect(slugs).toEqual(["loja-rev", "loja-rev2"]);
  });

  it("o segredo nunca vai na URL nem no corpo, e a URL é só interna", async () => {
    await scheduleMenuRevalidation(storeId);
    await runner().run("menu.revalidate");
    const [call] = web.calls;
    expect(call.url).not.toContain(SECRET);
    expect(JSON.stringify(call.body)).not.toContain(SECRET);
    expect(call.url).toBe("http://web:3000/api/revalidate");
  });

  it("recuo cresce e para num teto", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 20].map(revalidateBackoffMs)).toEqual([2000, 5000, 15000, 60000, 300000, 900000, 1800000, 1800000, 1800000]);
  });
});
