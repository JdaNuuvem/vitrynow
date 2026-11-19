export type CashMovementType = "SUPRIMENTO" | "SANGRIA";

export type CashMovement = {
  id: string;
  type: CashMovementType;
  amountCents: number;
  notes: string | null;
  reason?: string | null;
  reasonText?: string | null;
  createdByRole?: "OWNER" | "STAFF" | null;
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
  staffWithdrawalLimitCents?: number;
  ruleChangeNotice?: { id: string; text: string } | null;
};

export type CashClosingPreview = {
  sessionId: string;
  expectedCents: number;
  countedCents: number;
  differenceCents: number;
  toleranceCents: number;
  reasonRequired: boolean;
};

export type CashCloseInput = {
  closingBalanceCents: number;
  sessionId?: string;
  expectedBalanceCents?: number;
  reason?: string;
  reasonText?: string;
  notes?: string;
};

export type CashMovementInput = {
  type: CashMovementType;
  amountCents: number;
  reason: string;
  reasonText?: string;
  notes?: string;
};

export type CashClosedSession = {
  id: string;
  openingBalanceCents: number;
  openedAt: string;
  closedAt: string;
  closedByRole: "OWNER" | "STAFF" | null;
  closingBalanceCents?: number | null;
  expectedClosingCents?: number | string | null;
  differenceCents?: number | string | null;
  closeReason?: string | null;
  closeReasonText?: string | null;
  movements?: CashMovement[];
};

export type CashSessionDetail = { session: CashClosedSession; summary: CashSummary | null };
export type CashClosingResult = CashSessionDetail & { differenceCents: number; toleranceCents: number };
