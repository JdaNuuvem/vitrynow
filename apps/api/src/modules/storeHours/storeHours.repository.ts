import { Prisma, type prisma as prismaClient } from "@meucardapio/db";
import type { Schedule } from "./storeHours.domain";
import type { StoreHoursRepository, StoreHoursRow } from "./storeHours.service";

type Db = typeof prismaClient;

const select = {
  id: true,
  timezone: true,
  acceptingOrders: true,
  schedule: true,
  pausedUntil: true,
  closedUntil: true,
  prepMinutesDelivery: true,
  prepMinutesPickup: true,
} as const;

export class PrismaStoreHoursRepository implements StoreHoursRepository {
  constructor(private readonly db: Db) {}

  find(storeId: string): Promise<StoreHoursRow | null> {
    return this.db.store.findUnique({ where: { id: storeId }, select });
  }

  findBySlug(slug: string): Promise<StoreHoursRow | null> {
    return this.db.store.findUnique({ where: { slug }, select });
  }

  async saveSchedule(storeId: string, schedule: Schedule | null) {
    await this.db.store.update({
      where: { id: storeId },
      data: { schedule: schedule === null ? Prisma.JsonNull : (schedule as unknown as Prisma.InputJsonValue) },
    });
  }

  async saveOverrides(storeId: string, data: { pausedUntil: Date | null; closedUntil: Date | null }) {
    await this.db.store.update({ where: { id: storeId }, data });
  }

  async savePrepTimes(storeId: string, data: { prepMinutesDelivery: number | null; prepMinutesPickup: number | null }) {
    await this.db.store.update({ where: { id: storeId }, data });
  }
}
