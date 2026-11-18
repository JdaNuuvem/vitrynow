import type { HttpClient } from "../../http/HttpClient";
import type { CashierGateway } from "../CashierGateway";
import type { CashMovementType, CashierState } from "../../domain/cashier";

export class HttpCashierGateway implements CashierGateway {
  constructor(private readonly http: HttpClient) {}

  getCurrent() {
    return this.http.get<CashierState>("/api/cashier/current");
  }

  open(openingBalanceCents: number, notes?: string) {
    return this.http.post("/api/cashier/open", { openingBalanceCents, notes: notes || undefined });
  }

  close(closingBalanceCents: number, notes?: string) {
    return this.http.post("/api/cashier/close", { closingBalanceCents, notes: notes || undefined });
  }

  addMovement(input: { type: CashMovementType; amountCents: number; notes?: string }) {
    return this.http.post("/api/cashier/movements", input);
  }
}
