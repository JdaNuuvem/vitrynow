export type CashMovementType = "SUPRIMENTO" | "SANGRIA";

export type CashMovement = {
  id: string;
  type: CashMovementType;
  amountCents: number;
  notes: string | null;
  createdAt: string;
};

export type CashSession = {
  id: string;
  openedAt: string;
  openingBalanceCents: number;
  openingNotes?: string | null;
  movements: CashMovement[];
};

export type PaymentBucket = "DINHEIRO" | "PIX" | "CREDITO" | "DEBITO" | "VR" | "VA" | "NAO_IDENTIFICADO";

type Tally = { count: number; revenueCents: number };

export type CashSummary = {
  openingCents: number;
  cashSalesCents: number;
  entriesCents: number;
  exitsCents: number;
  expectedCents: number;
  sales: {
    byType: Record<"MESA" | "DELIVERY" | "BALCAO", Tally>;
    count: number;
    revenueCents: number;
    deliveryFeeCents: number;
    tipCents: number;
    canceledCount: number;
    canceledCents: number;
  };
  byPaymentMethod: Partial<Record<PaymentBucket, Tally>>;
};

export type CashierState = {
  session: CashSession | null;
  summary?: CashSummary;
  expectedBalanceCents: number;
  stale: boolean;
};
