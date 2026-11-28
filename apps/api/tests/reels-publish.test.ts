// REEL-2 (cardápio estilo Reels): publicar, tirar do cardápio, remover e o feed público. Fakes de storage e transcoder (sem ffmpeg, sem rede).
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { InMemoryObjectStorage, setObjectStorage } from "../src/lib/objectStorage";
import { FakeTranscoder, setReelTranscoder } from "../src/lib/reelTranscoder";
import { reelsService } from "../src/modules/reels/reels.module";
import { BOUNDARY, fakeMp4, multipartBody } from "./reelFixtures";
import { login, makeApp, registerStore, resetDb } from "./helpers";

describe("Reels: publicar e feed do cardápio", () => {
  let app: ReturnType<typeof makeApp>;
  let storage: InMemoryObjectStorage;

  beforeEach(async () => {
    storage = new InMemoryObjectStorage();
    setObjectStorage(storage);
    setReelTranscoder(new FakeTranscoder());
    process.env.REELS_ENABLED = "true";
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
    setObjectStorage(undefined);
    setReelTranscoder(undefined);
    delete process.env.REELS_ENABLED;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (res: { body: string }) => JSON.parse(res.body);
  // a tarefa nasce com a hora do BANCO (availableAt = now() do Postgres); se o relógio do banco estiver alguns ms à frente
  // do processo de teste, rodar a fila "agora" não a pega. Folga de 1 s (em produção a fila pega na rodada seguinte).
  const runQueue = () => reelsService.runNext(new Date(Date.now() + 1000));
  async function ctx() {
    const { cookie, response } = await registerStore(app);
    const store = json(response).store as { id: string; slug: string };
    const productId = (await prisma.product.create({ data: { storeId: store.id, name: "Ramen", priceCents: 4500, description: "Caldo de 12 h" } })).id;
    return { cookie: cookie!, store, productId };
  }
  const upload = (cookie: string, productId: string) =>
    app.inject({ method: "POST", url: `/api/reels?productId=${productId}`, headers: { cookie, "content-type": `multipart/form-data; boundary=${BOUNDARY}` }, payload: multipartBody(fakeMp4({ seconds: 10 })) });
  const post = (cookie: string, url: string) => app.inject({ method: "POST", url, headers: { cookie }, payload: {} });
  const feed = async (slug: string) => json(await app.inject({ method: "GET", url: `/stores/${slug}/reels` })).reels as { id: string; videoUrl: string; product: Record<string, unknown> }[];

  it("pronto → publicar → aparece no feed com o produto; tirar → some; remover → apaga arquivos e libera o produto", async () => {
    const { cookie, store, productId } = await ctx();
    const res = await upload(cookie, productId);
    expect(res.statusCode).toBe(202);
    const reelId = json(res).reelId as string;

    // ainda preparando: não publica
    const early = await post(cookie, `/api/reels/${reelId}/publish`);
    expect(early.statusCode).toBe(409);
    expect(json(early).code).toBe("VIDEO_NOT_READY");

    expect(await runQueue()).toBe(true);
    expect(await feed(store.slug)).toEqual([]); // pronto, mas não publicado
    expect(json(await app.inject({ method: "GET", url: `/stores/${store.slug}/menu` })).store.hasReels).toBe(false);

    const pub = await post(cookie, `/api/reels/${reelId}/publish`);
    expect(pub.statusCode).toBe(200);
    expect(json(pub).reel.status).toBe("PUBLISHED");
    const items = await feed(store.slug);
    expect(items).toHaveLength(1);
    expect(items[0].product).toEqual({ id: productId, name: "Ramen", description: "Caldo de 12 h", priceCents: 4500, promoCents: null, imageUrl: null, soldOut: false });
    expect(Object.keys(items[0]).sort()).toEqual(["durationMs", "id", "posterUrl", "product", "videoUrl"]); // lista de permissão
    expect(json(await app.inject({ method: "GET", url: `/stores/${store.slug}/menu` })).store.hasReels).toBe(true);

    // produto desativado some do feed
    await prisma.product.update({ where: { id: productId }, data: { active: false } });
    expect(await feed(store.slug)).toEqual([]);
    await prisma.product.update({ where: { id: productId }, data: { active: true } });

    expect((await post(cookie, `/api/reels/${reelId}/unpublish`)).statusCode).toBe(200);
    expect(await feed(store.slug)).toEqual([]);

    const keysBefore = [...storage.objects.keys()].filter((k) => k.includes("/reels/"));
    expect(keysBefore.length).toBe(2); // mp4 + capa
    expect((await post(cookie, `/api/reels/${reelId}/remove`)).statusCode).toBe(200);
    expect([...storage.objects.keys()].filter((k) => k.includes("/reels/"))).toEqual([]);
    expect(await prisma.reel.count()).toBe(0);
    expect((await upload(cookie, productId)).statusCode).toBe(202); // o produto aceita outro vídeo
  });

  it("só o dono publica/remove; outra loja não acha o vídeo; vídeo retirado por denúncia não volta", async () => {
    const a = await ctx();
    const reelId = json(await upload(a.cookie, a.productId)).reelId as string;
    await runQueue();

    const email = `staff-${Math.random().toString(36).slice(2, 7)}@t.com`;
    await app.inject({ method: "POST", url: "/api/users", headers: { cookie: a.cookie }, payload: { email, password: "senha-forte-123" } });
    const staff = (await login(app, email, "senha-forte-123")).cookie!;
    expect((await post(staff, `/api/reels/${reelId}/publish`)).statusCode).toBe(403);

    const b = await ctx();
    expect((await post(b.cookie, `/api/reels/${reelId}/publish`)).statusCode).toBe(404);
    expect((await post(b.cookie, `/api/reels/${reelId}/remove`)).statusCode).toBe(404);

    await prisma.reel.update({ where: { id: reelId }, data: { takedownAt: new Date() } });
    const res = await post(a.cookie, `/api/reels/${reelId}/publish`);
    expect(res.statusCode).toBe(409);
    expect(json(res).code).toBe("REEL_TAKEN_DOWN");
  });

  it("feed: chave geral desligada ou loja inexistente nunca quebra a vitrine", async () => {
    const { store } = await ctx();
    delete process.env.REELS_ENABLED;
    expect(await feed(store.slug)).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/stores/nao-existe/reels" })).statusCode).toBe(404);
  });
});
