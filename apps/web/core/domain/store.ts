export type StoreSettings = {
  id: string;
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
  name: string;
  logoUrl: string;
  coverImageUrl: string;
  primaryColor: string;
  customDomain: string;
  address: string;
  whatsapp: string;
  openingHours: string;
  minOrderCents?: number;
  deliveryFeeCents: number;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
};
