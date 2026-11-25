import { FetchHttpClient } from "../http/FetchHttpClient";
import type { HttpClient } from "../http/HttpClient";
import { HttpAuthGateway } from "../gateways/http/HttpAuthGateway";
import { HttpCashierGateway } from "../gateways/http/HttpCashierGateway";
import { HttpFeedbackGateway } from "../gateways/http/HttpFeedbackGateway";
import { HttpDeliverersGateway, HttpOrdersGateway } from "../gateways/http/HttpOrdersGateway";
import { HttpPlanGateway } from "../gateways/http/HttpPlanGateway";
import { HttpReportsGateway } from "../gateways/http/HttpReportsGateway";
import { HttpStoreGateway } from "../gateways/http/HttpStoreGateway";
import { WebSocketRealtimeGateway } from "../gateways/http/WebSocketRealtimeGateway";
import { HttpAuditGateway } from "../gateways/http/HttpAuditGateway";
import { HttpCatalogGateway } from "../gateways/http/HttpCatalogGateway";
import { HttpCouponsGateway } from "../gateways/http/HttpCouponsGateway";
import { HttpDeviceTokensGateway } from "../gateways/http/HttpDeviceTokensGateway";
import { HttpDeliveryZonesGateway } from "../gateways/http/HttpDeliveryZonesGateway";
import { HttpPrintQueueGateway } from "../gateways/http/HttpPrintQueueGateway";
import { HttpUsersGateway } from "../gateways/http/HttpUsersGateway";
import { HttpMfaGateway } from "../gateways/http/HttpMfaGateway";
import { HttpNoticesGateway } from "../gateways/http/HttpNoticesGateway";
import { HttpSubscriptionGateway } from "../gateways/http/HttpSubscriptionGateway";
import { HttpStockGateway } from "../gateways/http/HttpStockGateway";
import type { PanelServices } from "./PanelServices";

export function createHttpPanelServices(http: HttpClient = new FetchHttpClient()): PanelServices {
  return {
    deliveryZones: new HttpDeliveryZonesGateway(http),
    printQueue: new HttpPrintQueueGateway(http),
    catalog: new HttpCatalogGateway(http),
    coupons: new HttpCouponsGateway(http),
    deviceTokens: new HttpDeviceTokensGateway(http),
    users: new HttpUsersGateway(http),
    audit: new HttpAuditGateway(http),
    auth: new HttpAuthGateway(http),
    store: new HttpStoreGateway(http),
    plan: new HttpPlanGateway(http),
    reports: new HttpReportsGateway(http),
    cashier: new HttpCashierGateway(http),
    orders: new HttpOrdersGateway(http),
    deliverers: new HttpDeliverersGateway(http),
    feedback: new HttpFeedbackGateway(http),
    realtime: new WebSocketRealtimeGateway(),
    subscription: new HttpSubscriptionGateway(http),
    notices: new HttpNoticesGateway(http),
    mfa: new HttpMfaGateway(http),
    stock: new HttpStockGateway(http),
  };
}
