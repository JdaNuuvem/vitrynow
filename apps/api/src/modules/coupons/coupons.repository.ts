import type { Coupon, CouponDiscountType, prisma as prismaClient } from "@meucardapio/db";

type Db = typeof prismaClient;

export type CouponData = {
  code?: string;
  discountType?: CouponDiscountType;
  discountValue?: number;
  active?: boolean;
  maxUses?: number;
  minOrderCents?: number;
  expiresAt?: Date;
};

export interface CouponsRepository {
  list(storeId: string): Promise<Coupon[]>;
  find(storeId: string, id: string): Promise<Coupon | null>;
  findByCode(storeId: string, code: string): Promise<Coupon | null>;
  create(storeId: string, data: CouponData & { code: string; discountType: CouponDiscountType; discountValue: number }): Promise<Coupon>;
  update(id: string, data: CouponData): Promise<Coupon>;
  delete(id: string): Promise<void>;
}

export class PrismaCouponsRepository implements CouponsRepository {
  constructor(private readonly db: Db) {}

  list(storeId: string) {
    return this.db.coupon.findMany({ where: { storeId }, orderBy: { createdAt: "desc" } });
  }

  find(storeId: string, id: string) {
    return this.db.coupon.findFirst({ where: { id, storeId } });
  }

  findByCode(storeId: string, code: string) {
    return this.db.coupon.findUnique({ where: { storeId_code: { storeId, code } } });
  }

  create(storeId: string, data: CouponData & { code: string; discountType: CouponDiscountType; discountValue: number }) {
    return this.db.coupon.create({ data: { storeId, ...data } });
  }

  update(id: string, data: CouponData) {
    return this.db.coupon.update({ where: { id }, data });
  }

  async delete(id: string) {
    // API-48: a FK composta (couponId, storeId) nao pode anular `storeId`; o pedido antigo perde o vinculo (como antes, SetNull) na mesma transacao da exclusao.
    await this.db.$transaction([this.db.order.updateMany({ where: { couponId: id }, data: { couponId: null } }), this.db.coupon.delete({ where: { id } })]);
  }
}
