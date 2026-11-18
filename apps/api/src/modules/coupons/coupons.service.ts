import type { CreateCouponInput, UpdateCouponInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { CodedError, NotFoundError } from "../../shared/errors";
import { endOfStoreDay, isBeforeToday } from "../../lib/storeDay";
import type { CouponsRepository } from "./coupons.repository";

type CouponActor = Actor & { role: "OWNER" | "STAFF" };

// Cupom caro é comida de graça sem controle: o STAFF só cria/edita cupom DENTRO do teto (até 50% ou R$ 50,00) e sempre COM limite
// de usos; acima disso, e para excluir qualquer cupom, só o dono. O teto fica aqui, num lugar só (Atlas/Nightingale, 17/11).
export const STAFF_MAX_PERCENT = 50;
export const STAFF_MAX_FIXED_CENTS = 5000;
export const STAFF_MAX_USES = 500;
type CouponShape = { discountType: string; discountValue: number; maxUses?: number | null };
const withinStaffCap = (c: CouponShape) =>
  !!c.maxUses && c.maxUses <= STAFF_MAX_USES && (c.discountType === "PERCENT" ? c.discountValue <= STAFF_MAX_PERCENT : c.discountValue <= STAFF_MAX_FIXED_CENTS);
function ownerOnly(actor: CouponActor) {
  if (actor.role !== "OWNER") throw new CodedError(403, "FORBIDDEN_ROLE", "Só o dono pode fazer isso.");
}
// STAFF: o cupom FINAL e o que já existe (na edição) precisam caber no teto; senão 403.
function assertStaffCap(actor: CouponActor, ...shapes: CouponShape[]) {
  if (actor.role === "OWNER") return;
  if (!shapes.every(withinStaffCap)) throw new CodedError(403, "FORBIDDEN_ROLE", "Acima do seu limite. Peça ao dono.");
}

// "Vale até" = fim do dia escolhido no fuso da loja (hoje vale). Só dia anterior a hoje é recusado.
function resolveExpiry(value: string): Date {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? endOfStoreDay(value) : new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value) ? isBeforeToday(value) : date.getTime() <= Date.now()) {
    throw new CodedError(400, "COUPON_EXPIRY_INVALID", "A validade precisa ser hoje ou uma data futura.");
  }
  return date;
}

// Regras do cadastro (RN-CP-05..07), sobre o conjunto FINAL do cupom (na edição, o que já existe + o que mudou):
// percentual de 1 a 100; cupom de 100% exige limite de usos (senão é comida de graça sem controle).
function assertCouponRules(c: { discountType: string; discountValue: number; maxUses: number | null | undefined }) {
  if (c.discountType === "PERCENT") {
    if (c.discountValue < 1 || c.discountValue > 100) throw new CodedError(400, "COUPON_VALUE_INVALID", "O percentual vai de 1 a 100.");
    if (c.discountValue === 100 && !c.maxUses) throw new CodedError(400, "COUPON_NEEDS_LIMIT", "Cupom de 100% precisa de limite de usos.");
  }
}

// Regras de cupons do painel. A validação de uso no pedido fica no storefront.
export class CouponsService {
  constructor(
    private readonly repo: CouponsRepository,
    private readonly audit: AuditLogger,
  ) {}

  list(storeId: string) {
    return this.repo.list(storeId);
  }

  async create(actor: CouponActor, input: CreateCouponInput) {
    const { storeId } = actor;
    assertCouponRules({ discountType: input.discountType, discountValue: input.discountValue, maxUses: input.maxUses });
    assertStaffCap(actor, input);
    const expiresAt = input.expiresAt ? resolveExpiry(input.expiresAt) : undefined;
    if (await this.repo.findByCode(storeId, input.code)) throw codeTaken();
    const { expiresAt: _ignored, ...rest } = input;
    void _ignored;
    try {
      const created = await this.repo.create(storeId, { ...rest, expiresAt });
      this.auditChange(actor, "coupon.create", created);
      return created;
    } catch (error) {
      // Dois cadastros simultâneos do mesmo código: a unicidade (loja, código) do banco decide; o perdedor recebe o mesmo 409.
      if ((error as { code?: string }).code === "P2002") throw codeTaken();
      throw error;
    }
  }

  async update(actor: CouponActor, id: string, input: UpdateCouponInput) {
    const { storeId } = actor;
    const current = await this.require(storeId, id);
    // Parar um cupom perigoso reduz risco: o STAFF pode DESATIVAR qualquer cupom, mas só isso (`{ active: false }` sozinho).
    // Reativar, ou desativar junto com outra mudança, segue a regra do teto.
    const onlyDeactivate = Object.keys(input).length === 1 && input.active === false;
    if (onlyDeactivate && actor.role === "STAFF") {
      const stopped = await this.repo.update(id, { active: false });
      this.auditChange(actor, "coupon.update", stopped);
      return stopped;
    }
    const final = {
      discountType: input.discountType ?? current.discountType,
      discountValue: input.discountValue ?? current.discountValue,
      maxUses: input.maxUses ?? current.maxUses,
    };
    assertCouponRules(final);
    // Mexer em cupom acima do teto (o que já é ou o que vai virar), inclusive reativar ou "Definir limite", é do dono.
    assertStaffCap(actor, final, current);
    const expiresAt = input.expiresAt ? resolveExpiry(input.expiresAt) : undefined;
    if (input.code && input.code !== current.code && (await this.repo.findByCode(storeId, input.code))) throw codeTaken();
    const { expiresAt: _ignored, ...rest } = input;
    void _ignored;
    try {
      const updated = await this.repo.update(id, { ...rest, expiresAt });
      this.auditChange(actor, "coupon.update", updated);
      return updated;
    } catch (error) {
      if ((error as { code?: string }).code === "P2002") throw codeTaken();
      throw error;
    }
  }

  async delete(actor: CouponActor, id: string) {
    ownerOnly(actor); // excluir cupom: só o dono (mesma regra de excluir produto e categoria)
    const coupon = await this.require(actor.storeId, id);
    await this.repo.delete(id);
    this.audit.log({
      storeId: actor.storeId,
      userId: actor.userId,
      action: "coupon.delete",
      targetType: "Coupon",
      targetId: id,
      metadata: { code: coupon.code, discountType: coupon.discountType, discountValue: coupon.discountValue },
    });
  }

  // Auditoria do cadastro: código e valor, nunca dado de cliente.
  private auditChange(actor: CouponActor, action: string, c: { id: string; code: string; discountType: string; discountValue: number; maxUses: number | null; active: boolean }) {
    this.audit.log({
      storeId: actor.storeId,
      userId: actor.userId,
      action,
      targetType: "Coupon",
      targetId: c.id,
      metadata: { code: c.code, discountType: c.discountType, discountValue: c.discountValue, maxUses: c.maxUses, active: c.active },
    });
  }

  private async require(storeId: string, id: string) {
    const coupon = await this.repo.find(storeId, id);
    if (!coupon) throw new NotFoundError("cupom não encontrado");
    return coupon;
  }
}

function codeTaken() {
  return new CodedError(409, "COUPON_CODE_TAKEN", "Já existe um cupom com esse código.");
}
