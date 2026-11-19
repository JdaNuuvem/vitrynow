import type { HttpClient } from "../../http/HttpClient";
import type { CouponsGateway } from "../CouponsGateway";
import type { Coupon, NewCouponInput } from "../../domain/coupons";

export class HttpCouponsGateway implements CouponsGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ coupons: Coupon[] }>("/api/coupons");
  }

  create(input: NewCouponInput) {
    return this.http.post("/api/coupons", input);
  }

  update(id: string, input: Partial<NewCouponInput>) {
    return this.http.post(`/api/coupons/${encodeURIComponent(id)}`, input);
  }

  setActive(id: string, active: boolean) {
    return this.http.post(`/api/coupons/${id}`, { active });
  }

  remove(id: string) {
    return this.http.post(`/api/coupons/${id}/delete`);
  }
}
