"use client";

import type { Coupon } from "@/core/domain/coupons";
import { formatCents } from "@/shared/format/money";
import { Switch } from "@/shared/ui/Switch";

function discountLabel(coupon: Coupon): string {
  return coupon.discountType === "PERCENT" ? `${coupon.discountValue}%` : formatCents(coupon.discountValue);
}

export function CouponRow({
  coupon,
  onSetActive,
  onDelete,
}: {
  coupon: Coupon;
  onSetActive: (coupon: Coupon, active: boolean) => void;
  onDelete: (coupon: Coupon) => void;
}) {
  return (
    <div className="cupons-row">
      <div>
        <strong className="cupons-row__code">{coupon.code}</strong> · {discountLabel(coupon)} · usado {coupon.usedCount}
        {coupon.maxUses ? `/${coupon.maxUses}` : ""}
        {!coupon.active && <span className="cupons-row__off">(inativo)</span>}
      </div>
      <div className="cupons-row__actions">
        <label>
          <Switch label={`Cupom ${coupon.code} ativo`} checked={coupon.active} onChange={(active) => onSetActive(coupon, active)} />
          Ativo
        </label>
        <button type="button" className="cupons__btn cupons__btn--danger" onClick={() => onDelete(coupon)}>
          excluir
        </button>
      </div>
    </div>
  );
}
