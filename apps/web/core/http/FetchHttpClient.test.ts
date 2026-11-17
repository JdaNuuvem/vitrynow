import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchHttpClient } from "./FetchHttpClient";

// NG-16: o cabeçalho do token precisa chegar de verdade ao fetch, no GET e no POST, junto do Content-Type.
describe("FetchHttpClient: cabeçalhos extras", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };

  it("GET leva os cabeçalhos pedidos e mantém o Content-Type", async () => {
    const fetchMock = stub();
    await new FetchHttpClient().get("/x", { headers: { "x-order-token": "mco_abc" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toEqual({ "Content-Type": "application/json", "x-order-token": "mco_abc" });
    expect(init.credentials).toBe("include");
  });

  it("GET sem opções segue igual (só Content-Type)", async () => {
    const fetchMock = stub();
    await new FetchHttpClient().get("/x");
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ "Content-Type": "application/json" });
  });

  it("POST sem corpo leva o cabeçalho e nenhum corpo", async () => {
    const fetchMock = stub();
    await new FetchHttpClient().post("/x", undefined, { headers: { "x-order-token": "mco_abc" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(init.headers["x-order-token"]).toBe("mco_abc");
  });
});
