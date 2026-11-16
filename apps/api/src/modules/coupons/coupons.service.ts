import type { CreateCouponInput, UpdateCouponInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { ConflictError, NotFoundError } from "../../shared/errors";
import type { CouponsRepository } from "./coupons.repository";

// Regras de cupons do painel. A validação de uso no pedido fica no storefront.
export class CouponsService {
  constructor(
    private readonly repo: CouponsRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(storeId: string) {
    return this.repo.list(storeId);
  }

  async create(storeId: string, input: CreateCouponInput) {
    if (await this.repo.findByCode(storeId, input.code)) {
      throw new ConflictError("já existe um cupom com este código");
    }
    const { expiresAt, ...rest } = input;
    return this.repo.create(storeId, { ...rest, expiresAt: expiresAt ? new Date(expiresAt) : undefined });
  }

  async update(storeId: string, id: string, input: UpdateCouponInput) {
    await this.require(storeId, id);
    const { expiresAt, ...rest } = input;
    return this.repo.update(id, { ...rest, expiresAt: expiresAt ? new Date(expiresAt) : undefined });
  }

  async delete(actor: Actor, id: string) {
    const coupon = await this.require(actor.storeId, id);
    await this.repo.delete(id);
    this.audit.log({ ...actor, action: "coupon.delete", targetType: "Coupon", targetId: id, metadata: { code: coupon.code } });
  }

  private async require(storeId: string, id: string) {
    const coupon = await this.repo.find(storeId, id);
    if (!coupon) throw new NotFoundError("cupom não encontrado");
    return coupon;
  }
}
