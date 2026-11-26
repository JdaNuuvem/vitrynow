// PRATO 3D: fotos -> geração no provedor (Fake) -> GLB no nosso armazenamento -> rascunho -> o dono publica no cardápio.
// Créditos: reserva ao enviar, devolve se falhar, recusa sem saldo. Sem provedor configurado = 503 (fail-closed).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@meucardapio/db";
import { pollDish3dJobs } from "../src/lib/dish3d";
import { FakeDish3dProvider, isGlb, minimalGlb, setDish3dProvider } from "../src/lib/dish3dProvider";
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
    const menu = JSON.parse(res.body) as { categories: { products: { name: string; model3dUrl: string | null }[] }[] };
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

    expect((await app.inject({ method: "POST", url: `/api/products/${productId}/3d/publish`, headers: { cookie } })).statusCode).toBe(200);
    expect((await publicProduct(slug)).model3dUrl).toBe(view.model.url);

    expect((await app.inject({ method: "POST", url: `/api/products/${productId}/3d/remove`, headers: { cookie } })).statusCode).toBe(200);
    expect((await publicProduct(slug)).model3dUrl).toBeNull();

    const list = JSON.parse((await app.inject({ method: "GET", url: "/api/dish3d", headers: { cookie } })).body);
    expect(list.available).toBe(true);
    expect(list.credits).toEqual({ cost: 300, balance: 700 });
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
