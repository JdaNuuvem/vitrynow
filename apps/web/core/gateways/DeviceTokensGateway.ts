import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { DeviceToken } from "../domain/deviceTokens";

export interface DeviceTokensGateway {
  list(): Promise<HttpResult<{ tokens: DeviceToken[] }>>;
  create(label?: string, options?: RequestOptions): Promise<HttpResult<{ token: DeviceToken }>>;
  revoke(id: string, options?: RequestOptions): Promise<HttpResult<unknown>>;
}
