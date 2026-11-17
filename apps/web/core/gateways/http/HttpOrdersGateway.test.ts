import { describe, expect, it, vi } from "vitest";
import type { HttpClient } from "../../http/HttpClient";
import { HttpOrdersGateway } from "./HttpOrdersGateway";

describe("HttpOrdersGateway.list (API-70)", () => {
  it("pede GET /api/orders e entrega a resposta INTEIRA, com openCapped e openHidden", async () => {
    const body = { orders: [], openCapped: true, openHidden: 9, serverNow: "x" };
    const get = vi.fn().mockResolvedValue({ ok: true, data: body });
    const result = await new HttpOrdersGateway({ get, post: vi.fn() } as unknown as HttpClient).list();
    expect(get).toHaveBeenCalledWith("/api/orders");
    expect(result).toEqual({ ok: true, data: body });
  });
});
