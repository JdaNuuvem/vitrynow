import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { CashClosedSession, CashClosingPreview, CashClosingResult, CashCloseInput, CashMovementInput, CashSessionDetail, CashierState } from "../domain/cashier";

export interface CashierGateway {
  getCurrent(): Promise<HttpResult<CashierState>>;
  open(openingBalanceCents: number, notes?: string): Promise<HttpResult<unknown>>;
  previewClose(countedCents: number): Promise<HttpResult<CashClosingPreview>>;
  close(input: CashCloseInput): Promise<HttpResult<CashClosingResult>>;
  addMovement(input: CashMovementInput, options?: RequestOptions): Promise<HttpResult<unknown>>;
  listClosed(): Promise<HttpResult<{ sessions: CashClosedSession[] }>>;
  closedDetail(sessionId: string): Promise<HttpResult<CashSessionDetail>>;
  dismissRuleNotice(noticeId: string): Promise<HttpResult<unknown>>;
}
