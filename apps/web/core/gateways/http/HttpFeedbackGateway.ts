import type { HttpClient } from "../../http/HttpClient";
import type { FeedbackGateway } from "../FeedbackGateway";

export class HttpFeedbackGateway implements FeedbackGateway {
  constructor(private readonly http: HttpClient) {}

  send(message: string) {
    return this.http.post("/api/feedback", { message });
  }
}
