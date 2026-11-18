import type { HttpResult } from "../http/HttpClient";
import type { Coupon, NewCouponInput } from "../domain/coupons";

export interface CouponsGateway {
  list(): Promise<HttpResult<{ coupons: Coupon[] }>>;
  create(input: NewCouponInput): Promise<HttpResult<unknown>>;
  setActive(id: string, active: boolean): Promise<HttpResult<unknown>>;
  remove(id: string): Promise<HttpResult<unknown>>;
}
