export type StoreSettings = {
  id: string;
  menuLayout?: "CLASSIC" | "REELS"; // modelo do cardápio público
  /** SSOT D1: fuso IANA da loja (ex.: America/Manaus). Toda data do painel usa este, nunca o do aparelho. */
  timezone?: string;
  name: string;
  slug: string;
  code: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  primaryColor: string | null;
  customDomain: string | null;
  address: string | null;
  whatsapp: string | null;
  openingHours: string | null;
  minOrderCents: number | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  acceptingOrders: boolean;
  hideSoldOutProducts?: boolean;
  deliveryFeeCents: number;
};

export type PlanState = "info" | "warning" | "expired" | "active";

export type PlanStatus = {
  trialEndsAt: string;
  daysLeft: number;
  state: PlanState;
};

// Payload de POST /api/store/settings: campos de texto vazios limpam o valor no servidor.
export type StoreSettingsInput = {
  menuLayout?: "CLASSIC" | "REELS";
  hideSoldOutProducts?: boolean;
  name?: string;
  logoUrl?: string;
  coverImageUrl?: string;
  primaryColor?: string;
  address?: string;
  whatsapp?: string;
  openingHours?: string;
  minOrderCents?: number;
  deliveryFeeCents?: number;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
};
