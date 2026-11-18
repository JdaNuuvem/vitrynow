import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@meucardapio/db";
import { BadRequestError, CodedError } from "../../shared/errors";
import { ImageRejectedError, processImage, type ImageKind } from "../../lib/imagePipeline";
import { storeKeyPrefix, type ObjectStorage } from "../../lib/objectStorage";

// API-18 / ADR-0010: upload de imagem pela API. Toda chave nasce de um uuid gerado aqui, sob stores/<storeId>/;
// o nome e o Content-Type enviados nunca entram na chave nem na decisão de tipo.

export const MAX_IMAGES_PER_STORE = Number(process.env.MEDIA_MAX_IMAGES_PER_STORE ?? 500); // cota por loja (valor final: plano, ADR-0003)
export const QUARANTINE_MAX_AGE_MS = 15 * 60 * 1000; // PENDING mais velha que isto é sobra de upload interrompido
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export type ImageView = { id: string; kind: ImageKind; url: string; variants: { width: number; url: string }[] };

export class MediaService {
  constructor(
    private readonly db: PrismaClient,
    private readonly storage: ObjectStorage,
  ) {}

  private view(image: { id: string; kind: ImageKind; keyBase: string; widths: number[] }): ImageView {
    const variants = image.widths.map((width) => ({ width, url: this.storage.publicUrl(`${image.keyBase}-${width}.webp`) }));
    return { id: image.id, kind: image.kind, url: variants[variants.length - 1].url, variants };
  }

  async upload(storeId: string, kind: ImageKind, input: Buffer): Promise<ImageView> {
    await this.sweepStale(storeId); // limpeza oportunista da quarentena desta loja

    const used = await this.db.image.count({ where: { storeId } });
    if (used >= MAX_IMAGES_PER_STORE) throw new CodedError(409, "IMAGE_QUOTA_EXCEEDED", "Limite de imagens da loja atingido. Remova imagens que não usa mais.");

    let variants;
    try {
      variants = await processImage(input, kind); // valida antes de qualquer coisa chegar ao storage
    } catch (e) {
      if (e instanceof ImageRejectedError) throw new CodedError(e.code === "UNSUPPORTED_TYPE" ? 415 : 422, e.code, e.message);
      throw e;
    }

    const keyBase = `${storeKeyPrefix(storeId)}${randomUUID()}`;
    const widths = variants.map((v) => v.width);
    // Quarentena: a linha PENDING existe antes dos objetos; só vira READY (visível/usável) com todos gravados.
    const image = await this.db.image.create({
      data: { storeId, kind, keyBase, widths, bytes: variants.reduce((s, v) => s + v.body.length, 0), status: "PENDING" },
    });
    try {
      for (const v of variants) {
        await this.storage.put(`${keyBase}-${v.width}.webp`, v.body, { contentType: "image/webp", cacheControl: CACHE_CONTROL });
      }
    } catch {
      await this.removeObjects(image).catch(() => undefined);
      await this.db.image.deleteMany({ where: { id: image.id, storeId } });
      throw new CodedError(502, "STORAGE_UNAVAILABLE", "Não foi possível guardar a imagem agora. Tente de novo.");
    }
    const ready = await this.db.image.update({ where: { id: image.id }, data: { status: "READY" } });
    return this.view(ready);
  }

  /** Remove só imagens READY da PRÓPRIA loja (a busca é por id + storeId; nunca por padrão de nome). */
  async remove(storeId: string, imageId: string): Promise<void> {
    const image = await this.db.image.findFirst({ where: { id: imageId, storeId } });
    if (!image) throw new CodedError(404, "IMAGE_NOT_FOUND", "Imagem não encontrada.");
    await this.removeObjects(image);
    await this.db.image.deleteMany({ where: { id: image.id, storeId } });
  }

  /** Varre PENDING antiga (upload interrompido). Sem `storeId` varre todas as lojas (uso do job de limpeza, ADR-0011). */
  async sweepStale(storeId?: string, now = new Date()): Promise<number> {
    const stale = await this.db.image.findMany({
      where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - QUARANTINE_MAX_AGE_MS) }, ...(storeId ? { storeId } : {}) },
      take: 100,
    });
    for (const image of stale) {
      await this.removeObjects(image).catch(() => undefined);
      await this.db.image.deleteMany({ where: { id: image.id, storeId: image.storeId, status: "PENDING" } });
    }
    return stale.length;
  }

  private async removeObjects(image: { storeId: string; keyBase: string; widths: number[] }): Promise<void> {
    if (!image.keyBase.startsWith(storeKeyPrefix(image.storeId))) throw new BadRequestError("chave fora do prefixo da loja");
    for (const width of image.widths) {
      await this.storage.delete(`${image.keyBase}-${width}.webp`);
    }
  }
}
