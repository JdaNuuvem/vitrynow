import type { HttpResult, RequestOptions } from "../http/HttpClient";
import type { TeamUser } from "../domain/users";

export interface UsersGateway {
  list(): Promise<HttpResult<{ users: TeamUser[] }>>;
  inviteStaff(email: string, password: string): Promise<HttpResult<unknown>>;
  remove(id: string, options?: RequestOptions): Promise<HttpResult<unknown>>;
}
