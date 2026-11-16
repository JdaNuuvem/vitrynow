import type { HttpResult } from "../http/HttpClient";
import type { Notice } from "../domain/notices";

export interface NoticesGateway {
  list(): Promise<HttpResult<{ notices: Notice[]; unreadCount: number }>>;
  markRead(noticeId: string): Promise<HttpResult<unknown>>;
}
