import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../http/HttpClient";
import { HttpAuthGateway } from "./HttpAuthGateway";

function setup() {
  const http = { get: vi.fn(), post: vi.fn().mockResolvedValue({ ok: true, data: {} }) } as unknown as HttpClient & { post: ReturnType<typeof vi.fn> };
  return { http, gateway: new HttpAuthGateway(http) };
}

describe("HttpAuthGateway: redefinição de senha (SEC-29)", () => {
  it("o envio leva token, senha nova e o e-mail DIGITADO no CORPO (nunca na URL)", async () => {
    const { http, gateway } = setup();
    await gateway.resetPassword("tok123", "SenhaNova1234", "maria@gmail.com");
    const [path, body] = http.post.mock.calls[0];
    expect(path).toBe("/auth/reset-password");
    expect(body).toEqual({ token: "tok123", newPassword: "SenhaNova1234", email: "maria@gmail.com" });
    expect(path).not.toMatch(/tok123|maria/);
  });

  it("a conferência manda só o token, no corpo, para a rota que não o consome", async () => {
    const { http, gateway } = setup();
    await gateway.inspectResetToken("tok123");
    const [path, body] = http.post.mock.calls[0];
    expect(path).toBe("/auth/reset-password/inspect");
    expect(body).toEqual({ token: "tok123" });
  });
});
