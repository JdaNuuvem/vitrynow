import type { PrismaClient } from "@meucardapio/db";
import { normalizeName } from "../catalog/catalog.service";
import type { BatchRecord, ImportRepository } from "./catalogImport.service";

export class PrismaImportRepository implements ImportRepository {
  constructor(private readonly db: PrismaClient) {}

  private map(row: { id: string; storeId: string; status: string; contentHash: string; draft: unknown; result: unknown }): BatchRecord {
    return { id: row.id, storeId: row.storeId, status: row.status as BatchRecord["status"], contentHash: row.contentHash, draft: row.draft as BatchRecord["draft"], result: row.result };
  }

  async create(data: { storeId: string; userId: string; contentHash: string; draft: unknown }) {
    return this.map(await this.db.importBatch.create({ data: { storeId: data.storeId, userId: data.userId, contentHash: data.contentHash, draft: data.draft as never } }));
  }

  async find(storeId: string, id: string) {
    const row = await this.db.importBatch.findFirst({ where: { id, storeId } });
    return row ? this.map(row) : null;
  }

  countSince(storeId: string, since: Date) {
    return this.db.importBatch.count({ where: { storeId, createdAt: { gte: since } } });
  }

  async claim(storeId: string, id: string, to: "CONFIRMED" | "DISCARDED", result: unknown) {
    const done = await this.db.importBatch.updateMany({
      where: { id, storeId, status: "PREVIEW" },
      data: { status: to, finishedAt: new Date(), ...(result ? { result: result as never } : {}) },
    });
    return done.count === 1;
  }

  async reopen(storeId: string, id: string) {
    await this.db.importBatch.updateMany({ where: { id, storeId, status: "CONFIRMED" }, data: { status: "PREVIEW", finishedAt: null } });
  }

  async setResult(storeId: string, id: string, result: unknown) {
    await this.db.importBatch.updateMany({ where: { id, storeId }, data: { result: result as never } });
  }

  async existingProductKeys(storeId: string) {
    const products = await this.db.product.findMany({ where: { storeId }, select: { name: true, category: { select: { name: true } } } });
    return new Set(products.map((p) => `${normalizeName(p.category?.name ?? "")}|${normalizeName(p.name)}`));
  }

  countProducts(storeId: string) {
    return this.db.product.count({ where: { storeId } });
  }
}
