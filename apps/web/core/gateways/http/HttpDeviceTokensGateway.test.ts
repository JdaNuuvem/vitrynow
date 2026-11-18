import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../http/HttpClient";
import { HttpDeviceTokensGateway } from "./HttpDeviceTokensGateway";
import { HttpSubscriptionGateway } from "./HttpSubscriptionGateway";

// SEC-13: o comprovante de MFA (x-mfa-challenge) tem de chegar à requisição que a API protege.
describe("gateways com o cabeçalho de MFA", () => {
  const options = { headers: { "x-mfa-challenge": "ch-1" } };
  const client = () => ({ get: vi.fn(), post: vi.fn().mockResolvedValue({ ok: true, data: {} }) });

  it("criar e revogar chave de impressora repassam as options", async () => {
    const http = client();
    const gateway = new HttpDeviceTokensGateway(http as unknown as HttpClient);
    await gateway.create("Balcão", options);
    await gateway.revoke("t1", options);
    expect(http.post).toHaveBeenNthCalledWith(1, "/api/device-tokens", { label: "Balcão" }, options);
    expect(http.post).toHaveBeenNthCalledWith(2, "/api/device-tokens/t1/revoke", undefined, options);
  });

  it("cancelar assinatura repassa as options", async () => {
    const http = client();
    await new HttpSubscriptionGateway(http as unknown as HttpClient).cancel(options);
    expect(http.post).toHaveBeenCalledWith("/api/store/subscription/cancel", undefined, options);
  });

  it("sem options continua funcionando (outras telas)", async () => {
    const http = client();
    await new HttpSubscriptionGateway(http as unknown as HttpClient).cancel();
    expect(http.post).toHaveBeenCalledWith("/api/store/subscription/cancel", undefined, undefined);
  });
});
