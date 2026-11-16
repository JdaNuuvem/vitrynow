import type { HttpClient } from "../../http/HttpClient";
import type { StorefrontGateway } from "../StorefrontGateway";
import type { Menu, PaymentStatusResponse, PlaceOrderInput, PlacedOrderResponse } from "../../domain/storefront";

export class HttpStorefrontGateway implements StorefrontGateway {
  constructor(private readonly http: HttpClient) {}

  getMenu(slug: string) {
    return this.http.get<Menu>(`/stores/${slug}/menu`);
  }

  placeOrder(slug: string, input: PlaceOrderInput) {
    return this.http.post<PlacedOrderResponse>(`/stores/${slug}/orders`, {
      type: input.type,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      address: input.type === "DELIVERY" ? input.address : undefined,
      couponCode: input.couponCode.trim() || undefined,
      paymentMethod: input.paymentMethod,
      changeForCents: input.changeForCents,
      tipCents: input.tipCents,
      items: input.cart.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        additionalIds: line.additionalIds.length > 0 ? line.additionalIds : undefined,
        notes: line.notes,
      })),
    });
  }

  cancelOrder(slug: string, orderId: string) {
    return this.http.post(`/stores/${slug}/orders/${orderId}/cancel`);
  }

  getPaymentStatus(slug: string, orderId: string) {
    return this.http.get<PaymentStatusResponse>(`/stores/${slug}/orders/${orderId}/payment-status`);
  }
}
