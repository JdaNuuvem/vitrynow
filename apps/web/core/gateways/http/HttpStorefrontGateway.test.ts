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
  it("consulta os bairros públicos e envia a taxa vista somente na entrega", async () => {
    const { gateway, http } = setup();
    const input = {
      type: "DELIVERY" as const, customerName: "Teste", customerPhone: "21999999999", address: "Rua A",
      paymentMethod: "DINHEIRO" as const, couponCode: "", cart: [], neighborhoodId: "centro", expectedDeliveryFeeCents: 0,
    };
    await gateway.getDeliveryZones("loja");
    expect(http.get).toHaveBeenCalledWith("/stores/loja/delivery-zones");
    await gateway.placeOrder("loja", input);
    expect(http.post.mock.calls[0][1]).toMatchObject({ neighborhoodId: "centro", expectedDeliveryFeeCents: 0 });
    await gateway.placeOrder("loja", { ...input, type: "BALCAO" });
    expect(http.post.mock.calls[1][1]).not.toHaveProperty("expectedDeliveryFeeCents");
    expect(http.post.mock.calls[1][1]).not.toHaveProperty("neighborhoodId");
  });
  it("o cabeçalho é x-order-token", () => {
    expect(ORDER_TOKEN_HEADER).toBe("x-order-token");
  });

  it("consulta o rastreio da loja e do pedido com a credencial somente no cabeçalho", async () => {
    const { http, gateway } = setup();
    await gateway.getOrderTracking("minha loja", "pedido/123", "mco_segredo");
    expect(http.get).toHaveBeenCalledWith("/stores/minha%20loja/orders/pedido%2F123/tracking", {
      headers: { "x-order-token": "mco_segredo" },
    });
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
