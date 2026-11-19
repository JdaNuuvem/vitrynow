import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Reel } from "@meucardapio/db";
import { REEL_ERRORS, type ReelErrorCode, type ReelView } from "@meucardapio/shared-types";
import { CodedError } from "../../shared/errors";
import { quarantineKey, storeKeyPrefix, type ObjectStorage } from "../../lib/objectStorage";
import { REEL_LIMITS } from "../../lib/reelConfig";
import { sniffMp4 } from "../../lib/mp4Sniff";
import { ReelRejectedError, tooLong, type ReelTranscoder } from "../../lib/reelTranscoder";
import { utc } from "../../lib/sqlTime";

// Reels (ADR-0021, REEL-1). O API só confere o conteúdo do contêiner (mp4Sniff), reserva a cota e enfileira; quem decodifica é o worker
// (ffprobe + ffmpeg). O original fica numa quarentena PRIVADA (quarantine/…, nunca servida) e é apagado ao fim do job, também no erro.

const MEDIA_CACHE = "public, max-age=31536000, immutable";
const KIND = "REEL_CONVERT";

export function reelError(code: ReelErrorCode): CodedError {
  const { status, message } = REEL_ERRORS[code];
  return new CodedError(status, code, message);
}

export type ReelActor = { storeId: string; userId: string | null };

type Clock = () => Date;

export class ReelsService {
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: ObjectStorage,
    private readonly transcoder: () => ReelTranscoder,
    private readonly clock: Clock = () => new Date(),
  ) {}

  view(reel: Reel): ReelView {
    const ready = reel.status === "READY" || reel.status === "PUBLISHED";
    return {
      id: reel.id,
      productId: reel.productId,
      status: reel.status,
      durationMs: reel.durationMs,
      width: reel.width,
      height: reel.height,
      bytes: reel.bytes,
      errorCode: reel.errorCode,
      errorMessage: reel.errorCode && reel.errorCode in REEL_ERRORS ? REEL_ERRORS[reel.errorCode as ReelErrorCode].message : null,
      videoUrl: ready ? this.storage.publicUrl(`${reel.keyBase}.mp4`) : null,
      posterUrl: ready ? this.storage.publicUrl(`${reel.keyBase}-poster.webp`) : null,
      createdAt: reel.createdAt.toISOString(),
      publishedAt: reel.publishedAt?.toISOString() ?? null,
    };
  }

  async list(storeId: string): Promise<ReelView[]> {
    const reels = await this.db.reel.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: 200 });
    return reels.map((reel) => this.view(reel));
  }

  async get(storeId: string, id: string): Promise<ReelView> {
    const reel = await this.db.reel.findFirst({ where: { id, storeId } });
    if (!reel) throw new CodedError(404, "REEL_NOT_FOUND", "Vídeo não encontrado.");
    return this.view(reel);
  }

  /**
   * Envio: confere o conteúdo, reserva cota e grava o original na quarentena. Nada é gravado em caso de recusa.
   * A cota é conferida AQUI (antes de aceitar) e de novo ao gravar o resultado (`finish`).
   */
  async upload(actor: ReelActor, productId: string, input: Buffer): Promise<ReelView> {
    if (input.length > REEL_LIMITS.maxUploadBytes) throw reelError("VIDEO_TOO_LARGE");
    const sniffed = sniffMp4(input);
    if (!sniffed.ok) throw reelError("VIDEO_FORMAT_INVALID");
    if (tooLong(sniffed.info.durationMs)) throw reelError("VIDEO_TOO_LONG");

    // Produto da PRÓPRIA loja (id + storeId): outra loja é "não encontrado", sem dizer que existe.
    const product = await this.db.product.findFirst({ where: { id: productId, storeId: actor.storeId }, select: { id: true } });
    if (!product) throw new CodedError(404, "PRODUCT_NOT_FOUND", "Produto não encontrado.");

    const uuid = randomUUID();
    const keyBase = `${storeKeyPrefix(actor.storeId)}reels/${uuid}`;
    const originalKey = quarantineKey(actor.storeId, uuid);
    const reel = await this.reserve(actor, productId, keyBase, originalKey, input.length, sniffed.info);

    try {
      await this.storage.put(originalKey, input, { contentType: "application/octet-stream", cacheControl: "private, no-store" });
    } catch {
      await this.db.reel.deleteMany({ where: { id: reel.id, storeId: actor.storeId } });
      throw new CodedError(502, "STORAGE_UNAVAILABLE", "Não foi possível guardar o vídeo agora. Tente de novo.");
    }
    // O job só nasce DEPOIS do original gravado: o worker nunca encontra a quarentena vazia.
    await this.db.mediaJob.create({ data: { kind: KIND, storeId: actor.storeId, reelId: reel.id } });
    return this.view(reel);
  }

  /** Cota SEM corrida: lock advisory por loja na transação que confere contagem e espaço e cria a linha. */
  private async reserve(actor: ReelActor, productId: string, keyBase: string, originalKey: string, originalBytes: number, info: { durationMs: number; width: number; height: number }) {
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"reel-quota:" + actor.storeId}))`;
        const active = await tx.reel.findMany({ where: { storeId: actor.storeId, status: { in: ["PROCESSING", "READY", "PUBLISHED"] } }, select: { productId: true, status: true, bytes: true } });
        if (active.some((r) => r.productId === productId)) throw new CodedError(409, "REEL_ALREADY_EXISTS", "Este produto já tem um vídeo. Remova-o para enviar outro.");
        if (active.length >= REEL_LIMITS.maxActivePerStore) throw reelError("VIDEO_LIMIT_REACHED");
        if (usedBytes(active) + REEL_LIMITS.processingReserveBytes > REEL_LIMITS.maxBytesPerStore) throw reelError("VIDEO_STORAGE_FULL");
        return tx.reel.create({
          data: { storeId: actor.storeId, productId, keyBase, originalKey, originalBytes, uploadedById: actor.userId, durationMs: info.durationMs, width: info.width, height: info.height },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CodedError(409, "REEL_ALREADY_EXISTS", "Este produto já tem um vídeo. Remova-o para enviar outro.");
      throw error;
    }
  }

  // ── Worker ─────────────────────────────────────────────────────────────────────────────────────

  /**
   * Pega UM job: pendente, ou RUNNING com lease vencido (worker morreu). Uma conversão por vez no servidor e uma por loja:
   * nada é pego se outro job tem lease válido. SKIP LOCKED + lease; devolve null quando não há o que fazer.
   */
  async claimJob(now: Date = this.clock()): Promise<{ id: string; storeId: string; reelId: string; exhausted?: boolean } | null> {
    const leaseUntil = new Date(now.getTime() + REEL_LIMITS.leaseMs);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('reel-claim'))`;
      const busy = await tx.$queryRaw<{ n: bigint }[]>`SELECT count(*)::bigint AS n FROM "MediaJob" WHERE "kind" = ${KIND} AND "status" = 'RUNNING' AND "lockedUntil" > ${utc(now)}`;
      if (Number(busy[0]?.n ?? 0) > 0) return null;
      const rows = await tx.$queryRaw<{ id: string; storeId: string; reelId: string; attempts: number }[]>`
        SELECT "id", "storeId", "reelId", "attempts" FROM "MediaJob"
         WHERE "kind" = ${KIND}
           AND (("status" = 'PENDING' AND "availableAt" <= ${utc(now)}) OR ("status" = 'RUNNING' AND "lockedUntil" <= ${utc(now)}))
         ORDER BY "availableAt", "id" LIMIT 1 FOR UPDATE SKIP LOCKED`;
      const job = rows[0];
      if (!job) return null;
      if (job.attempts >= REEL_LIMITS.maxAttempts) {
        // lease vencido demais vezes: desiste (o original é apagado no `fail`)
        await tx.mediaJob.update({ where: { id: job.id }, data: { status: "FAILED", lastError: "tentativas esgotadas", lockedUntil: null } });
        return { id: job.id, storeId: job.storeId, reelId: job.reelId, exhausted: true };
      }
      await tx.mediaJob.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: { increment: 1 }, lockedUntil: leaseUntil } });
      return { id: job.id, storeId: job.storeId, reelId: job.reelId };
    });
  }

  /** Processa o próximo job; `false` se não havia nenhum. Nunca lança por causa do vídeo (o vídeo vira FAILED). */
  async runNext(now: Date = this.clock()): Promise<boolean> {
    const job = await this.claimJob(now);
    if (!job) return false;
    const reel = await this.db.reel.findFirst({ where: { id: job.reelId, storeId: job.storeId } });
    if (job.exhausted) {
      if (reel) await this.fail(reel, "VIDEO_PROCESSING_FAILED");
      return true;
    }
    if (!reel || reel.status !== "PROCESSING") {
      // apagado ou removido enquanto esperava: nada a converter
      if (reel) await this.deleteOriginal(reel);
      await this.db.mediaJob.updateMany({ where: { id: job.id }, data: { status: "DONE", lockedUntil: null } });
      return true;
    }
    try {
      const original = await this.storage.get(reel.originalKey ?? "");
      const result = await this.transcoder().transcode(original);
      await this.finish(reel, job.id, result);
    } catch (error) {
      const code: ReelErrorCode = error instanceof ReelRejectedError ? error.code : error instanceof CodedError && error.code && error.code in REEL_ERRORS ? (error.code as ReelErrorCode) : "VIDEO_PROCESSING_FAILED";
      await this.fail(reel, code, error instanceof Error ? error.message : String(error), job.id);
    } finally {
      // Nightingale (a): o original sai SEMPRE (sucesso, rejeição ou erro). Falha ao apagar é registrada e o varredor tenta de novo.
      await this.deleteOriginal(reel);
    }
    return true;
  }

  private async finish(reel: Reel, jobId: string, result: { mp4: Buffer; poster: Buffer; durationMs: number; width: number; height: number }): Promise<void> {
    const bytes = result.mp4.length + result.poster.length;
    const videoKey = `${reel.keyBase}.mp4`;
    const posterKey = `${reel.keyBase}-poster.webp`;
    // 2ª conferência da cota, sob o mesmo lock do envio: dois uploads simultâneos da mesma loja nunca passam do teto.
    await this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"reel-quota:" + reel.storeId}))`;
      const others = await tx.reel.findMany({ where: { storeId: reel.storeId, id: { not: reel.id }, status: { in: ["PROCESSING", "READY", "PUBLISHED"] } }, select: { status: true, bytes: true } });
      if (usedBytes(others) + bytes > REEL_LIMITS.maxBytesPerStore) throw reelError("VIDEO_STORAGE_FULL");
      // Marca antes de gravar: se a gravação falhar, o job inteiro falha e nada fica publicado.
      await tx.reel.update({ where: { id: reel.id }, data: { bytes, durationMs: result.durationMs, width: result.width, height: result.height } });
    });
    try {
      await this.storage.put(videoKey, result.mp4, { contentType: "video/mp4", cacheControl: MEDIA_CACHE });
      await this.storage.put(posterKey, result.poster, { contentType: "image/webp", cacheControl: MEDIA_CACHE });
      await this.db.$transaction([
        this.db.reel.updateMany({ where: { id: reel.id, storeId: reel.storeId, status: "PROCESSING" }, data: { status: "READY", errorCode: null } }),
        this.db.mediaJob.updateMany({ where: { id: jobId }, data: { status: "DONE", lockedUntil: null, lastError: null } }),
      ]);
    } catch (error) {
      await this.storage.delete(videoKey).catch(() => undefined);
      await this.storage.delete(posterKey).catch(() => undefined);
      throw error;
    }
  }

  private async fail(reel: Reel, code: ReelErrorCode, detail?: string, jobId?: string): Promise<void> {
    await this.db.reel.updateMany({ where: { id: reel.id, storeId: reel.storeId, status: "PROCESSING" }, data: { status: "FAILED", errorCode: code, bytes: 0 } });
    const data = { status: "FAILED" as const, lockedUntil: null, lastError: (detail ?? code).slice(0, 300) };
    if (jobId) await this.db.mediaJob.updateMany({ where: { id: jobId }, data });
    else await this.db.mediaJob.updateMany({ where: { reelId: reel.id, status: { in: ["PENDING", "RUNNING"] } }, data });
    await this.deleteOriginal(reel);
  }

  /** Apaga o original da quarentena. Idempotente; se o storage falhar, `originalKey` fica gravado e o varredor repete (e conta). */
  async deleteOriginal(reel: Pick<Reel, "id" | "storeId" | "originalKey">): Promise<boolean> {
    if (!reel.originalKey) return true;
    try {
      await this.storage.delete(reel.originalKey);
      await this.db.reel.updateMany({ where: { id: reel.id, storeId: reel.storeId }, data: { originalKey: null } });
      return true;
    } catch (error) {
      await this.db.mediaJob.updateMany({ where: { reelId: reel.id }, data: { lastError: `falha ao apagar o original: ${String(error).slice(0, 200)}` } }).catch(() => undefined);
      return false;
    }
  }

  // ── Varredor ───────────────────────────────────────────────────────────────────────────────────

  /**
   * (1) Original órfão da quarentena (vídeo já pronto/falho, ou job morto há mais de 1 h): apaga e CONTA.
   * (2) Vídeo cujo produto foi apagado: remove arquivos e registro (≤ 24 h pelo intervalo do job).
   * (3) PROCESSING velho sem job vivo (queda entre gravar e enfileirar): vira FAILED.
   */
  async sweep(now: Date = this.clock(), limit = 100): Promise<{ originalsDeleted: number; originalsFailed: number; orphanProductReels: number; stalled: number }> {
    const cutoff = new Date(now.getTime() - REEL_LIMITS.orphanOriginalMs);
    let stalled = 0;
    const live = await this.db.reel.findMany({ where: { status: "PROCESSING", createdAt: { lt: cutoff } }, take: limit });
    for (const reel of live) {
      const alive = await this.db.mediaJob.count({ where: { reelId: reel.id, status: { in: ["PENDING", "RUNNING"] }, OR: [{ status: "PENDING" }, { lockedUntil: { gt: now } }] } });
      if (alive === 0 || reel.createdAt < new Date(now.getTime() - 24 * 3_600_000)) {
        await this.fail(reel, "VIDEO_PROCESSING_FAILED", "job sem andamento");
        stalled += 1;
      }
    }

    const leftovers = await this.db.reel.findMany({
      where: { originalKey: { not: null }, OR: [{ status: { not: "PROCESSING" } }, { createdAt: { lt: cutoff }, status: "PROCESSING" }] },
      take: limit,
    });
    let originalsDeleted = 0;
    let originalsFailed = 0;
    for (const reel of leftovers) {
      if (reel.status === "PROCESSING") {
        const running = await this.db.mediaJob.count({ where: { reelId: reel.id, status: "RUNNING", lockedUntil: { gt: now } } });
        if (running > 0) continue; // ainda convertendo de verdade
      }
      if (await this.deleteOriginal(reel)) originalsDeleted += 1;
      else originalsFailed += 1;
    }

    const orphans = await this.db.$queryRaw<{ id: string; storeId: string }[]>`
      SELECT r."id", r."storeId" FROM "Reel" r
       WHERE r."productId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = r."productId" AND p."storeId" = r."storeId")
       LIMIT ${limit}`;
    let orphanProductReels = 0;
    for (const { id, storeId } of orphans) {
      if (await this.removeFiles(storeId, id)) orphanProductReels += 1;
    }
    return { originalsDeleted, originalsFailed, orphanProductReels, stalled };
  }

  /** Apaga vídeo, capa e original e o registro (idempotente). Só mexe em linha da loja informada. */
  async removeFiles(storeId: string, reelId: string): Promise<boolean> {
    const reel = await this.db.reel.findFirst({ where: { id: reelId, storeId } });
    if (!reel) return true;
    if (!reel.keyBase.startsWith(storeKeyPrefix(storeId))) throw new CodedError(400, "KEY_OUTSIDE_STORE", "chave fora do prefixo da loja");
    try {
      await this.storage.delete(`${reel.keyBase}.mp4`);
      await this.storage.delete(`${reel.keyBase}-poster.webp`);
      if (reel.originalKey) await this.storage.delete(reel.originalKey);
    } catch {
      return false; // o varredor repete no próximo tick; o registro fica para não perder a chave
    }
    await this.db.reel.deleteMany({ where: { id: reel.id, storeId } });
    return true;
  }
}

/** Espaço usado: bytes reais dos prontos + reserva dos que ainda estão processando. */
function usedBytes(reels: { status: string; bytes: number }[]): number {
  return reels.reduce((sum, r) => sum + (r.status === "PROCESSING" ? Math.max(REEL_LIMITS.processingReserveBytes, r.bytes) : r.bytes), 0);
}
