import type { HttpClient, HttpResult, RequestOptions } from "../../http/HttpClient";
import type { StoreGateway, StorePaymentSettings } from "../StoreGateway";
import type { StoreSettings, StoreSettingsInput } from "../../domain/store";

export class HttpStoreGateway implements StoreGateway {
  constructor(private readonly http: HttpClient) {}

  async getSettings(): Promise<HttpResult<StoreSettings>> {
    const result = await this.http.get<{ store: StoreSettings }>("/api/store/settings");
    return result.ok ? { ok: true, data: result.data.store } : result;
  }

  async updateSettings(input: StoreSettingsInput): Promise<HttpResult<StoreSettings>> {
    const result = await this.http.post<{ store: StoreSettings }>("/api/store/settings", input);
    return result.ok ? { ok: true, data: result.data.store } : result;
  }

  setAvailability(acceptingOrders: boolean) {
    return this.http.post("/api/store/availability", { acceptingOrders });
  }

  payments() {
    return this.http.get<StorePaymentSettings>("/api/store/payments");
  }

  connectPayment(options?: RequestOptions) {
    return this.http.post<{ authorizationUrl: string }>("/api/store/payments/mercadopago/connect", undefined, options);
  }

  disconnectPayment(options?: RequestOptions) {
    return this.http.post("/api/store/payments/mercadopago/disconnect", undefined, options);
  }
}
