import type { HttpClient } from "../../http/HttpClient";
import type { MfaGateway } from "../MfaGateway";
import type { MfaChallenge, MfaPurpose } from "../../domain/mfa";

export class HttpMfaGateway implements MfaGateway {
  constructor(private readonly http: HttpClient) {}

  requestChallenge(purpose: MfaPurpose) {
    return this.http.post<MfaChallenge>("/api/mfa/challenge", { purpose });
  }

  verify(challengeId: string, code: string) {
    return this.http.post("/api/mfa/verify", { challengeId, code });
  }
}
