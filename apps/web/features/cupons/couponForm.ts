import type { DiscountType, NewCouponInput } from "@/core/domain/coupons";
import { digitsToCents } from "@/shared/format/money";

export type CouponDraft = {
  code: string;
  discountType: DiscountType;
  percentValue: string;
  fixedValue: string;
  maxUses: string;
  minOrder: string;
};

export function emptyCouponDraft(): CouponDraft {
  return { code: "", discountType: "PERCENT", percentValue: "10", fixedValue: "", maxUses: "", minOrder: "" };
}

// Percentual vai como inteiro (1-100); valor fixo vai em centavos.
export function toNewCouponInput(draft: CouponDraft): NewCouponInput {
  return {
    code: draft.code,
    discountType: draft.discountType,
    discountValue: draft.discountType === "PERCENT" ? parseInt(draft.percentValue, 10) || 0 : digitsToCents(draft.fixedValue),
    maxUses: draft.maxUses ? parseInt(draft.maxUses, 10) : undefined,
    minOrderCents: draft.minOrder ? digitsToCents(draft.minOrder) : undefined,
  };
}
