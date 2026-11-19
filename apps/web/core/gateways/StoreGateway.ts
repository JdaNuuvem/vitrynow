import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { StoreSettings, StoreSettingsInput } from "../domain/store";

export type StorePaymentSettings = {
  mercadopago: {
    status: "NOT_CONNECTED" | "CONNECTED" | "NEEDS_RECONNECT" | "DISCONNECTED";
    sellerMasked: string | null;
    connectedAt: string | null;
    expiresAt: string | null;
  };
  pixAvailable: boolean;
  pending: { pixPending: number; refundPending: number };
};

export interface StoreGateway {
  getSettings(): Promise<HttpResult<StoreSettings>>;
  updateSettings(input: StoreSettingsInput): Promise<HttpResult<StoreSettings>>;
  setAvailability(acceptingOrders: boolean): Promise<HttpResult<unknown>>;
  payments(): Promise<HttpResult<StorePaymentSettings>>;
  connectPayment(options?: RequestOptions): Promise<HttpResult<{ authorizationUrl: string }>>;
  disconnectPayment(options?: RequestOptions): Promise<HttpResult<unknown>>;
}
