import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "@meucardapio/db";
import { createObjectStorageFromEnv, LocalDiskStorage, setObjectStorage } from "../src/lib/objectStorage";
import { makeApp, registerStore, resetDb } from "./helpers";

// Decisão do Claudio (18/11): produção sem S3; uploads em disco local, servidos pelo Caddy.
const KEY = "stores/loja1/123e4567-e89b-12d3-a456-426614174000-320.webp";
async function writeOutside(outside: string) {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path.join(outside, "segredo.txt"), "nao mexer");
}
const opts = { contentType: "image/webp", cacheControl: "x" };

describe("LocalDiskStorage", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cardapio-uploads-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("grava, sobrescreve atômico, apaga e devolve a URL pública sob a rota de mídia", async () => {
    const s = new LocalDiskStorage(dir, "https://exemplo.com/media/");
    await s.put(KEY, Buffer.from("um"), opts);
    expect((await readFile(path.join(dir, KEY))).toString()).toBe("um");
    await s.put(KEY, Buffer.from("dois"), opts);
    expect((await readFile(path.join(dir, KEY))).toString()).toBe("dois");
    expect(await readdir(path.join(dir, "stores/loja1"))).toEqual(["123e4567-e89b-12d3-a456-426614174000-320.webp"]); // sem .tmp sobrando
    expect(s.publicUrl(KEY)).toBe(`https://exemplo.com/media/${KEY}`);
    await s.delete(KEY);
    await expect(stat(path.join(dir, KEY))).rejects.toThrow();
    await s.delete(KEY); // apagar o que não existe não é erro
  });

  it("recusa path traversal e chaves fora do padrão (nada é escrito fora da raiz)", async () => {
    const s = new LocalDiskStorage(path.join(dir, "uploads"), "https://exemplo.com/media");
    const bad = [
      "stores/x/../../etc.webp",
      "../fora.webp",
      "/etc/passwd",
      "stores/a/b/123e4567-e89b-12d3-a456-426614174000-320.webp",
      "stores/loja1/nome-qualquer.webp",
      "stores/loja1\\123e4567-e89b-12d3-a456-426614174000-320.webp",
      "stores/loja1/123e4567-e89b-12d3-a456-426614174000-320.html",
      "stores/lo ja/123e4567-e89b-12d3-a456-426614174000-320.webp",
      "stores/%2e%2e/123e4567-e89b-12d3-a456-426614174000-320.webp",
      "stores/%2e%2e%2f%2e%2e/x.webp",
      "stores/..%5c..%5c/123e4567-e89b-12d3-a456-426614174000-320.webp",
      "stores//123e4567-e89b-12d3-a456-426614174000-320.webp",
      "stores/loja1/123e4567-e89b-12d3-a456-426614174000-320.webp\0.png",
    ];
    for (const key of bad) {
      await expect(s.put(key, Buffer.from("x"), opts)).rejects.toThrow();
      await expect(s.delete(key)).rejects.toThrow();
      expect(() => s.publicUrl(key)).toThrow();
    }
    expect(await readdir(dir)).toEqual([]); // nem a pasta de uploads foi criada
  });

  it("symlink plantado em stores/<loja> não leva a gravação nem o apagar para fora da raiz", async () => {
    const root = path.join(dir, "uploads");
    const outside = path.join(dir, "fora");
    await mkdir(path.join(root, "stores"), { recursive: true });
    await mkdir(outside, { recursive: true });
    try {
      await symlink(outside, path.join(root, "stores", "loja1"), "junction");
    } catch {
      return; // sem permissão para criar link neste ambiente: o teste não se aplica
    }
    await writeOutside(outside);
    const s = new LocalDiskStorage(root, "https://exemplo.com/media");
    await expect(s.put(KEY, Buffer.from("x"), opts)).rejects.toThrow(/fora da raiz/);
    await expect(s.delete(KEY)).rejects.toThrow(/fora da raiz/);
    expect(await readdir(outside)).toEqual(["segredo.txt"]); // nada novo, nada apagado
  });

  it("exige raiz absoluta", () => {
    expect(() => new LocalDiskStorage("uploads", "https://x/media")).toThrow(/absoluto/);
  });

  it("falha na escrita não deixa arquivo temporário nem objeto", async () => {
    const s = new LocalDiskStorage(dir, "https://exemplo.com/media");
    await s.put(KEY, Buffer.from("ok"), opts);
    await expect(s.put(KEY, undefined as unknown as Buffer, opts)).rejects.toThrow();
    expect(await readdir(path.join(dir, "stores/loja1"))).toEqual(["123e4567-e89b-12d3-a456-426614174000-320.webp"]);
    expect((await readFile(path.join(dir, KEY))).toString()).toBe("ok");
  });
});

describe("createObjectStorageFromEnv com STORAGE_DRIVER=local", () => {
  const abs = process.platform === "win32" ? "C:\\dados\\uploads" : "/var/lib/cardapio/uploads";
  const prod = { NODE_ENV: "production", STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: abs, STORAGE_PUBLIC_BASE_URL: "https://exemplo.com/media" } as NodeJS.ProcessEnv;

  it("em produção devolve o driver em disco, sem nenhuma variável STORAGE_S3_*", () => {
    const storage = createObjectStorageFromEnv(prod);
    expect(storage).toBeInstanceOf(LocalDiskStorage);
    expect(storage.publicUrl(KEY)).toBe(`https://exemplo.com/media/${KEY}`);
  });
  it("em dev/teste também exige pasta absoluta e URL pública (nunca cai em silêncio no Fake)", () => {
    const dev = { ...prod, NODE_ENV: "development", STORAGE_PUBLIC_BASE_URL: "http://localhost:8080/media" } as NodeJS.ProcessEnv;
    expect(createObjectStorageFromEnv(dev)).toBeInstanceOf(LocalDiskStorage);
    expect(() => createObjectStorageFromEnv({ ...dev, STORAGE_LOCAL_DIR: "uploads" })).toThrow(/STORAGE_LOCAL_DIR/);
    expect(() => createObjectStorageFromEnv({ ...dev, STORAGE_LOCAL_DIR: "" })).toThrow(/STORAGE_LOCAL_DIR/);
    expect(() => createObjectStorageFromEnv({ ...dev, STORAGE_PUBLIC_BASE_URL: "" })).toThrow(/STORAGE_PUBLIC_BASE_URL/);
  });
});

describe("upload ponta a ponta no disco local", () => {
  let app: ReturnType<typeof makeApp>;
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "cardapio-uploads-"));
    setObjectStorage(new LocalDiskStorage(dir, "https://exemplo.com/media"));
    app = makeApp();
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
    await resetDb();
    setObjectStorage(undefined);
    await rm(dir, { recursive: true, force: true });
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
      payload: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="..%2F..%2Fx.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), file, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    });
  const jpeg = () => sharp({ create: { width: 900, height: 600, channels: 3, background: "#aa5522" } }).jpeg().toBuffer();

  it("grava WebP sob <pasta>/stores/<loja>/, URL pública pela rota de mídia, e apagar remove os arquivos", async () => {
    const { cookie } = await registerStore(app);
    const store = await prisma.store.findFirstOrThrow();
    const res = await upload(cookie, await jpeg());
    expect(res.statusCode).toBe(201);
    const { image } = JSON.parse(res.body);
    const files = await readdir(path.join(dir, "stores", store.id));
    expect(files).toHaveLength(3);
    for (const f of files) {
      expect(f).toMatch(/^[a-f0-9-]{36}-(320|640|1280)\.webp$/);
      expect((await sharp(await readFile(path.join(dir, "stores", store.id, f))).metadata()).format).toBe("webp");
    }
    expect(image.url).toMatch(new RegExp(`^https://exemplo\\.com/media/stores/${store.id}/[a-f0-9-]{36}-1280\\.webp$`));
    expect((await app.inject({ method: "POST", url: `/api/media/images/${image.id}/delete`, headers: { cookie: cookie! } })).statusCode).toBe(200);
    expect(await readdir(path.join(dir, "stores", store.id))).toEqual([]);
  });

  it("a validação continua valendo no disco: HTML renomeado .jpg não grava nada", async () => {
    const { cookie } = await registerStore(app);
    const res = await upload(cookie, Buffer.from("<html><script>alert(1)</script></html>"));
    expect([400, 415]).toContain(res.statusCode);
    expect(await readdir(dir)).toEqual([]);
  });
});
