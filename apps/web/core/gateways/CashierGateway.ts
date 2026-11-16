import type { HttpResult } from "../http/HttpClient";
import type { CashMovementType, CashierState } from "../domain/cashier";

export interface CashierGateway {
  getCurrent(): Promise<HttpResult<CashierState>>;
  open(openingBalanceCents: number, notes?: string): Promise<HttpResult<unknown>>;
  close(closingBalanceCents: number, notes?: string): Promise<HttpResult<unknown>>;
  addMovement(input: { type: CashMovementType; amountCents: number; notes?: string }): Promise<HttpResult<unknown>>;
}
