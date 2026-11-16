import type { HttpResult } from "../http/HttpClient";
import type { DeviceToken } from "../domain/deviceTokens";

export interface DeviceTokensGateway {
  list(): Promise<HttpResult<{ tokens: DeviceToken[] }>>;
  create(label?: string): Promise<HttpResult<{ token: DeviceToken }>>;
  revoke(id: string): Promise<HttpResult<unknown>>;
}
