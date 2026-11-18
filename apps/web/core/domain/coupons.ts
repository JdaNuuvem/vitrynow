export type DiscountType = "PERCENT" | "FIXED";

export type Coupon = {
  id: string;
  code: string;
  discountType: DiscountType;
  discountValue: number;
  active: boolean;
  maxUses: number | null;
  usedCount: number;
  minOrderCents: number | null;
  expiresAt: string | null;
};

export type NewCouponInput = {
  code: string;
  discountType: DiscountType;
  discountValue: number;
  maxUses?: number;
  minOrderCents?: number;
};
