import type { AuditLog, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

export interface AuditLogReader {
  listRecent(storeId: string, limit: number): Promise<AuditLog[]>;
}

export class PrismaAuditLogReader implements AuditLogReader {
  constructor(private readonly db: Db) {}

  listRecent(storeId: string, limit: number) {
    return this.db.auditLog.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, take: limit });
  }
}
