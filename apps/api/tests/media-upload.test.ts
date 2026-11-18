import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@meucardapio/db";
import { InMemoryObjectStorage, setObjectStorage } from "../src/lib/objectStorage";
import { mediaService } from "../src/modules/media/media.module";
import { makeApp, registerStore, resetDb } from "./helpers";

// API-18 / ADR-0010 / CA-B12: upload pela API com pipeline de imagem, Fake de storage em memória.
describe("upload de imagens", () => {
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
  function multipartBody(file: Buffer, filename = "foto.jpg", contentType = "image/jpeg") {
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`);
    return Buffer.concat([head, file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  }
  const upload = (cookie: string | undefined, file: Buffer, kind = "PRODUCT", filename?: string, contentType?: string) =>
    app.inject({
      method: "POST",
      url: `/api/media/images?kind=${kind}`,
      headers: { ...(cookie ? { cookie } : {}), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: multipartBody(file, filename, contentType),
    });
  const jpeg = (w = 2000, h = 1500) => sharp({ create: { width: w, height: h, channels: 3, background: "#cc3333" } }).jpeg().toBuffer();

  it("caminho feliz: gera WebP em larguras fixas sob stores/<loja>/ e devolve URLs públicas", async () => {
    const { cookie } = await registerStore(app);
    const res = await upload(cookie, await jpeg());
    expect(res.statusCode).toBe(201);
    const { image } = JSON.parse(res.body);
    expect(image.variants.map((v: { width: number }) => v.width)).toEqual([320, 640, 1280]);
    const store = await prisma.store.findFirstOrThrow();
    const keys = [...storage.objects.keys()];
    expect(keys).toHaveLength(3);
    for (const k of keys) {
      expect(k).toMatch(new RegExp(`^stores/${store.id}/[a-f0-9-]{36}-(320|640|1280)\\.webp$`));
      expect(storage.objects.get(k)!.options).toEqual({ contentType: "image/webp", cacheControl: "public, max-age=31536000, immutable" });
      expect((await sharp(storage.objects.get(k)!.body).metadata()).format).toBe("webp");
    }
    expect(image.url).toBe(`http://storage.test/media/${keys.find((k) => k.endsWith("-1280.webp"))}`);
    expect((await prisma.image.findFirstOrThrow()).status).toBe("READY");
  });

  it("não amplia imagem pequena e mantém o nome enviado fora da chave", async () => {
    const { cookie } = await registerStore(app);
    const res = await upload(cookie, await jpeg(100, 80), "LOGO", "..%2F..%2Fetc%2Fpasswd.jpg");
    expect(res.statusCode).toBe(201);
    for (const [k, v] of storage.objects) {
      expect(k).not.toContain("passwd");
      expect((await sharp(v.body).metadata()).width).toBe(100);
    }
  });

  it("remove EXIF/GPS e aplica a orientação", async () => {
    const { cookie } = await registerStore(app);
    const withGps = await sharp({ create: { width: 600, height: 300, channels: 3, background: "#222222" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "x" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(withGps).metadata()).exif).toBeDefined();
    expect((await upload(cookie, withGps)).statusCode).toBe(201);
    for (const v of storage.objects.values()) {
      const meta = await sharp(v.body).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.height).toBeGreaterThan(meta.width!); // orientação 6 girou 600x300 para retrato
    }
  });

  it("recusa pelo CONTEÚDO: HTML renomeado .jpg, SVG com script, GIF, vazio", async () => {
    const { cookie } = await registerStore(app);
    const cases: Buffer[] = [
      Buffer.from("<html><script>alert(1)</script></html>"),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "binary"),
      Buffer.alloc(0),
    ];
    for (const body of cases) {
      const res = await upload(cookie, body, "PRODUCT", "foto.jpg", "image/jpeg");
      expect([400, 415]).toContain(res.statusCode);
    }
    expect(storage.objects.size).toBe(0);
    expect(await prisma.image.count()).toBe(0);
  });

  it("recusa polyglot: cabeçalho JPEG com HTML no corpo", async () => {
    const { cookie } = await registerStore(app);
    const res = await upload(cookie, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("<script>alert(1)</script>")]));
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe("CORRUPT_IMAGE");
    expect(storage.objects.size).toBe(0);
  });

  it("recusa imagem gigante em pixels (image bomb)", async () => {
    const { cookie } = await registerStore(app);
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: "#ffffff" } }).png({ compressionLevel: 9 }).toBuffer();
    const res = await upload(cookie, bomb);
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).code).toBe("TOO_MANY_PIXELS");
    expect(storage.objects.size).toBe(0);
  });

  it("recusa arquivo acima do limite de tamanho (413)", async () => {
    const { cookie } = await registerStore(app);
    const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(9 * 1024 * 1024, 1)]);
    expect((await upload(cookie, big)).statusCode).toBe(413);
    expect(storage.objects.size).toBe(0);
  });

  it("exige sessão, kind válido e multipart", async () => {
    expect((await upload(undefined, await jpeg(50, 50))).statusCode).toBe(401);
    const { cookie } = await registerStore(app);
    expect((await upload(cookie, await jpeg(50, 50), "OUTRO")).statusCode).toBe(400);
    const json = await app.inject({ method: "POST", url: "/api/media/images?kind=PRODUCT", headers: { cookie: cookie!, "content-type": "application/json" }, payload: {} });
    expect(json.statusCode).toBe(415);
  });

  it("STAFF também pode enviar imagem (OWNER/STAFF)", async () => {
    const { cookie } = await registerStore(app);
    await prisma.user.updateMany({ data: { role: "STAFF" } });
    expect((await upload(cookie, await jpeg(300, 300))).statusCode).toBe(201);
  });

  it("falha do storage: 502, nada fica gravado nem em quarentena", async () => {
    const { cookie } = await registerStore(app);
    storage.failNextPut = true;
    const res = await upload(cookie, await jpeg(300, 300));
    expect(res.statusCode).toBe(502);
    expect(await prisma.image.count()).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it("cota por loja", async () => {
    const { cookie } = await registerStore(app);
    const store = await prisma.store.findFirstOrThrow();
    await prisma.image.createMany({
      data: Array.from({ length: 500 }, (_, i) => ({ storeId: store.id, kind: "PRODUCT" as const, keyBase: `stores/${store.id}/q${i}`, widths: [320], bytes: 1, status: "READY" as const })),
    });
    const res = await upload(cookie, await jpeg(300, 300));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe("IMAGE_QUOTA_EXCEEDED");
  });

  it("isolamento: loja B não remove imagem da loja A; remover apaga só as variantes da própria loja", async () => {
    const a = await registerStore(app, { slug: "loja-a", code: "A", email: "a@teste.com" });
    const b = await registerStore(app, { slug: "loja-b", code: "B", email: "b@teste.com" });
    const imgA = JSON.parse((await upload(a.cookie, await jpeg(400, 400))).body).image;
    await upload(b.cookie, await jpeg(400, 400));
    const before = storage.objects.size;

    const denied = await app.inject({ method: "POST", url: `/api/media/images/${imgA.id}/delete`, headers: { cookie: b.cookie! } });
    expect(denied.statusCode).toBe(404);
    expect(storage.objects.size).toBe(before);

    const ok = await app.inject({ method: "POST", url: `/api/media/images/${imgA.id}/delete`, headers: { cookie: a.cookie! } });
    expect(ok.statusCode).toBe(200);
    const storeA = await prisma.store.findUniqueOrThrow({ where: { slug: "loja-a" } });
    expect([...storage.objects.keys()].some((k) => k.startsWith(`stores/${storeA.id}/`))).toBe(false);
    expect(storage.objects.size).toBe(3); // as da loja B continuam
    expect(await prisma.image.count()).toBe(1);
  });

  it("quarentena: PENDING antiga é varrida (objetos e linha); PENDING recente não", async () => {
    await registerStore(app);
    const store = await prisma.store.findFirstOrThrow();
    const old = await prisma.image.create({
      data: { storeId: store.id, kind: "PRODUCT", keyBase: `stores/${store.id}/11111111-1111-1111-1111-111111111111`, widths: [320], bytes: 1, status: "PENDING", createdAt: new Date(Date.now() - 3600_000) },
    });
    const fresh = await prisma.image.create({
      data: { storeId: store.id, kind: "PRODUCT", keyBase: `stores/${store.id}/22222222-2222-2222-2222-222222222222`, widths: [320], bytes: 1, status: "PENDING" },
    });
    await storage.put(`${old.keyBase}-320.webp`, Buffer.from("x"), { contentType: "image/webp", cacheControl: "x" });
    expect(await mediaService.sweepStale()).toBe(1);
    expect(storage.objects.size).toBe(0);
    expect(await prisma.image.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.image.findUnique({ where: { id: fresh.id } })).not.toBeNull();
  });
});
