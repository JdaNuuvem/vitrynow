import type { DeviceToken, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

// O que o painel pode ver de uma chave: nunca o token nem o hash (NG-06).
export type DeviceTokenView = Omit<DeviceToken, "tokenHash">;

const viewSelect = {
  id: true,
  storeId: true,
  tokenPreview: true,
  label: true,
  revokedAt: true,
  lastSeenAt: true,
  createdAt: true,
} as const;

export interface DeviceTokensRepository {
  list(storeId: string): Promise<DeviceTokenView[]>;
  find(storeId: string, id: string): Promise<DeviceTokenView | null>;
  create(data: { storeId: string; tokenHash: string; tokenPreview: string; label?: string }): Promise<DeviceTokenView>;
  revoke(id: string, at: Date): Promise<void>;
}

export class PrismaDeviceTokensRepository implements DeviceTokensRepository {
  constructor(private readonly db: Db) {}

  list(storeId: string) {
    return this.db.deviceToken.findMany({ where: { storeId }, orderBy: { createdAt: "desc" }, select: viewSelect });
  }

  find(storeId: string, id: string) {
    return this.db.deviceToken.findFirst({ where: { id, storeId }, select: viewSelect });
  }

  create(data: { storeId: string; tokenHash: string; tokenPreview: string; label?: string }) {
    return this.db.deviceToken.create({ data, select: viewSelect });
  }

  async revoke(id: string, at: Date) {
    await this.db.deviceToken.update({ where: { id }, data: { revokedAt: at } });
  }
}
