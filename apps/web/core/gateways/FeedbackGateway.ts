import type { HttpResult } from "../http/HttpClient";

export interface FeedbackGateway {
  send(message: string): Promise<HttpResult<unknown>>;
}
