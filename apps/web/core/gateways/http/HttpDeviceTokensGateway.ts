import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { DeviceTokensGateway } from "../DeviceTokensGateway";
import type { DeviceToken } from "../../domain/deviceTokens";

export class HttpDeviceTokensGateway implements DeviceTokensGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ tokens: DeviceToken[] }>("/api/device-tokens");
  }

  create(label?: string, options?: RequestOptions) {
    return this.http.post<{ token: DeviceToken }>("/api/device-tokens", { label: label || undefined }, options);
  }

  revoke(id: string, options?: RequestOptions) {
    return this.http.post(`/api/device-tokens/${id}/revoke`, undefined, options);
  }
}
