import { FetchHttpClient } from "../http/FetchHttpClient";
import type { HttpClient } from "../http/HttpClient";
import { HttpStorefrontGateway } from "../gateways/http/HttpStorefrontGateway";
import type { StorefrontServices } from "./StorefrontServices";

export function createHttpStorefrontServices(http: HttpClient = new FetchHttpClient()): StorefrontServices {
  return { storefront: new HttpStorefrontGateway(http) };
}
