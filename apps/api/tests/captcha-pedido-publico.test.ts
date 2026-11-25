import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { CAPTCHA_HEADER, FAKE_CAPTCHA_OK, TURNSTILE_VERIFY_URL, TurnstileCaptcha, captchaMode, setCaptchaVerifier, type CaptchaVerifier } from "../src/lib/captcha";
import { resetLimits } from "../src/lib/slidingLimit";
import { CAPTCHA_AT_PENDING } from "../src/routes/storefront";
import { makeApp, registerStore, resetDb } from "./helpers";

// NG-08 (captcha plugável, provedor FAKE): só é cobrado com risco; nenhuma chave real, nenhuma chamada externa.

describe("NG-08: captcha — modo e fail-closed", () => {
  it("modos: `off` por padrão; `fake` só em dev/teste; valor desconhecido derruba o boot", () => {
    expect(captchaMode({} as NodeJS.ProcessEnv)).toBe("off");
    expect(captchaMode({ CAPTCHA_MODE: "off" } as NodeJS.ProcessEnv)).toBe("off");
    expect(captchaMode({ CAPTCHA_MODE: "fake", NODE_ENV: "test" } as NodeJS.ProcessEnv)).toBe("fake");
    expect(captchaMode({ CAPTCHA_MODE: "fake", NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe("fake");
    for (const NODE_ENV of ["production", undefined, "staging", "prod"]) {
      expect(() => captchaMode({ CAPTCHA_MODE: "fake", NODE_ENV } as NodeJS.ProcessEnv), `NODE_ENV=${NODE_ENV}`).toThrow(/dev\/teste/);
    }
    expect(() => captchaMode({ CAPTCHA_MODE: "hcaptcha", NODE_ENV: "test" } as NodeJS.ProcessEnv)).toThrow(/inválido/);
    // turnstile: vale em produção, mas sem a chave secreta derruba o boot
    expect(() => captchaMode({ CAPTCHA_MODE: "turnstile", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toThrow(/TURNSTILE_SECRET_KEY/);
    expect(captchaMode({ CAPTCHA_MODE: "turnstile", NODE_ENV: "production", TURNSTILE_SECRET_KEY: "s" } as NodeJS.ProcessEnv)).toBe("turnstile");
  });
});

describe("NG-08: Turnstile (fetch falso, nenhuma chamada externa)", () => {
  const fakeFetch = (reply: () => Promise<Response>) => {
    const calls: { url: string; body: URLSearchParams }[] = [];
    const impl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: init.body as URLSearchParams });
      return reply();
    }) as unknown as typeof fetch;
    return { impl, calls };
  };
  const ok = (success: boolean) => async () => new Response(JSON.stringify({ success }), { status: 200 });

  it("aceita só quando o provedor responde success=true e manda secret, token e IP", async () => {
    const { impl, calls } = fakeFetch(ok(true));
    expect(await new TurnstileCaptcha("segredo", impl).verify("tok", "ck", "203.0.113.9")).toBe(true);
    expect(calls[0].url).toBe(TURNSTILE_VERIFY_URL);
    expect(Object.fromEntries(calls[0].body)).toEqual({ secret: "segredo", response: "tok", remoteip: "203.0.113.9" });
  });

  it("recusa: success=false, token ausente (sem chamar o provedor), HTTP de erro, rede fora e timeout", async () => {
    expect(await new TurnstileCaptcha("s", fakeFetch(ok(false)).impl).verify("tok", "ck")).toBe(false);
    const semToken = fakeFetch(ok(true));
    expect(await new TurnstileCaptcha("s", semToken.impl).verify(undefined, "ck")).toBe(false);
    expect(semToken.calls).toHaveLength(0);
    expect(await new TurnstileCaptcha("s", fakeFetch(async () => new Response("x", { status: 500 })).impl).verify("tok", "ck")).toBe(false);
    expect(await new TurnstileCaptcha("s", fakeFetch(async () => { throw new TypeError("rede"); }).impl).verify("tok", "ck")).toBe(false);
    const lento = (async (_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("abort"))))) as unknown as typeof fetch;
    expect(await new TurnstileCaptcha("s", lento, 20).verify("tok", "ck")).toBe(false);
  });
});

describe("NG-08: captcha no pedido público", () => {
  let app: ReturnType<typeof makeApp>;
  let ipSeq = 0;
  const nextIp = () => `10.99.${Math.floor(++ipSeq / 250)}.${(ipSeq % 250) + 1}`;
  beforeEach(async () => {
    await resetDb();
    resetLimits();
    app = makeApp();
    await app.ready();
  });
  afterEach(() => {
    setCaptchaVerifier(undefined);
    delete process.env.CAPTCHA_MODE;
  });
  afterAll(async () => {
    await resetDb(); // não deixa loja/usuário para o próximo arquivo (o mfa-notices só limpa DEPOIS de cada teste)
    await prisma.$disconnect();
  });
  const json = (r: { body: string }) => JSON.parse(r.body);

  async function loja() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { slug: string };
    const cat = json(await app.inject({ method: "POST", url: "/api/catalog/categories", headers: { cookie: cookie! }, payload: { name: "C" } })).category.id;
    const productId = json(await app.inject({ method: "POST", url: "/api/catalog/products", headers: { cookie: cookie! }, payload: { categoryId: cat, name: "Pizza", priceCents: 3000 } })).product.id as string;
    return { store, productId };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const pedir = (l: Loja, phone: string, captcha?: string) =>
    app.inject({
      method: "POST",
      url: `/stores/${l.store.slug}/orders`,
      remoteAddress: nextIp(),
      headers: captcha ? { [CAPTCHA_HEADER]: captcha } : {},
      payload: { type: "DELIVERY", items: [{ productId: l.productId, quantity: 1 }], paymentMethod: "DINHEIRO", customerName: "Cliente", customerPhone: phone, address: "Rua A 1" },
    });

  it("modo `off` (padrão): nada muda, nunca pede captcha", async () => {
    const l = await loja();
    for (let i = 0; i < 3; i += 1) expect((await pedir(l, "11987654321")).statusCode).toBe(201);
  });

  it(`modo \`fake\`: cliente normal NÃO vê captcha; do ${CAPTCHA_AT_PENDING + 1}º pedido pendente do telefone exige o token; token errado ou ausente = 403 CAPTCHA_REQUIRED; token certo passa`, async () => {
    process.env.CAPTCHA_MODE = "fake";
    const l = await loja();
    for (let i = 0; i < CAPTCHA_AT_PENDING; i += 1) expect((await pedir(l, "11987654321")).statusCode, `pedido ${i + 1} sem captcha`).toBe(201);

    const semToken = await pedir(l, "11987654321");
    expect(semToken.statusCode).toBe(403);
    expect(json(semToken).code).toBe("CAPTCHA_REQUIRED");
    expect((await pedir(l, "11987654321", "token-errado")).statusCode).toBe(403);
    expect(await prisma.order.count({ where: { customerPhone: "11987654321" } })).toBe(CAPTCHA_AT_PENDING); // a recusa não gravou nada

    expect((await pedir(l, "11987654321", FAKE_CAPTCHA_OK)).statusCode).toBe(201);
    // outro telefone nunca vê captcha
    expect((await pedir(l, "11911112222")).statusCode).toBe(201);
    // e o teto duro por telefone continua valendo mesmo com captcha certo
    expect((await pedir(l, "11987654321", FAKE_CAPTCHA_OK)).statusCode).toBe(429);
  });

  it("provedor que FALHA (exceção) recusa o pedido em risco: fail-closed, nunca libera", async () => {
    const quebrado: CaptchaVerifier = { mode: "fake", verify: async () => { throw new Error("provedor fora do ar"); } };
    setCaptchaVerifier(quebrado);
    const l = await loja();
    for (let i = 0; i < CAPTCHA_AT_PENDING; i += 1) await pedir(l, "11987654321");
    const res = await pedir(l, "11987654321", FAKE_CAPTCHA_OK);
    expect(res.statusCode).toBe(403);
    expect(json(res).code).toBe("CAPTCHA_REQUIRED");
  });

  it("cabeçalho gigante é tratado como ausente (não vai para o provedor)", async () => {
    process.env.CAPTCHA_MODE = "fake";
    const l = await loja();
    for (let i = 0; i < CAPTCHA_AT_PENDING; i += 1) await pedir(l, "11987654321");
    expect((await pedir(l, "11987654321", "x".repeat(5000))).statusCode).toBe(403);
  });
});
