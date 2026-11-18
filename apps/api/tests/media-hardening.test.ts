import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@meucardapio/db";
import { assertStorageBootConfig, InMemoryObjectStorage, setObjectStorage } from "../src/lib/objectStorage";
import { imageLane } from "../src/lib/imageLane";
import { makeApp, registerStore, resetDb } from "./helpers";

// Nightingale, PR #78 (A, B, C + recomendadas): faixa do sharp, boot de produção, remoção só do dono e sem uso, cota sem corrida.
describe("endurecimento do upload (API-18)", () => {
  let app: ReturnType<typeof makeApp>;
  let storage: InMemoryObjectStorage;
  beforeEach(async () => {
    storage = new InMemoryObjectStorage();
    setObjectStorage(storage);
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
    setObjectStorage(undefined);
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const boundary = "----cardapio";
  const upload = (cookie: string | undefined, file: Buffer, kind = "PRODUCT") =>
    app.inject({
      method: "POST",
      url: `/api/media/images?kind=${kind}`,
      headers: { cookie: cookie!, "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  const jpeg = (w = 400, h = 300) => sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } }).jpeg().toBuffer();
  const del = (cookie: string | undefined, id: string) => app.inject({ method: "POST", url: `/api/media/images/${id}/delete`, headers: { cookie: cookie! } });

  describe("B) boot", () => {
    const prod = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
    const full = {
      ...prod,
      STORAGE_S3_ENDPOINT: "https://s3.exemplo",
      STORAGE_S3_BUCKET: "b",
      STORAGE_S3_ACCESS_KEY_ID: "k",
      STORAGE_S3_SECRET_ACCESS_KEY: "s",
      STORAGE_PUBLIC_BASE_URL: "https://cdn.exemplo/b",
    } as NodeJS.ProcessEnv;
    it("produção (ou NODE_ENV ausente) sem S3 configurado recusa subir; dev e teste aceitam o Fake", () => {
      expect(() => assertStorageBootConfig(prod)).toThrow(/faltam .*STORAGE_S3_ENDPOINT/);
      expect(() => assertStorageBootConfig({} as NodeJS.ProcessEnv)).toThrow(/Fake em memória/);
      expect(() => assertStorageBootConfig({ ...full, STORAGE_S3_SECRET_ACCESS_KEY: "" })).toThrow(/STORAGE_S3_SECRET_ACCESS_KEY/);
      expect(() => assertStorageBootConfig({ ...full, STORAGE_PUBLIC_BASE_URL: "http://cdn.exemplo/b" })).toThrow(/https/);
      expect(() => assertStorageBootConfig(full)).not.toThrow();
      expect(() => assertStorageBootConfig({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).not.toThrow();
      expect(() => assertStorageBootConfig({ NODE_ENV: "test" } as NodeJS.ProcessEnv)).not.toThrow();
    });
  });

  describe("A) faixa do sharp", () => {
    it("um segundo upload da MESMA loja enquanto o primeiro processa recebe 503 SERVER_BUSY e nada é gravado por ele", async () => {
      const { cookie } = await registerStore(app);
      const store = await prisma.store.findFirstOrThrow();
      let release!: () => void;
      const hold = imageLane.run(store.id, () => new Promise<void>((resolve) => (release = resolve))); // ocupa a vaga desta loja
      const res = await upload(cookie, await jpeg());
      expect(res.statusCode).toBe(503);
      expect(JSON.parse(res.body).code).toBe("SERVER_BUSY");
      expect(res.headers["retry-after"]).toBeDefined();
      expect(storage.objects.size).toBe(0);
      expect(await prisma.image.count()).toBe(0);
      release();
      await hold;
      expect((await upload(cookie, await jpeg())).statusCode).toBe(201); // a vaga voltou
    });
    it("a vaga volta mesmo quando o processamento falha (imagem inválida)", async () => {
      const { cookie } = await registerStore(app);
      expect((await upload(cookie, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("lixo")]))).statusCode).toBe(422);
      expect(imageLane.active).toBe(0);
      expect((await upload(cookie, await jpeg())).statusCode).toBe(201);
    });
  });

  describe("C) remoção e papéis", () => {
    it("só o OWNER apaga imagem; STAFF recebe 403 e nada é apagado", async () => {
      const { cookie } = await registerStore(app);
      const image = JSON.parse((await upload(cookie, await jpeg())).body).image;
      await prisma.user.updateMany({ data: { role: "STAFF" } });
      expect((await del(cookie, image.id)).statusCode).toBe(403);
      expect(storage.objects.size).toBe(3);
      await prisma.user.updateMany({ data: { role: "OWNER" } });
      expect((await del(cookie, image.id)).statusCode).toBe(200);
      expect(storage.objects.size).toBe(0);
    });
    it("409 IMAGE_IN_USE se um produto ou a loja (logo/capa) ainda usa a imagem; solto o uso, apaga", async () => {
      const { cookie } = await registerStore(app);
      const store = await prisma.store.findFirstOrThrow();
      const a = JSON.parse((await upload(cookie, await jpeg())).body).image;
      const b = JSON.parse((await upload(cookie, await jpeg(200, 200), "LOGO")).body).image;
      const product = await prisma.product.create({ data: { storeId: store.id, name: "P", priceCents: 100, imageUrl: a.url } });
      await prisma.store.update({ where: { id: store.id }, data: { logoUrl: b.url } });
      for (const id of [a.id, b.id]) {
        const res = await del(cookie, id);
        expect(res.statusCode).toBe(409);
        expect(JSON.parse(res.body).code).toBe("IMAGE_IN_USE");
      }
      expect(storage.objects.size).toBe(5); // 3 de produto + 2 de logo (200 px: larguras 128 e 256)
      await prisma.product.update({ where: { id: product.id }, data: { imageUrl: null } });
      await prisma.store.update({ where: { id: store.id }, data: { logoUrl: null } });
      expect((await del(cookie, a.id)).statusCode).toBe(200);
      expect((await del(cookie, b.id)).statusCode).toBe(200);
      expect(storage.objects.size).toBe(0);
    });
    it("logo e capa só do OWNER; foto de produto também do STAFF", async () => {
      const { cookie } = await registerStore(app);
      await prisma.user.updateMany({ data: { role: "STAFF" } });
      for (const kind of ["LOGO", "COVER"]) {
        const res = await upload(cookie, await jpeg(), kind);
        expect(res.statusCode).toBe(403);
        expect(JSON.parse(res.body).code).toBe("FORBIDDEN_ROLE");
      }
      expect(storage.objects.size).toBe(0);
      expect((await upload(cookie, await jpeg(), "PRODUCT")).statusCode).toBe(201);
    });
  });

  describe("cota sem corrida", () => {
    it("reservas simultâneas (direto na etapa da cota, sem a faixa) nunca passam do teto", async () => {
      await registerStore(app);
      const store = await prisma.store.findFirstOrThrow();
      await prisma.image.createMany({
        data: Array.from({ length: 499 }, (_, i) => ({ storeId: store.id, kind: "PRODUCT" as const, keyBase: `stores/${store.id}/q${i}`, widths: [320], bytes: 1, status: "READY" as const })),
      });
      const { mediaService } = await import("../src/modules/media/media.module");
      // `reserve` é a etapa da cota, chamada DIRETO (sem a faixa do sharp): só o lock advisory impede que as 8 vejam "499" ao mesmo tempo.
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => mediaService.reserve(store.id, "PRODUCT", `stores/${store.id}/r${i}`, [320], 1)));
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      expect(rejected).toHaveLength(7);
      expect(rejected.every((r) => r.reason?.code === "IMAGE_QUOTA_EXCEEDED")).toBe(true);
      expect(await prisma.image.count({ where: { storeId: store.id } })).toBe(500);
    });
  });
});
