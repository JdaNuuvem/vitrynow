import type { HttpClient, RequestOptions } from "../../http/HttpClient";
import type { AuthGateway, CurrentUser } from "../AuthGateway";

export class HttpAuthGateway implements AuthGateway {
  constructor(private readonly http: HttpClient) {}

  me() {
    return this.http.get<{ user: CurrentUser }>("/auth/me");
  }

  login(email: string, password: string) {
    return this.http.post("/auth/login", { email, password });
  }

  logout() {
    return this.http.post("/auth/logout");
  }

  logoutAll() {
    return this.http.post<{ ok: true }>("/auth/logout-all");
  }

  changePassword(currentPassword: string, newPassword: string, options?: RequestOptions) {
    return this.http.post("/auth/change-password", { currentPassword, newPassword }, options);
  }

  forgotPassword(email: string) {
    return this.http.post("/auth/forgot-password", { email });
  }

  resetPassword(token: string, newPassword: string, email: string) {
    return this.http.post("/auth/reset-password", { token, newPassword, email });
  }

  inspectResetToken(token: string) {
    return this.http.post<{ valid: boolean; email?: string }>("/auth/reset-password/inspect", { token });
  }
}
