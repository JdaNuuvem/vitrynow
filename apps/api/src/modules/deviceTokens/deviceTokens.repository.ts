import type { DeviceToken, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

export interface DeviceTokensRepository {
  list(storeId: string): Promise<DeviceToken[]>;
  find(storeId: string, id: string): Promise<DeviceToken | null>;
  create(data: { storeId: string; token: string; label?: string }): Promise<DeviceToken>;
  revoke(id: string, at: Date): Promise<void>;
}

export class PrismaDeviceTokensRepository implements DeviceTokensRepository {
  constructor(private readonly db: Db) {}

  list(storeId: string) {
    return this.db.deviceToken.findMany({ where: { storeId }, orderBy: { createdAt: "desc" } });
  }

  find(storeId: string, id: string) {
    return this.db.deviceToken.findFirst({ where: { id, storeId } });
  }

  create(data: { storeId: string; token: string; label?: string }) {
    return this.db.deviceToken.create({ data });
  }

  async revoke(id: string, at: Date) {
    await this.db.deviceToken.update({ where: { id }, data: { revokedAt: at } });
  }
}
