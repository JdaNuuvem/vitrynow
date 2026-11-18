import type { HttpClient } from "../../http/HttpClient";
import type { NoticesGateway } from "../NoticesGateway";
import type { Notice } from "../../domain/notices";

export class HttpNoticesGateway implements NoticesGateway {
  constructor(private readonly http: HttpClient) {}

  list() {
    return this.http.get<{ notices: Notice[]; unreadCount: number }>("/api/notices");
  }

  markRead(noticeId: string) {
    return this.http.post(`/api/notices/${noticeId}/read`);
  }
}
