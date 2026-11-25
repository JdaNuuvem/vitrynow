import type { Coupon, DiscountType, NewCouponInput } from "@/core/domain/coupons";
import { digitsToCents, maskMoneyInput } from "@/shared/format/money";
import { storeDateInput } from "@/shared/format/storeTime";

export type CouponDraft = {
  code: string;
  discountType: DiscountType;
  percentValue: string;
  fixedValue: string;
  maxUses: string;
  minOrder: string;
  expiresAt: string;
};

export function emptyCouponDraft(): CouponDraft {
  return { code: "", discountType: "PERCENT", percentValue: "10", fixedValue: "", maxUses: "", minOrder: "", expiresAt: "" };
}

export function couponDraft(coupon?: Coupon, timeZone?: string): CouponDraft {
  if (!coupon) return emptyCouponDraft();
  const expiry = coupon.expiresAt ? new Date(coupon.expiresAt) : null;
  return {
    ...emptyCouponDraft(), code: coupon.code, discountType: coupon.discountType,
    percentValue: coupon.discountType === "PERCENT" ? String(coupon.discountValue) : "10",
    fixedValue: coupon.discountType === "FIXED" ? maskMoneyInput(String(coupon.discountValue)) : "",
    maxUses: coupon.maxUses === null ? "" : String(coupon.maxUses),
    minOrder: coupon.minOrderCents === null ? "" : maskMoneyInput(String(coupon.minOrderCents)),
    expiresAt: expiry ? storeDateInput(expiry, timeZone) : "",
  };
}

// Percentual vai como inteiro (1-100); valor fixo vai em centavos.
export function toNewCouponInput(draft: CouponDraft): NewCouponInput {
  return {
    code: draft.code,
    discountType: draft.discountType,
    discountValue: draft.discountType === "PERCENT" ? parseInt(draft.percentValue, 10) || 0 : digitsToCents(draft.fixedValue),
    maxUses: draft.maxUses ? parseInt(draft.maxUses, 10) : undefined,
    minOrderCents: draft.minOrder ? digitsToCents(draft.minOrder) : undefined,
    ...(draft.expiresAt ? { expiresAt: draft.expiresAt } : {}),
  };
}
