import { afterEach, describe, expect, it, vi } from "vitest";
import { extractErrorMessage, FetchHttpClient } from "./FetchHttpClient";

// SEC-31b: o corpo de qualquer 5xx genérico é { statusCode, error: "Internal Server Error", message: "Erro interno do servidor" }. O web mostra
// `error` ao usuário (nunca `message`); a frase em inglês do Fastify não deve aparecer na tela.
describe("extractErrorMessage: 5xx genérico da API", () => {
  const FALLBACK = "Não foi possível concluir a ação. Tente de novo.";

  it("o corpo genérico de erro interno vira a frase padrão em português, nunca o inglês do Fastify nem o `message`", () => {
    const text = extractErrorMessage({ statusCode: 500, error: "Internal Server Error", message: "Erro interno do servidor" });
    expect(text).toBe(FALLBACK);
    expect(text).not.toMatch(/Internal Server Error/i);
  });

  it("vale para 502, 503 e 504 genéricos também", () => {
    for (const statusCode of [500, 502, 503, 504]) {
      expect(extractErrorMessage({ statusCode, error: "Internal Server Error", message: "x" })).toBe(FALLBACK);
    }
  });

  it("um 5xx com texto PRÓPRIO continua como veio (ex.: loja suspensa, falha transitória do pagamento, rede)", () => {
    expect(extractErrorMessage({ error: "Loja indisponível no momento.", code: "STORE_UNAVAILABLE" })).toBe("Loja indisponível no momento.");
    expect(extractErrorMessage({ error: "falha transitória" })).toBe("falha transitória");
    expect(extractErrorMessage({ statusCode: 503, error: "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo." })).toBe(
      "Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.",
    );
  });

  it("4xx não é afetado: o texto da API segue como veio, mesmo com o mesmo formato do Fastify", () => {
    expect(extractErrorMessage({ statusCode: 400, error: "Bad Request", message: "x" })).toBe("Bad Request");
    expect(extractErrorMessage({ error: "pedido não encontrado" })).toBe("pedido não encontrado");
  });

  it("a validação do Zod (flatten) segue igual", () => {
    expect(extractErrorMessage({ error: { formErrors: ["Informe o nome"], fieldErrors: {} } })).toBe("Informe o nome");
    expect(extractErrorMessage({ error: { formErrors: [], fieldErrors: { email: ["inválido"] } } })).toBe("email: inválido");
  });

  it("corpo vazio ou estranho cai na frase padrão", () => {
    expect(extractErrorMessage(null)).toBe(FALLBACK);
    expect(extractErrorMessage({})).toBe(FALLBACK);
  });

  it("pela cadeia completa: um 500 genérico chega à tela com a frase padrão", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ statusCode: 500, error: "Internal Server Error", message: "Erro interno do servidor" }), { status: 500 })));
    const result = await new FetchHttpClient().get("/x");
    vi.unstubAllGlobals();
    expect(result).toMatchObject({ ok: false, status: 500, error: FALLBACK });
  });
});

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
