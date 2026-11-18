import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { CheckoutStatus, PixCheckout, PlanOffer, Subscription } from "../domain/subscription";

export interface SubscriptionGateway {
  listPlans(): Promise<HttpResult<{ plans: PlanOffer[] }>>;
  getSubscription(): Promise<HttpResult<{ subscription: Subscription }>>;
  checkout(planCode: string): Promise<HttpResult<{ payment: PixCheckout }>>;
  getPayment(paymentId: string): Promise<HttpResult<{ status: CheckoutStatus; subscription: Subscription }>>;
  cancel(options?: RequestOptions): Promise<HttpResult<{ subscription: Subscription }>>;
}
