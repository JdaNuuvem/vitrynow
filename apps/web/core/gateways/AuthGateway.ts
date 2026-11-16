import type { HttpResult, RequestOptions } from "../http/HttpClient";

export interface AuthGateway {
  login(email: string, password: string): Promise<HttpResult<unknown>>;
  logout(): Promise<HttpResult<unknown>>;
  changePassword(currentPassword: string, newPassword: string, options?: RequestOptions): Promise<HttpResult<unknown>>;
  forgotPassword(email: string): Promise<HttpResult<unknown>>;
  resetPassword(token: string, newPassword: string): Promise<HttpResult<unknown>>;
}
