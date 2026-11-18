import type { HttpResult } from "../http/HttpClient";
import type { StoreSettings, StoreSettingsInput } from "../domain/store";

export interface StoreGateway {
  getSettings(): Promise<HttpResult<StoreSettings>>;
  updateSettings(input: StoreSettingsInput): Promise<HttpResult<unknown>>;
  setAvailability(acceptingOrders: boolean): Promise<HttpResult<unknown>>;
}
