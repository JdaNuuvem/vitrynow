import type { Deliverer, Order, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

export type DelivererData = { name?: string; phone?: string; active?: boolean };

export interface DeliverersRepository {
  list(storeId: string): Promise<Deliverer[]>;
  find(storeId: string, id: string): Promise<Deliverer | null>;
  create(storeId: string, data: DelivererData & { name: string }): Promise<Deliverer>;
  update(id: string, data: DelivererData): Promise<Deliverer>;
  countOngoingDeliveries(delivererId: string): Promise<number>;
  delete(id: string): Promise<void>;

  findOrder(storeId: string, orderId: string): Promise<Order | null>;
  setOrderDeliverer(orderId: string, delivererId: string | null): Promise<void>;
}

export class PrismaDeliverersRepository implements DeliverersRepository {
  constructor(private readonly db: Db) {}

  list(storeId: string) {
    return this.db.deliverer.findMany({ where: { storeId }, orderBy: { name: "asc" } });
  }

  find(storeId: string, id: string) {
    return this.db.deliverer.findFirst({ where: { id, storeId } });
  }

  create(storeId: string, data: DelivererData & { name: string }) {
    return this.db.deliverer.create({ data: { storeId, ...data } });
  }

  update(id: string, data: DelivererData) {
    return this.db.deliverer.update({ where: { id }, data });
  }

  countOngoingDeliveries(delivererId: string) {
    return this.db.order.count({ where: { delivererId, status: { notIn: ["CONCLUIDO", "CANCELADO"] } } });
  }

  async delete(id: string) {
    await this.db.deliverer.delete({ where: { id } });
  }

  findOrder(storeId: string, orderId: string) {
    return this.db.order.findFirst({ where: { id: orderId, storeId } });
  }

  async setOrderDeliverer(orderId: string, delivererId: string | null) {
    await this.db.order.update({ where: { id: orderId }, data: { delivererId } });
  }
}
