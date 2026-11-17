import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../http/HttpClient";
import { ORDER_TOKEN_HEADER } from "../../domain/storefront";
import { HttpStorefrontGateway } from "./HttpStorefrontGateway";

function setup() {
  const http = {
    get: vi.fn().mockResolvedValue({ ok: true, data: {} }),
    post: vi.fn().mockResolvedValue({ ok: true, data: {} }),
  } as unknown as HttpClient & { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
  return { http, gateway: new HttpStorefrontGateway(http) };
}

describe("HttpStorefrontGateway: token do pedido (NG-16)", () => {
  it("o cabeçalho é x-order-token", () => {
    expect(ORDER_TOKEN_HEADER).toBe("x-order-token");
  });

  it("payment-status manda o token no CABEÇALHO e nunca na URL", async () => {
    const { http, gateway } = setup();
    await gateway.getPaymentStatus("loja", "o1", "mco_segredo");
    const [path, options] = http.get.mock.calls[0];
    expect(path).toBe("/stores/loja/orders/o1/payment-status");
    expect(path).not.toContain("mco_segredo");
    expect(options).toEqual({ headers: { "x-order-token": "mco_segredo" } });
  });

  it("cancelar manda o token no CABEÇALHO, sem corpo e nunca na URL", async () => {
    const { http, gateway } = setup();
    await gateway.cancelOrder("loja", "o1", "mco_segredo");
    const [path, body, options] = http.post.mock.calls[0];
    expect(path).toBe("/stores/loja/orders/o1/cancel");
    expect(path).not.toContain("mco_segredo");
    expect(body).toBeUndefined();
    expect(options).toEqual({ headers: { "x-order-token": "mco_segredo" } });
  });
});
