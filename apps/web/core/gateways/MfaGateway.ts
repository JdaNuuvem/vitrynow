import type { HttpResult } from "../http/HttpClient";
import type { MfaChallenge, MfaPurpose } from "../domain/mfa";

export interface MfaGateway {
  requestChallenge(purpose: MfaPurpose): Promise<HttpResult<MfaChallenge>>;
  verify(challengeId: string, code: string): Promise<HttpResult<unknown>>;
}
