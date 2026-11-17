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

describe("HttpOrdersGateway.history (API-70)", () => {
  const gateway = () => {
    const get = vi.fn().mockResolvedValue({ ok: true, data: { rows: [] } });
    return { get, gateway: new HttpOrdersGateway({ get, post: vi.fn() } as unknown as HttpClient) };
  };
  const calledUrl = (get: ReturnType<typeof vi.fn>) => new URL(`http://x${get.mock.calls[0][0] as string}`);

  it("pede GET /api/orders/history com os filtros na query string", async () => {
    const { get, gateway: g } = gateway();
    await g.history({ status: "ABERTO", period: "custom", from: "2026-08-20", to: "2026-11-17", limit: 25 });
    const url = calledUrl(get);
    expect(url.pathname).toBe("/api/orders/history");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "ABERTO", period: "custom", from: "2026-08-20", to: "2026-11-17", limit: "25" });
  });

  it("não manda parâmetro vazio nem indefinido", async () => {
    const { get, gateway: g } = gateway();
    await g.history({ status: "ABERTO", from: "", cursor: undefined });
    expect(get).toHaveBeenCalledWith("/api/orders/history?status=ABERTO");
  });

  it("sem filtro nenhum chama a rota pura; o cursor vai codificado", async () => {
    const first = gateway();
    await first.gateway.history({});
    expect(first.get).toHaveBeenCalledWith("/api/orders/history");
    const second = gateway();
    await second.gateway.history({ cursor: "a b+c/d=" });
    expect(calledUrl(second.get).searchParams.get("cursor")).toBe("a b+c/d=");
  });
});
