import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { CashierGateway } from "../CashierGateway";
import type { CashClosedSession, CashClosingPreview, CashClosingResult, CashCloseInput, CashMovementInput, CashSessionDetail, CashierState } from "../../domain/cashier";

export class HttpCashierGateway implements CashierGateway {
  constructor(private readonly http: HttpClient) {}

  getCurrent() {
    return this.http.get<CashierState>("/api/cashier/current");
  }

  open(openingBalanceCents: number, notes?: string) {
    return this.http.post("/api/cashier/open", { openingBalanceCents, notes: notes || undefined });
  }

  previewClose(countedCents: number) {
    return this.http.get<CashClosingPreview>("/api/cashier/close-preview?countedCents=" + countedCents);
  }

  close(input: CashCloseInput) {
    return this.http.post<CashClosingResult>("/api/cashier/close", input);
  }

  addMovement(input: CashMovementInput, options?: RequestOptions) {
    return this.http.post("/api/cashier/movements", input, options);
  }

  listClosed() {
    return this.http.get<{ sessions: CashClosedSession[] }>("/api/cashier/sessions");
  }

  closedDetail(sessionId: string) {
    return this.http.get<CashSessionDetail>("/api/cashier/sessions/" + encodeURIComponent(sessionId) + "/summary");
  }

  dismissRuleNotice(noticeId: string) {
    return this.http.post("/api/cashier/notices/" + encodeURIComponent(noticeId) + "/dismiss");
  }
}
