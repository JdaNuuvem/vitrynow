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

describe("HttpOrdersGateway: o id entra codificado em TODO caminho (parecer de segurança R1)", () => {
  const tricky = "a/../b?x=1#y";
  const encoded = encodeURIComponent(tricky);

  it("get, transition, cancel, undo, retryRefund e assignDeliverer nunca deixam / ? # ou .. escaparem do segmento do id", async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const post = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const gateway = new HttpOrdersGateway({ get, post } as unknown as HttpClient);
    await gateway.get(tricky);
    await gateway.transition(tricky, "CONFIRMADO");
    await gateway.cancel(tricky, { reasonCode: "OTHER" } as never);
    await gateway.undo(tricky);
    await gateway.retryRefund(tricky);
    await gateway.assignDeliverer(tricky, null);
    const urls = [...get.mock.calls, ...post.mock.calls].map((call) => call[0] as string);
    expect(urls).toHaveLength(6);
    for (const url of urls) {
      expect(url.startsWith(`/api/orders/${encoded}`), url).toBe(true);
      expect(url.slice("/api/orders/".length + encoded.length)).not.toMatch(/[?#.]/);
    }
  });

  it("entregadores também", async () => {
    const post = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const { HttpDeliverersGateway } = await import("./HttpOrdersGateway");
    const gateway = new HttpDeliverersGateway({ get: vi.fn(), post } as unknown as HttpClient);
    await gateway.setActive(tricky, true);
    await gateway.remove(tricky);
    expect(post.mock.calls.map((call) => call[0])).toEqual([`/api/deliverers/${encoded}`, `/api/deliverers/${encoded}/delete`]);
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
    await g.history({ status: "CONCLUIDO", period: "custom", from: "2026-08-20", to: "2026-11-17", limit: 25 });
    const url = calledUrl(get);
    expect(url.pathname).toBe("/api/orders/history");
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: "CONCLUIDO", period: "custom", from: "2026-08-20", to: "2026-11-17", limit: "25" });
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
