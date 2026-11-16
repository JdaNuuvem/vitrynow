import type { HttpClient } from "../../http/HttpClient";
import type { SubscriptionGateway } from "../SubscriptionGateway";
import type { CheckoutStatus, PixCheckout, PlanOffer, Subscription } from "../../domain/subscription";

export class HttpSubscriptionGateway implements SubscriptionGateway {
  constructor(private readonly http: HttpClient) {}

  listPlans() {
    return this.http.get<{ plans: PlanOffer[] }>("/api/plans");
  }

  getSubscription() {
    return this.http.get<{ subscription: Subscription }>("/api/store/subscription");
  }

  checkout(planCode: string) {
    return this.http.post<{ payment: PixCheckout }>("/api/store/subscription/checkout", { planCode });
  }

  getPayment(paymentId: string) {
    return this.http.get<{ status: CheckoutStatus; subscription: Subscription }>(`/api/store/subscription/payments/${paymentId}`);
  }

  cancel() {
    return this.http.post<{ subscription: Subscription }>("/api/store/subscription/cancel");
  }
}
