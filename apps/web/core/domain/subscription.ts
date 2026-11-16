export type SubscriptionState = "trial" | "active" | "canceled" | "past_due" | "expired";

export type Subscription = {
  state: SubscriptionState;
  planCode: string | null;
  planName: string | null;
  features: string[];
  trialEndsAt: string;
  currentPeriodEnd: string | null;
  daysLeft: number;
};

export type PlanOffer = {
  code: string;
  name: string;
  priceCents: number;
  features: string[];
};

export type PixCheckout = {
  id: string;
  amountCents: number;
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
  expiresAt: string | null;
};

export type CheckoutStatus = "PENDENTE" | "APROVADO" | "REJEITADO" | "EXPIRADO" | "REEMBOLSADO";
