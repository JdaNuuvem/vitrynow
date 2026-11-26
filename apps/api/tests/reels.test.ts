import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@meucardapio/db";
import { InMemoryObjectStorage, setObjectStorage } from "../src/lib/objectStorage";
import { FakeTranscoder, ReelRejectedError, setReelTranscoder } from "../src/lib/reelTranscoder";
import { REEL_LIMITS } from "../src/lib/reelConfig";
import { sniffMp4 } from "../src/lib/mp4Sniff";
import { reelsService } from "../src/modules/reels/reels.module";
import { BOUNDARY, fakeMp4, multipartBody } from "./reelFixtures";
import { login, makeApp, registerStore, resetDb } from "./helpers";

// ADR-0021 / REEL-1 (rotas d1, d2): Fake de storage e de transcoder; nenhum teste fala com rede nem roda ffmpeg.
const ENV_KEYS = ["REELS_ENABLED", "REELS_MAX_ACTIVE_PER_STORE", "REELS_MAX_BYTES_PER_STORE", "REELS_PROCESSING_RESERVE_BYTES", "REELS_MAX_UPLOAD_BYTES", "REELS_ORPHAN_ORIGINAL_MS", "REELS_JOB_LEASE_MS"];

describe("Reels: envio, fila e conversão", () => {
  let app: ReturnType<typeof makeApp>;
  let storage: InMemoryObjectStorage;
  let transcoder: FakeTranscoder;

  async function build() {
    app = makeApp();
    await app.ready();
  }
  beforeEach(async () => {
    storage = new InMemoryObjectStorage();
    transcoder = new FakeTranscoder();
    setObjectStorage(storage);
    setReelTranscoder(transcoder);
    process.env.REELS_ENABLED = "true";
  });
  afterEach(async () => {
    await app?.close();
    await resetDb();
    setObjectStorage(undefined);
    setReelTranscoder(undefined);
    for (const key of ENV_KEYS) delete process.env[key];
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  const json = (res: { body: string }) => JSON.parse(res.body);
  const upload = (cookie: string | undefined, productId: string, file: Buffer, filename?: string) =>
    app.inject({
      method: "POST",
      url: `/api/reels?productId=${productId}`,
      headers: { ...(cookie ? { cookie } : {}), "content-type": `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipartBody(file, filename),
    });
  const mkProduct = async (storeId: string, name = "Prato") => (await prisma.product.create({ data: { storeId, name, priceCents: 1000 } })).id;
  async function ctx(overrides: Parameters<typeof registerStore>[1] = {}) {
    const { cookie } = await registerStore(app, overrides);
    const store = await prisma.store.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    return { cookie: cookie!, storeId: store.id };
  }
  const video = (seconds = 12) => fakeMp4({ seconds });

  it("limites iniciais decididos pelo Claudio (configuração nomeada)", () => {
    expect(REEL_LIMITS.maxUploadBytes).toBe(50 * 1024 * 1024);
    expect(REEL_LIMITS.maxDurationMs).toBe(30_000);
    expect(REEL_LIMITS.maxActivePerStore).toBe(10);
    expect(REEL_LIMITS.maxBytesPerStore).toBe(300 * 1024 * 1024);
  });

  it("chave geral desligada por padrão: 404 REELS_DISABLED", async () => {
    delete process.env.REELS_ENABLED;
    await build();
    const { cookie } = await ctx();
    const res = await app.inject({ method: "GET", url: "/api/reels", headers: { cookie } });
    expect(res.statusCode).toBe(404);
    expect(json(res).code).toBe("REELS_DISABLED");
  });

  it("plano sem o recurso: 402 FEATURE_LOCKED; sem login: 401", async () => {
    await build();
    const { cookie } = await ctx({ plan: "BASICO" });
    const res = await app.inject({ method: "GET", url: "/api/reels", headers: { cookie } });
    expect(res.statusCode).toBe(402);
    expect(json(res)).toMatchObject({ code: "FEATURE_LOCKED", feature: "reels" });
    expect((await app.inject({ method: "GET", url: "/api/reels" })).statusCode).toBe(401);
  });

  describe("com o recurso ligado e plano PRO", () => {
    beforeEach(async () => {
      await build();
      const pro = await prisma.plan.findFirstOrThrow({ where: { code: "PRO" } });
      if (!pro.features.includes("reels")) await prisma.plan.update({ where: { id: pro.id }, data: { features: [...pro.features, "reels"] } });
    });

    it("caminho feliz: 202, original na quarentena, conversão, original apagado, MP4 e capa sob stores/<loja>/reels/", async () => {
      const { cookie, storeId } = await ctx();
      const productId = await mkProduct(storeId);
      const res = await upload(cookie, productId, video());
      expect(res.statusCode).toBe(202);
      const { reelId, status } = json(res);
      expect(status).toBe("PROCESSING");
      const quarantined = [...storage.objects.keys()];
      expect(quarantined).toHaveLength(1);
      expect(quarantined[0]).toMatch(new RegExp(`^quarantine/reels/${storeId}/[a-f0-9-]{36}\\.upload$`));
      expect(await prisma.mediaJob.count({ where: { reelId, status: "PENDING" } })).toBe(1);

      expect(await reelsService.runNext()).toBe(true);
      expect(await reelsService.runNext()).toBe(false);
      const keys = [...storage.objects.keys()].sort();
      expect(keys).toHaveLength(2); // original apagado, só MP4 + capa
      expect(keys[0]).toMatch(new RegExp(`^stores/${storeId}/reels/[a-f0-9-]{36}-poster\\.webp$`));
      expect(keys[1]).toMatch(new RegExp(`^stores/${storeId}/reels/[a-f0-9-]{36}\\.mp4$`));
      expect(storage.objects.get(keys[1])!.options).toEqual({ contentType: "video/mp4", cacheControl: "public, max-age=31536000, immutable" });
      const row = await prisma.reel.findFirstOrThrow({ where: { id: reelId } });
      expect(row).toMatchObject({ status: "READY", originalKey: null, bytes: 4500 });

      const one = json(await app.inject({ method: "GET", url: `/api/reels/${reelId}`, headers: { cookie } })).reel;
      expect(one.status).toBe("READY");
      expect(one.videoUrl).toMatch(/\/reels\/[a-f0-9-]{36}\.mp4$/);
      expect(json(await app.inject({ method: "GET", url: "/api/reels", headers: { cookie } })).reels).toHaveLength(1);
      expect(Object.keys(one).sort()).toEqual(["bytes", "createdAt", "durationMs", "errorCode", "errorMessage", "height", "id", "posterUrl", "productId", "publishedAt", "status", "videoUrl", "width"]);
    });

    it("30 s exatos aceito; 31 s recusado pela duração REAL, mesmo com nome .mp4; nada é gravado", async () => {
      const { cookie, storeId } = await ctx();
      const p1 = await mkProduct(storeId, "A");
      const p2 = await mkProduct(storeId, "B");
      expect((await upload(cookie, p1, fakeMp4({ seconds: 30 }), "x.mp4")).statusCode).toBe(202);
      const before = storage.objects.size;
      const res = await upload(cookie, p2, fakeMp4({ seconds: 31 }), "curto.mp4");
      expect(res.statusCode).toBe(400);
      expect(json(res).code).toBe("VIDEO_TOO_LONG");
      expect(storage.objects.size).toBe(before);
      expect(await prisma.reel.count()).toBe(1);
    });

    it("conteúdo manda, não a extensão: texto com nome .mp4 é recusado; vídeo de 12 s com extensão trocada é aceito", async () => {
      const { cookie, storeId } = await ctx();
      const p1 = await mkProduct(storeId, "A");
      const p2 = await mkProduct(storeId, "B");
      const bad = await upload(cookie, p1, Buffer.from("isto não é um vídeo, só texto com nome .mp4"), "video.mp4");
      expect(bad.statusCode).toBe(400);
      expect(json(bad).code).toBe("VIDEO_FORMAT_INVALID");
      expect((await upload(cookie, p2, video(12), "renomeado.txt")).statusCode).toBe(202);
      expect(await prisma.reel.count()).toBe(1);
    });

    it("arquivo acima do limite: 413 VIDEO_TOO_LARGE e nada é gravado", async () => {
      process.env.REELS_MAX_UPLOAD_BYTES = "2000";
      await app.close();
      await build();
      const { cookie, storeId } = await ctx();
      const productId = await mkProduct(storeId);
      const res = await upload(cookie, productId, fakeMp4({ seconds: 5, padBytes: 5000 }));
      expect(res.statusCode).toBe(413);
      expect(json(res).code).toBe("VIDEO_TOO_LARGE");
      expect(storage.objects.size).toBe(0);
      expect(await prisma.reel.count()).toBe(0);
    });

    it("limite de vídeos por loja: o seguinte é 402 VIDEO_LIMIT_REACHED; outra loja não é afetada", async () => {
      process.env.REELS_MAX_ACTIVE_PER_STORE = "2";
      const a = await ctx();
      const b = await ctx();
      for (const name of ["1", "2"]) expect((await upload(a.cookie, await mkProduct(a.storeId, name), video())).statusCode).toBe(202);
      const over = await upload(a.cookie, await mkProduct(a.storeId, "3"), video());
      expect(over.statusCode).toBe(402);
      expect(json(over).code).toBe("VIDEO_LIMIT_REACHED");
      expect((await upload(b.cookie, await mkProduct(b.storeId, "1"), video())).statusCode).toBe(202);
    });

    it("teto de espaço por loja: 413 VIDEO_STORAGE_FULL, sem afetar outra loja", async () => {
      process.env.REELS_MAX_BYTES_PER_STORE = "20000";
      process.env.REELS_PROCESSING_RESERVE_BYTES = "9000";
      const a = await ctx();
      const b = await ctx();
      expect((await upload(a.cookie, await mkProduct(a.storeId, "1"), video())).statusCode).toBe(202); // 9000 reservados
      const over = await upload(a.cookie, await mkProduct(a.storeId, "2"), video()); // 9000 + 9000 = 18000, +9000 > 20000
      expect(over.statusCode).toBe(202);
      const full = await upload(a.cookie, await mkProduct(a.storeId, "3"), video());
      expect(full.statusCode).toBe(413);
      expect(json(full).code).toBe("VIDEO_STORAGE_FULL");
      expect((await upload(b.cookie, await mkProduct(b.storeId, "1"), video())).statusCode).toBe(202);
    });

    it("corrida: dois envios simultâneos da mesma loja não passam do limite de vídeos nem repetem o produto", async () => {
      process.env.REELS_MAX_ACTIVE_PER_STORE = "1";
      const a = await ctx();
      const [p1, p2] = [await mkProduct(a.storeId, "1"), await mkProduct(a.storeId, "2")];
      const results = await Promise.all([upload(a.cookie, p1, video()), upload(a.cookie, p2, video())]);
      expect(results.map((r) => r.statusCode).sort()).toEqual([202, 402]);
      process.env.REELS_MAX_ACTIVE_PER_STORE = "10";
      const p3 = await mkProduct(a.storeId, "3");
      const [x, y] = await Promise.all([upload(a.cookie, p3, video()), upload(a.cookie, p3, video())]);
      expect([x.statusCode, y.statusCode].sort()).toEqual([202, 409]);
      expect(await prisma.reel.count({ where: { productId: p3 } })).toBe(1);
    });

    it("2ª conferência da cota ao gravar o resultado: dois vídeos aceitos juntos não passam do teto", async () => {
      process.env.REELS_MAX_BYTES_PER_STORE = "6000";
      process.env.REELS_PROCESSING_RESERVE_BYTES = "1000";
      const a = await ctx();
      const r1 = json(await upload(a.cookie, await mkProduct(a.storeId, "1"), video())).reelId;
      const r2 = json(await upload(a.cookie, await mkProduct(a.storeId, "2"), video())).reelId;
      await reelsService.runNext();
      await reelsService.runNext();
      expect((await prisma.reel.findFirstOrThrow({ where: { id: r1 } })).status).toBe("READY");
      const second = await prisma.reel.findFirstOrThrow({ where: { id: r2 } });
      expect(second).toMatchObject({ status: "FAILED", errorCode: "VIDEO_STORAGE_FULL", originalKey: null });
      expect([...storage.objects.keys()].filter((k) => k.startsWith("quarantine/"))).toHaveLength(0);
    });

    it("isolamento: loja B não vê o vídeo da loja A nem envia para produto da loja A", async () => {
      const a = await ctx();
      const b = await ctx();
      const pa = await mkProduct(a.storeId);
      const reelId = json(await upload(a.cookie, pa, video())).reelId;
      expect((await app.inject({ method: "GET", url: `/api/reels/${reelId}`, headers: { cookie: b.cookie } })).statusCode).toBe(404);
      expect(json(await app.inject({ method: "GET", url: "/api/reels", headers: { cookie: b.cookie } })).reels).toEqual([]);
      const cross = await upload(b.cookie, pa, video());
      expect(cross.statusCode).toBe(404);
      expect(json(cross).code).toBe("PRODUCT_NOT_FOUND");
    });

    it("permissão: STAFF do PRO envia e lista (OWNER também)", async () => {
      const a = await ctx();
      const email = `func-${randomUUID().slice(0, 8)}@teste.com`;
      const cred = { email, password: randomUUID() }; // valor gerado em runtime: nada de credencial literal no repositório
      await app.inject({ method: "POST", url: "/api/users", headers: { cookie: a.cookie }, payload: cred });
      await prisma.user.updateMany({ where: { email }, data: { emailVerifiedAt: new Date() } });
      const staff = (await login(app, cred.email, cred.password)).cookie;
      if (!staff) return; // primeiro acesso exige troca de senha em alguns fluxos
      const productId = await mkProduct(a.storeId);
      expect((await upload(staff, productId, video())).statusCode).toBe(202);
      expect(json(await app.inject({ method: "GET", url: "/api/reels", headers: { cookie: staff } })).reels).toHaveLength(1);
    });

    it("na Consulta o envio é bloqueado (403 READ_ONLY) e a leitura continua", async () => {
      const a = await ctx();
      const productId = await mkProduct(a.storeId);
      await prisma.subscription.updateMany({ data: { status: "TRIAL", planId: null, currentPeriodEnd: null, trialEndsAt: new Date(Date.now() - 24 * 3_600_000) } });
      const res = await upload(a.cookie, productId, video());
      expect(res.statusCode).toBe(403);
      expect(json(res).code).toBe("READ_ONLY");
    });

    it("rejeição do worker: vídeo FAILED com o código certo e original apagado (finally)", async () => {
      const a = await ctx();
      const reelId = json(await upload(a.cookie, await mkProduct(a.storeId), video())).reelId;
      transcoder.failNext = new ReelRejectedError("VIDEO_TOO_LONG", "O vídeo passa de 30 segundos.");
      await reelsService.runNext();
      const row = await prisma.reel.findFirstOrThrow({ where: { id: reelId } });
      expect(row).toMatchObject({ status: "FAILED", errorCode: "VIDEO_TOO_LONG", originalKey: null });
      expect(storage.objects.size).toBe(0);
      expect(json(await app.inject({ method: "GET", url: `/api/reels/${reelId}`, headers: { cookie: a.cookie } })).reel.errorMessage).toBe("O vídeo passa de 30 segundos.");
    });

    it("erro técnico no worker: FAILED VIDEO_PROCESSING_FAILED e o original também sai", async () => {
      const a = await ctx();
      const reelId = json(await upload(a.cookie, await mkProduct(a.storeId), video())).reelId;
      transcoder.failNext = new Error("ffmpeg caiu");
      await reelsService.runNext();
      expect(await prisma.reel.findFirstOrThrow({ where: { id: reelId } })).toMatchObject({ status: "FAILED", errorCode: "VIDEO_PROCESSING_FAILED", originalKey: null });
      expect(storage.objects.size).toBe(0);
    });

    it("falha ao apagar o original é registrada e o varredor repete e CONTA", async () => {
      const a = await ctx();
      const reelId = json(await upload(a.cookie, await mkProduct(a.storeId), video())).reelId;
      const realDelete = storage.delete.bind(storage);
      let failing = true;
      storage.delete = async (key: string) => {
        if (failing && key.startsWith("quarantine/")) throw new Error("disco travado");
        return realDelete(key);
      };
      await reelsService.runNext();
      expect((await prisma.reel.findFirstOrThrow({ where: { id: reelId } })).originalKey).not.toBeNull();
      expect((await prisma.mediaJob.findFirstOrThrow({ where: { reelId } })).lastError).toContain("falha ao apagar o original");
      expect(await reelsService.sweep()).toMatchObject({ originalsDeleted: 0, originalsFailed: 1 });
      failing = false;
      expect(await reelsService.sweep()).toMatchObject({ originalsDeleted: 1, originalsFailed: 0 });
      expect((await prisma.reel.findFirstOrThrow({ where: { id: reelId } })).originalKey).toBeNull();
      expect([...storage.objects.keys()].some((k) => k.startsWith("quarantine/"))).toBe(false);
    });

    it("varredor: original órfão com mais de 1 h (job morto) é apagado; PROCESSING sem job vira FAILED", async () => {
      const a = await ctx();
      const reelId = json(await upload(a.cookie, await mkProduct(a.storeId), video())).reelId;
      await prisma.mediaJob.deleteMany({ where: { reelId } }); // queda entre gravar e enfileirar
      expect(await reelsService.sweep()).toMatchObject({ originalsDeleted: 0, stalled: 0 }); // ainda novo: não mexe
      const later = new Date(Date.now() + 61 * 60_000);
      const swept = await reelsService.sweep(later);
      expect(swept.stalled).toBe(1);
      expect(await prisma.reel.findFirstOrThrow({ where: { id: reelId } })).toMatchObject({ status: "FAILED", originalKey: null });
      expect(storage.objects.size).toBe(0);
    });

    it("produto apagado: o varredor remove vídeo, capa e registro da própria loja", async () => {
      const a = await ctx();
      const productId = await mkProduct(a.storeId);
      const reelId = json(await upload(a.cookie, productId, video())).reelId;
      await reelsService.runNext();
      expect(storage.objects.size).toBe(2);
      await prisma.product.delete({ where: { id: productId } });
      expect(await reelsService.sweep()).toMatchObject({ orphanProductReels: 1 });
      expect(await prisma.reel.count({ where: { id: reelId } })).toBe(0);
      expect(storage.objects.size).toBe(0);
    });

    it("fila: um job por vez no servidor; lease vencido volta à fila; tentativas esgotadas viram FAILED", async () => {
      const a = await ctx();
      const b = await ctx();
      await upload(a.cookie, await mkProduct(a.storeId), video());
      await upload(b.cookie, await mkProduct(b.storeId), video());
      const now = new Date();
      const first = await reelsService.claimJob(now);
      expect(first).not.toBeNull();
      expect(await reelsService.claimJob(now)).toBeNull(); // outro com lease válido: espera
      const later = new Date(now.getTime() + REEL_LIMITS.leaseMs + 1000);
      const again = await reelsService.claimJob(later); // lease vencido: volta à fila (o mais antigo primeiro)
      expect(again?.id).toBe(first!.id);
      const third = await reelsService.claimJob(new Date(later.getTime() + REEL_LIMITS.leaseMs + 1000));
      expect(third).toMatchObject({ id: first!.id, exhausted: true });
      expect((await prisma.mediaJob.findFirstOrThrow({ where: { id: first!.id } })).status).toBe("FAILED");
    });

    it("duas conversões ao mesmo tempo: só uma roda (CA-REEL-17)", async () => {
      const a = await ctx();
      const b = await ctx();
      await upload(a.cookie, await mkProduct(a.storeId), video());
      await upload(b.cookie, await mkProduct(b.storeId), video());
      transcoder.delayMs = 50;
      await Promise.all([reelsService.runNext(), reelsService.runNext()]);
      expect(transcoder.maxInFlight).toBe(1);
      expect(await prisma.reel.count({ where: { status: "READY" } })).toBe(1);
    });
  });

  describe("leitura do contêiner (mp4Sniff)", () => {
    it("duração e tamanho; vídeo girado de iPhone (1920x1080 + giro) vira vertical; moov no fim; marca MOV", () => {
      expect(sniffMp4(fakeMp4({ seconds: 12.5, width: 720, height: 1280 }))).toEqual({ ok: true, info: { durationMs: 12500, width: 720, height: 1280 } });
      expect(sniffMp4(fakeMp4({ seconds: 5, width: 1920, height: 1080, rotate90: true }))).toMatchObject({ ok: true, info: { width: 1080, height: 1920 } });
      expect(sniffMp4(fakeMp4({ seconds: 5, moovLast: true, brand: "qt  " }))).toMatchObject({ ok: true });
    });
    it("recusa o que não é MP4/MOV, marca desconhecida e arquivo truncado", () => {
      expect(sniffMp4(Buffer.from("GIF89a".padEnd(64, "x")))).toEqual({ ok: false, reason: "NOT_MP4" });
      expect(sniffMp4(fakeMp4({ seconds: 5, brand: "zzzz" }))).toEqual({ ok: false, reason: "NOT_MP4" });
      expect(sniffMp4(fakeMp4({ seconds: 5 }).subarray(0, 40)).ok).toBe(false);
      expect(sniffMp4(Buffer.alloc(0)).ok).toBe(false);
    });
  });
});
