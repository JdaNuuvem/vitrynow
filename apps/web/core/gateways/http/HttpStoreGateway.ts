import type { HttpClient, HttpResult } from "../../http/HttpClient";
import type { StoreGateway } from "../StoreGateway";
import type { StoreSettings, StoreSettingsInput } from "../../domain/store";

export class HttpStoreGateway implements StoreGateway {
  constructor(private readonly http: HttpClient) {}

  async getSettings(): Promise<HttpResult<StoreSettings>> {
    const result = await this.http.get<{ store: StoreSettings }>("/api/store/settings");
    return result.ok ? { ok: true, data: result.data.store } : result;
  }

  updateSettings(input: StoreSettingsInput) {
    return this.http.post("/api/store/settings", input);
  }

  setAvailability(acceptingOrders: boolean) {
    return this.http.post("/api/store/availability", { acceptingOrders });
  }
}
