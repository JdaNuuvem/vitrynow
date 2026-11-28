// PRATO 3D: fotos -> geração no provedor (Fake) -> GLB no nosso armazenamento -> rascunho -> o dono publica no cardápio.
// Créditos: reserva ao enviar, devolve se falhar, recusa sem saldo. Sem provedor configurado = 503 (fail-closed).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@meucardapio/db";
import { pollDish3dJobs } from "../src/lib/dish3d";
import { isMenuAffectingRoute } from "../src/plugins/menuRevalidation";
import { FakeDish3dProvider, FalRodinProvider, fakeBoxGlb, isGlb, minimalGlb, rodinOptions, setDish3dProvider } from "../src/lib/dish3dProvider";
import { GlbRealSizeError, measureGlb, rescaleGlbToRealWidth } from "../src/lib/glbRealSize";
import { InMemoryObjectStorage, setObjectStorage } from "../src/lib/objectStorage";
import { resetLimits } from "../src/lib/slidingLimit";
import { login, makeApp, registerStore, resetDb } from "./helpers";

const BOUNDARY = "----vitry3d";
function multipart(files: Buffer[]) {
  const parts = files.map((f, i) =>
    Buffer.concat([
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="photos"; filename="p${i}.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
      f,
      Buffer.from("\r\n"),
    ]),
  );
  return { payload: Buffer.concat([...parts, Buffer.from(`--${BOUNDARY}--\r\n`)]), headers: { "content-type": `multipart/form-data; boundary=${BOUNDARY}` } };
}

const photo = () => sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 80, b: 40 } } }).jpeg().toBuffer();

describe("prato 3D — regras puras", () => {
  it("publicar/tirar/remover o 3D e os Reels avisa a vitrine (revalidação do cardápio); gerar não", () => {
    expect(isMenuAffectingRoute("POST", "/api/products/:id/3d/size")).toBe(true); // tamanho real troca o modelo do cardápio
    for (const a of ["publish", "unpublish", "remove"]) {
      expect(isMenuAffectingRoute("POST", `/api/products/:id/3d/${a}`)).toBe(true);
      expect(isMenuAffectingRoute("POST", `/api/reels/:id/${a}`)).toBe(true);
    }
    expect(isMenuAffectingRoute("POST", "/api/products/:id/3d")).toBe(false); // gerar ainda é rascunho
  });
  it("Rodin: conta sem saldo (403 'Exhausted balance') vira PROVIDER_NO_BALANCE, não chave errada", async () => {
    const locked = (async () => new Response(JSON.stringify({ detail: "User is locked. Reason: Exhausted balance." }), { status: 403 })) as unknown as typeof fetch;
    const denied = (async () => new Response(JSON.stringify({ detail: "Invalid key" }), { status: 401 })) as unknown as typeof fetch;
    const photo = { bytes: Buffer.from([1]), mime: "image/jpeg" as const };
    await expect(new FalRodinProvider("k", locked).submit([photo])).rejects.toMatchObject({ code: "PROVIDER_NO_BALANCE" });
    await expect(new FalRodinProvider("k", denied).submit([photo])).rejects.toMatchObject({ code: "PROVIDER_AUTH" });
  });
  it("Rodin: qualidade alta por padrão; HighPack só quando ligado; fotos vão como data URI em modo concat", async () => {
    expect(rodinOptions({})).toEqual({ quality: "high", highPack: false });
    expect(rodinOptions({ DISH3D_QUALITY: "medium", DISH3D_HIGHPACK: "true" })).toEqual({ quality: "medium", highPack: true });
    expect(rodinOptions({ DISH3D_QUALITY: "ultra" }).quality).toBe("high"); // valor inválido não passa
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ request_id: "req-123" }), { status: 200 });
    }) as unknown as typeof fetch;
    const photo = { bytes: Buffer.from([1, 2, 3]), mime: "image/jpeg" as const };
    await new FalRodinProvider("k", fakeFetch, { quality: "high", highPack: false }).submit([photo, photo]);
    expect(sent[0].url).toBe("https://queue.fal.run/fal-ai/hyper3d/rodin");
    expect(sent[0].body).toMatchObject({ quality: "high", condition_mode: "concat", geometry_file_format: "glb", material: "PBR" });
    expect(sent[0].body).not.toHaveProperty("addons");
    expect((sent[0].body.input_image_urls as string[])[0]).toMatch(/^data:image\/jpeg;base64,/);
    await new FalRodinProvider("k", fakeFetch, { quality: "medium", highPack: true }).submit([photo]);
    expect(sent[1].body).toMatchObject({ quality: "medium", addons: "HighPack" });
  });
  it("TAMANHO REAL: o modelo vira a largura informada em metros, mantém a proporção, apoia na mesa e não empilha escala", () => {
    const box = fakeBoxGlb(); // escala arbitrária: 2 x 0,8 x 1,6 unidades
    expect(isGlb(box)).toBe(true);
    expect(measureGlb(box)).toEqual({ widthMm: 2000, depthMm: 1600, heightMm: 800 });
    const a = rescaleGlbToRealWidth(box, 180); // prato de 18 cm
    expect(a.size).toEqual({ widthMm: 180, depthMm: 144, heightMm: 72 });
    expect(measureGlb(a.glb)).toEqual(a.size); // o arquivo tem mesmo essa medida
    expect(isGlb(a.glb) && a.glb.readUInt32LE(8)).toBe(a.glb.length);
    const b = rescaleGlbToRealWidth(a.glb, 250); // mudar de ideia: sai certo, sem multiplicar a escala anterior
    expect(b.size).toEqual({ widthMm: 250, depthMm: 200, heightMm: 100 });
    const json = JSON.parse(b.glb.toString("utf8", 20, 20 + b.glb.readUInt32LE(12)));
    expect(json.scenes[0].nodes).toHaveLength(1); // um nó de escala só
    expect(json.nodes[json.scenes[0].nodes[0]].translation[1]).toBeCloseTo(0); // base na superfície (a caixa começa em y = 0)
    expect(() => rescaleGlbToRealWidth(Buffer.from("not a model"), 180)).toThrow(GlbRealSizeError);
    expect(() => rescaleGlbToRealWidth(minimalGlb(), 180)).toThrow(GlbRealSizeError); // sem geometria não há o que medir
  });
  it("GLB mínimo do Fake é um glTF binário válido", () => {
    const glb = minimalGlb();
    expect(isGlb(glb)).toBe(true);
    expect(glb.readUInt32LE(8)).toBe(glb.length);
    expect(isGlb(Buffer.from("not a model"))).toBe(false);
  });
});

describe("prato 3D — integração", () => {
  let app: ReturnType<typeof makeApp>;
  let provider: FakeDish3dProvider;
  let storage: InMemoryObjectStorage;

  beforeEach(async () => {
    resetLimits();
    provider = new FakeDish3dProvider();
    setDish3dProvider(provider);
    storage = new InMemoryObjectStorage();
    setObjectStorage(storage);
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    setDish3dProvider(undefined);
    setObjectStorage(undefined);
    await resetDb();
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function setup(credits = 1000) {
    const { cookie, response } = await registerStore(app);
    const storeId = (JSON.parse(response.body) as { store: { id: string } }).store.id;
    const slug = (await prisma.store.findUniqueOrThrow({ where: { id: storeId } })).slug;
    const category = await prisma.category.create({ data: { storeId, name: "Pratos" } });
    const product = await prisma.product.create({ data: { storeId, categoryId: category.id, name: "Ramen", priceCents: 4500 } });
    if (credits) await prisma.aiCreditLedger.create({ data: { storeId, delta: credits, reason: "GRANT", note: "teste", idempotencyKey: `grant-${storeId}` } });
    return { cookie: cookie!, storeId, slug, productId: product.id };
  }

  const start = async (cookie: string, productId: string, files: Buffer[]) => {
    const body = multipart(files);
    return app.inject({ method: "POST", url: `/api/products/${productId}/3d`, headers: { cookie, ...body.headers }, payload: body.payload });
  };
  const balance = async (storeId: string) => (await prisma.aiCreditLedger.aggregate({ where: { storeId }, _sum: { delta: true } }))._sum.delta ?? 0;
  const later = () => new Date(Date.now() + 5 * 60_000);
  const publicProduct = async (slug: string) => {
    const res = await app.inject({ method: "GET", url: `/stores/${slug}/menu` });
    const menu = JSON.parse(res.body) as { categories: { products: { name: string; model3dUrl: string | null; model3dWidthMm: number | null }[] }[] };
    return menu.categories.flatMap((c) => c.products).find((p) => p.name === "Ramen")!;
  };

  it("gera, guarda o GLB como rascunho e só vai ao cardápio depois de publicar", async () => {
    const { cookie, storeId, slug, productId } = await setup();
    const res = await start(cookie, productId, [await photo(), await photo()]);
    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body).job.status).toBe("RUNNING");
    expect(provider.submitted[0]).toHaveLength(2);
    expect(provider.submitted[0][0].mime).toBe("image/jpeg");
    expect(await balance(storeId)).toBe(700); // reservou 300

    expect(await pollDish3dJobs(later(), 10)).toBe(1);
    const job = await prisma.dish3dJob.findFirstOrThrow({ where: { productId } });
    expect(job.status).toBe("SUCCEEDED");
    expect(storage.objects.has(job.modelKey!)).toBe(true);
    expect(await balance(storeId)).toBe(700);

    const view = JSON.parse((await app.inject({ method: "GET", url: `/api/products/${productId}/3d`, headers: { cookie } })).body);
    expect(view.model.published).toBe(false);
    expect(view.model.url).toContain(".glb");
    expect((await publicProduct(slug)).model3dUrl).toBeNull(); // rascunho não é público

    // sem o tamanho real não publica: o 3D serve para ver o prato do tamanho de verdade na mesa
    const semMedida = await app.inject({ method: "POST", url: `/api/products/${productId}/3d/publish`, headers: { cookie } });
    expect([semMedida.statusCode, JSON.parse(semMedida.body).code]).toEqual([409, "DISH3D_SIZE_REQUIRED"]);
    const sized = await app.inject({ method: "POST", url: `/api/products/${productId}/3d/size`, headers: { cookie }, payload: { widthCm: 18 } });
    expect(sized.statusCode).toBe(200);
    const sizedModel = JSON.parse(sized.body).model;
    expect(sizedModel).toMatchObject({ widthMm: 180, heightMm: 72 });
    expect(sizedModel.url).not.toBe(view.model.url); // arquivo novo (o antigo fica no cache imutável)

    expect((await app.inject({ method: "POST", url: `/api/products/${productId}/3d/publish`, headers: { cookie } })).statusCode).toBe(200);
    expect(await publicProduct(slug)).toMatchObject({ model3dUrl: sizedModel.url, model3dWidthMm: 180 });

    expect((await app.inject({ method: "POST", url: `/api/products/${productId}/3d/remove`, headers: { cookie } })).statusCode).toBe(200);
    expect((await publicProduct(slug)).model3dUrl).toBeNull();

    const list = JSON.parse((await app.inject({ method: "GET", url: "/api/dish3d", headers: { cookie } })).body);
    expect(list.available).toBe(true);
    expect(list.credits).toEqual({ cost: 300, balance: 700 });
  });

  it("tamanho real: medida inválida é 400; trocar a medida reescreve o modelo e apaga a cópia anterior (não o original); gerar de novo mantém a medida", async () => {
    const { cookie, productId } = await setup();
    const size = (widthCm: unknown) => app.inject({ method: "POST", url: `/api/products/${productId}/3d/size`, headers: { cookie }, payload: { widthCm } });
    expect(JSON.parse((await size(18)).body).code).toBe("DISH3D_NO_MODEL"); // ainda sem modelo
    await start(cookie, productId, [await photo()]);
    await pollDish3dJobs(later(), 10);
    const original = (await prisma.dish3dJob.findFirstOrThrow({ where: { productId } })).modelKey!;
    for (const bad of [2, 81, 18.3, "18", null]) expect((await size(bad)).statusCode, String(bad)).toBe(400);

    const first = JSON.parse((await size(18.5)).body).model;
    expect(first.widthMm).toBe(185);
    const second = JSON.parse((await size(24)).body).model;
    expect(second.widthMm).toBe(240);
    const keyOf = (url: string) => url.slice(url.indexOf("stores/"));
    expect(storage.objects.has(keyOf(first.url))).toBe(false); // cópia da medida anterior apagada
    expect(storage.objects.has(keyOf(second.url))).toBe(true);
    expect(storage.objects.has(original)).toBe(true); // o original do gerador fica
    expect(measureGlb(storage.objects.get(keyOf(second.url))!.body)).toMatchObject({ widthMm: 240 });

    // gerar de novo: o modelo novo já sai com 24 cm (rascunho), sem o dono informar de novo
    await start(cookie, productId, [await photo()]);
    await pollDish3dJobs(later(), 10);
    const again = JSON.parse((await app.inject({ method: "GET", url: `/api/products/${productId}/3d`, headers: { cookie } })).body).model;
    expect(again).toMatchObject({ widthMm: 240, published: false });
    expect(measureGlb(storage.objects.get(keyOf(again.url))!.body).widthMm).toBe(240);

    // remover zera a medida
    await app.inject({ method: "POST", url: `/api/products/${productId}/3d/remove`, headers: { cookie } });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect([product.model3dUrl, product.model3dWidthMm, product.model3dHeightMm]).toEqual([null, null, null]);
  });

  it("falha no provedor devolve os créditos", async () => {
    const { cookie, storeId, productId } = await setup();
    provider.failNext = true;
    expect((await start(cookie, productId, [await photo()])).statusCode).toBe(202);
    expect(await balance(storeId)).toBe(700);
    await pollDish3dJobs(later(), 10);
    const job = await prisma.dish3dJob.findFirstOrThrow({ where: { productId } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toBe("PROVIDER_FAILED");
    expect(await balance(storeId)).toBe(1000);
    await pollDish3dJobs(later(), 10); // repetir não devolve duas vezes
    expect(await balance(storeId)).toBe(1000);
  });

  it("sem saldo recusa (402) sem chamar o provedor; segunda geração em andamento é 409", async () => {
    const poor = await setup(100);
    const res = await start(poor.cookie, poor.productId, [await photo()]);
    expect(res.statusCode).toBe(402);
    expect(JSON.parse(res.body).code).toBe("AI_CREDITS_INSUFFICIENT");
    expect(provider.submitted).toHaveLength(0);
    await prisma.aiCreditLedger.create({ data: { storeId: poor.storeId, delta: 500, reason: "GRANT", note: "teste", idempotencyKey: "grant-2" } });
    expect((await start(poor.cookie, poor.productId, [await photo()])).statusCode).toBe(202);
    const again = await start(poor.cookie, poor.productId, [await photo()]);
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).code).toBe("DISH3D_ALREADY_RUNNING");
    expect(await balance(poor.storeId)).toBe(300); // só uma reserva
  });

  it("foto inválida é 415; publicar sem modelo é 409; equipe não acessa; produto de outra loja é 404", async () => {
    const { cookie, productId } = await setup();
    const bad = await start(cookie, productId, [Buffer.from("isto não é imagem")]);
    expect(bad.statusCode).toBe(415);
    expect(JSON.parse(bad.body).code).toBe("DISH3D_PHOTO_INVALID");
    const pub = await app.inject({ method: "POST", url: `/api/products/${productId}/3d/publish`, headers: { cookie } });
    expect(pub.statusCode).toBe(409);

    expect((await app.inject({ method: "POST", url: "/api/users", headers: { cookie }, payload: { email: "staff3d@teste.com", password: "senha-forte-123" } })).statusCode).toBe(201);
    const staff = (await login(app, "staff3d@teste.com", "senha-forte-123")).cookie!;
    expect((await app.inject({ method: "GET", url: "/api/dish3d", headers: { cookie: staff } })).statusCode).toBe(403);

    const other = await setup();
    expect((await start(other.cookie, productId, [await photo()])).statusCode).toBe(404);
  });

  it("sem provedor configurado: 503 DISH3D_UNAVAILABLE", async () => {
    setDish3dProvider(null);
    const { cookie, storeId, productId } = await setup();
    const res = await start(cookie, productId, [await photo()]);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body).code).toBe("DISH3D_UNAVAILABLE");
    expect(await balance(storeId)).toBe(1000);
  });
});
