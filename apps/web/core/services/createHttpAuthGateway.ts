import { FetchHttpClient } from "../http/FetchHttpClient";
import type { HttpClient } from "../http/HttpClient";
import { HttpAuthGateway } from "../gateways/http/HttpAuthGateway";
import type { AuthGateway } from "../gateways/AuthGateway";

export function createHttpAuthGateway(http: HttpClient = new FetchHttpClient()): AuthGateway {
  return new HttpAuthGateway(http);
}
