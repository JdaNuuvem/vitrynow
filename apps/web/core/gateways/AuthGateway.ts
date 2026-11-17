import type { HttpResult, RequestOptions } from "../http/HttpClient";

// Quem está logado (GET /auth/me). O papel só serve para esconder o que o servidor já recusaria (WEB-24);
// a barreira de verdade continua sendo a API.
export type PanelRole = "OWNER" | "STAFF";
export type CurrentUser = { userId: string; storeId: string; role: PanelRole };

export interface AuthGateway {
  me(): Promise<HttpResult<{ user: CurrentUser }>>;
  login(email: string, password: string): Promise<HttpResult<unknown>>;
  logout(): Promise<HttpResult<unknown>>;
  changePassword(currentPassword: string, newPassword: string, options?: RequestOptions): Promise<HttpResult<unknown>>;
  forgotPassword(email: string): Promise<HttpResult<unknown>>;
  resetPassword(token: string, newPassword: string): Promise<HttpResult<unknown>>;
}
