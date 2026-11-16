import type { HttpClient } from "../../http/HttpClient";
import type { DeviceTokensGateway } from "../DeviceTokensGateway";
import type { DeviceToken } from "../../domain/deviceTokens";

export class HttpDeviceTokensGateway implements DeviceTokensGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ tokens: DeviceToken[] }>("/api/device-tokens");
  }

  create(label?: string) {
    return this.http.post<{ token: DeviceToken }>("/api/device-tokens", { label: label || undefined });
  }

  revoke(id: string) {
    return this.http.post(`/api/device-tokens/${id}/revoke`);
  }
}
