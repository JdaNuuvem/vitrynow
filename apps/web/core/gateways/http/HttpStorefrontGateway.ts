import type { HttpClient } from "../../http/HttpClient";
import type { StorefrontGateway } from "../StorefrontGateway";

export const CAPTCHA_HEADER = "x-captcha-token";
import { ORDER_TOKEN_HEADER, type DeliveryZones, type Menu, type OrderTracking, type PaymentStatusResponse, type PlaceOrderInput, type PlacedOrderResponse } from "../../domain/storefront";

export class HttpStorefrontGateway implements StorefrontGateway {
  constructor(private readonly http: HttpClient) {}

  getMenu(slug: string) {
    return this.http.get<Menu>(`/stores/${slug}/menu`);
  }

  getOrderTracking(slug: string, orderId: string, token: string) {
    return this.http.get<OrderTracking>(`/stores/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderId)}/tracking`, {
      headers: { [ORDER_TOKEN_HEADER]: token },
    });
  }

  getDeliveryZones(slug: string) {
    return this.http.get<DeliveryZones>(`/stores/${slug}/delivery-zones`);
  }

  placeOrder(slug: string, input: PlaceOrderInput, options: { captchaToken?: string } = {}) {
    // NG-08: com risco (cliente com pedidos pendentes) a API pede a prova do captcha neste cabeçalho.
    const headers = options.captchaToken ? { headers: { [CAPTCHA_HEADER]: options.captchaToken } } : undefined;
    return this.http.post<PlacedOrderResponse>(`/stores/${slug}/orders`, {
      type: input.type,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      address: input.type === "DELIVERY" ? input.address : undefined,
      ...(input.type === "DELIVERY" && input.neighborhoodId ? { neighborhoodId: input.neighborhoodId } : {}),
      ...(input.type === "DELIVERY" && input.expectedDeliveryFeeCents != null ? { expectedDeliveryFeeCents: input.expectedDeliveryFeeCents } : {}),
      couponCode: input.couponCode.trim() || undefined,
      paymentMethod: input.paymentMethod,
      changeForCents: input.changeForCents,
      tipCents: input.tipCents,
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
      items: input.cart.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        additionalIds: line.additionalIds.length > 0 ? line.additionalIds : undefined,
        ...(line.optionSelections?.length ? { optionSelections: line.optionSelections } : {}),
        ...(line.expectedUnitPriceCents !== undefined ? { expectedUnitPriceCents: line.expectedUnitPriceCents } : {}),
        notes: line.notes,
      })),
    }, headers);
  }

  cancelOrder(slug: string, orderId: string, token: string) {
    return this.http.post(`/stores/${slug}/orders/${orderId}/cancel`, undefined, { headers: { [ORDER_TOKEN_HEADER]: token } });
  }

  getPaymentStatus(slug: string, orderId: string, token: string) {
    return this.http.get<PaymentStatusResponse>(`/stores/${slug}/orders/${orderId}/payment-status`, { headers: { [ORDER_TOKEN_HEADER]: token } });
  }
}
