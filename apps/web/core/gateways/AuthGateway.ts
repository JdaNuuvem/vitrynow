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
  // SEC-29 parte 2 (ST-67): `email` é o e-mail DIGITADO pela pessoa; o servidor compara com o da conta do token (trim e caixa, tempo
  // constante) e recusa com o MESMO erro de token inválido, sem consumir o token, se não bater.
  resetPassword(token: string, newPassword: string, email: string): Promise<HttpResult<unknown>>;
  // SEC-29 / ST-63: confere o token SEM consumi-lo e devolve o e-mail mascarado ("m***@gmail.com"). Inválido, vencido, usado e
  // malformado dão o MESMO `{ valid: false }`; o corpo nunca traz id, loja nem papel.
  inspectResetToken(token: string): Promise<HttpResult<{ valid: boolean; email?: string }>>;
}
