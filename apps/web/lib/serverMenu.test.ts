import { afterEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import { absoluteImageUrl, fetchMenuOnServer, getMenuOnServer, INTERNAL_SECRET_HEADER, isInternalHost, menuCacheTag, MENU_REVALIDATE_SECONDS, MAX_STALE_SECONDS, MISSING_MEMORY_SECONDS, NEGATIVE_CACHE_SECONDS, resetServerMenuState, storeDescription } from "./serverMenu";

// unstable_cache só existe dentro do Next; aqui um duplo que repete o que importa: guarda o valor que a função
// RETORNA (por chave) e, se ela lançar, não grava nada. Registra as opções recebidas.
const cacheCalls: { keyParts: string[]; options: { revalidate?: number; tags?: string[] }; fn: () => Promise<unknown> }[] = [];
const cacheStore = new Map<string, unknown>();
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, keyParts: string[], options: { revalidate?: number; tags?: string[] }) => {
    cacheCalls.push({ keyParts, options, fn });
    return async () => {
      const key = keyParts.join("|");
      if (!cacheStore.has(key)) cacheStore.set(key, await fn());
      return cacheStore.get(key);
    };
  },
}));

const menu = {
  store: { name: "Pizzaria <b>Boa</b>", slug: "boa", address: "Rua A, 1", openingHours: "Seg a sex, 18h às 23h" },
  categories: [{ id: "c1", name: "Pizzas", icon: null, products: [{ id: "p1" }] }],
} as unknown as Menu;

const respond = (status: number, body: unknown = menu) =>
  vi.fn().mockResolvedValue({ status, ok: status >= 200 && status < 300, json: async () => body }) as unknown as typeof fetch;

describe("fetchMenuOnServer (ADR-0013)", () => {
  it("200 com menu válido", async () => {
    expect(await fetchMenuOnServer("boa", respond(200))).toEqual({ status: "ok", menu });
  });

  it("pede à API interna sem cache de resposta HTTP e sem seguir redirecionamento (ST-40/ST-41)", async () => {
    const fetchMock = respond(200);
    await fetchMenuOnServer("boa", fetchMock);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:3001/stores/boa/menu");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(init.next).toBeUndefined();
  });

  it("escapa o slug na URL", async () => {
    const fetchMock = respond(200);
    await fetchMenuOnServer("a/b?x=1", fetchMock);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://localhost:3001/stores/a%2Fb%3Fx%3D1/menu");
  });

  it("404 = loja inexistente", async () => {
    expect(await fetchMenuOnServer("x", respond(404, { error: "loja não encontrada" }))).toEqual({ status: "not-found" });
  });

  it("503 STORE_UNAVAILABLE (API-09) = loja suspensa, sem dados da loja", async () => {
    expect(await fetchMenuOnServer("x", respond(503, { error: "Loja indisponível no momento.", code: "STORE_UNAVAILABLE" }))).toEqual({ status: "suspended" });
  });

  it("503 sem o código de suspensão é falha transitória, não suspensão", async () => {
    expect(await fetchMenuOnServer("x", respond(503, { error: "falha" }))).toEqual({ status: "unavailable" });
    const brokenBody = vi.fn().mockResolvedValue({ status: 503, ok: false, json: async () => Promise.reject(new Error("x")) }) as unknown as typeof fetch;
    expect(await fetchMenuOnServer("x", brokenBody)).toEqual({ status: "unavailable" });
  });

  it("5xx e corpo inválido NÃO viram 404 (a loja pode existir)", async () => {
    expect(await fetchMenuOnServer("x", respond(500))).toEqual({ status: "unavailable" });
    expect(await fetchMenuOnServer("x", respond(200, { foo: 1 }))).toEqual({ status: "unavailable" });
  });

  it("API fora do ar: indisponível, sem exceção", async () => {
    const down = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;
    expect(await fetchMenuOnServer("x", down)).toEqual({ status: "unavailable" });
  });
});

// SEC-24: medido em execução (60 visitantes com IPs diferentes → 1 chamada à API; +32 s e 20 visitantes → 2). O que
// garante isso é a página continuar em cache ISR: estes testes travam as condições.
describe("fetchMenuOnServer e o limite da API (SEC-24)", () => {
  afterEach(() => vi.unstubAllEnvs());

  const callOf = async () => {
    const fetchMock = respond(200);
    await fetchMenuOnServer("boa", fetchMock);
    return (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit & { next?: unknown };
  };

  it("nunca manda cabeçalho por visitante (X-Forwarded-For): a resposta em cache é a mesma para todos", async () => {
    const init = await callOf();
    expect(Object.keys(init.headers as object).map((name) => name.toLowerCase())).not.toContain("x-forwarded-for");
  });

  it("sem a variável de segredo não manda cabeçalho de serviço", async () => {
    vi.stubEnv("API_INTERNAL_SECRET", "");
    expect((await callOf()).headers).toEqual({ Accept: "application/json" });
  });

  it("com a variável de segredo, manda o segredo de serviço (só no servidor)", async () => {
    vi.stubEnv("API_INTERNAL_SECRET", "segredo-de-teste");
    expect((await callOf()).headers).toMatchObject({ [INTERNAL_SECRET_HEADER]: "segredo-de-teste" });
  });

  it("ST-41: o segredo NÃO acompanha a chamada se API_INTERNAL_URL não for host interno", async () => {
    vi.stubEnv("API_INTERNAL_SECRET", "segredo-de-teste");
    vi.stubEnv("API_INTERNAL_URL", "https://api.meucardapio.com.br");
    expect((await callOf()).headers).toEqual({ Accept: "application/json" });
  });

  it("host interno: loopback, rede privada, nome de serviço do Docker e *.internal; público não", () => {
    for (const url of ["http://localhost:3001", "http://127.0.0.1:3001", "http://10.0.0.5:3001", "http://172.18.0.3:3001", "http://192.168.1.9", "http://api:3001", "http://api.internal", "http://[::1]:3001"]) {
      expect(isInternalHost(url), url).toBe(true);
    }
    for (const url of ["https://api.meucardapio.com.br", "http://8.8.8.8", "http://172.32.0.1", "http://169.254.169.254.evil.com", "ftp://api", "não é url"]) {
      expect(isInternalHost(url), url).toBe(false);
    }
  });

  it("o segredo não é variável pública (NEXT_PUBLIC_* iria para o navegador)", () => {
    expect("API_INTERNAL_SECRET").not.toMatch(/^NEXT_PUBLIC_/);
  });
});

describe("getMenuOnServer: o cache guarda o RESULTADO, não a resposta HTTP (ST-40)", () => {
  afterEach(() => {
    cacheStore.clear();
    cacheCalls.length = 0;
    resetServerMenuState();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const stubFetch = (response: Response) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("cache de 30 s com a tag do slug e a chave por loja", async () => {
    stubFetch(reply(200, menu));
    await getMenuOnServer("boa");
    expect(cacheCalls[0].options).toEqual({ revalidate: MENU_REVALIDATE_SECONDS, tags: [menuCacheTag("boa")] });
    expect(cacheCalls[0].keyParts).toContain("boa");
  });

  it("200 → ok; depois a API devolve 503 STORE_UNAVAILABLE e 404: o valor novo substitui o antigo na revalidação", async () => {
    stubFetch(reply(200, menu));
    expect((await getMenuOnServer("boa")).status).toBe("ok");
    cacheStore.clear(); // o cache expirou: a próxima chamada executa a função de novo
    stubFetch(reply(503, { error: "x", code: "STORE_UNAVAILABLE" }));
    expect(await getMenuOnServer("boa")).toEqual({ status: "suspended" });
    cacheStore.clear();
    stubFetch(reply(404, { error: "loja não encontrada" }));
    expect(await getMenuOnServer("boa")).toEqual({ status: "not-found" });
  });

  it("suspensa é GRAVADA como resultado: não precisa nova chamada à API para continuar fechada", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(503, { error: "x", code: "STORE_UNAVAILABLE" }));
    vi.stubGlobal("fetch", fetchMock);
    await getMenuOnServer("boa");
    await getMenuOnServer("boa");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falha transitória (API com 500) NÃO é gravada: a cópia anterior continua e a página abre sem dados", async () => {
    stubFetch(reply(500, { error: "boom" }));
    expect(await getMenuOnServer("boa")).toEqual({ status: "unavailable" });
    expect(cacheStore.size).toBe(0);
  });

  describe("slug da URL pública (ST-44)", () => {
    it("5000 slugs fora do formato: nenhuma chamada à API e nada no cache", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const alphabet = "ABCXYZ_./?%é ";
      for (let i = 0; i < 5000; i++) {
        const slug = "x" + i + alphabet[i % alphabet.length] + Math.random().toString(36).slice(2);
        expect(await getMenuOnServer(slug)).toEqual({ status: "not-found" });
      }
      expect(fetchMock).not.toHaveBeenCalled();
      expect(cacheCalls).toHaveLength(0);
    });

    it("vazio e acima de 80 caracteres também não passam; 80 passa", async () => {
      const fetchMock = vi.fn().mockResolvedValue(reply(404, { error: "x" }));
      vi.stubGlobal("fetch", fetchMock);
      expect(await getMenuOnServer("")).toEqual({ status: "not-found" });
      expect(await getMenuOnServer("a".repeat(81))).toEqual({ status: "not-found" });
      expect(fetchMock).not.toHaveBeenCalled();
      await getMenuOnServer("a".repeat(80));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe("'não existe' de slug que nunca foi loja (ST-44 c)", () => {
    it("não é gravado no cache em disco e é lembrado em memória: 1 chamada à API por janela", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => reply(404, { error: "x" }));
      vi.stubGlobal("fetch", fetchMock);
      expect(await getMenuOnServer("inventado")).toEqual({ status: "not-found" });
      expect(await getMenuOnServer("inventado")).toEqual({ status: "not-found" });
      expect(await getMenuOnServer("inventado")).toEqual({ status: "not-found" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(cacheStore.size).toBe(0);
    });

    it("passada a janela de memória, pergunta de novo (a loja pode ter sido criada)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
      const fetchMock = vi.fn().mockImplementation(async () => reply(404, { error: "x" }));
      vi.stubGlobal("fetch", fetchMock);
      await getMenuOnServer("inventado");
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z").getTime() + MISSING_MEMORY_SECONDS * 1000 + 1);
      await getMenuOnServer("inventado");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("loja que JÁ foi vista com cardápio e some (removida): o 'não existe' É gravado e substitui a cópia boa", async () => {
      stubFetch(reply(200, menu));
      await getMenuOnServer("boa");
      cacheStore.clear();
      stubFetch(reply(404, { error: "x" }));
      expect(await getMenuOnServer("boa")).toEqual({ status: "not-found" });
      expect(cacheStore.get("menu-ssr|boa")).toMatchObject({ status: "not-found" });
    });

    it("a memória tem teto: com muitos slugs inventados não cresce sem limite (os excedentes seguem respondendo)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply(404, { error: "x" })));
      for (let i = 0; i < 1200; i++) expect(await getMenuOnServer("s" + i)).toEqual({ status: "not-found" });
    });
  });

  describe("teto de obsolescência da cópia boa (ST-44 d/e)", () => {
    const stored = (ageSeconds: number) => {
      const now = new Date("2026-11-17T12:00:00Z").getTime();
      vi.useFakeTimers();
      vi.setSystemTime(now);
      cacheStore.set("menu-ssr|boa", { status: "ok", menu, fetchedAt: now - ageSeconds * 1000 });
    };

    it("cópia com menos de 10 min segue sendo servida (a revalidação pode estar falhando)", async () => {
      stored(MAX_STALE_SECONDS - 5);
      expect((await getMenuOnServer("boa")).status).toBe("ok");
    });

    it("cópia com mais de 10 min falha FECHADA: 'indisponível', sem dados da loja", async () => {
      stored(MAX_STALE_SECONDS + 5);
      expect(await getMenuOnServer("boa")).toEqual({ status: "suspended" });
    });

    it("o valor devolvido à página não carrega o carimbo interno de idade", async () => {
      stored(1);
      expect(await getMenuOnServer("boa")).not.toHaveProperty("fetchedAt");
    });
  });

  describe("cache negativo curto na queda da API", () => {
    const down = () => vi.fn().mockResolvedValue(reply(500, { error: "boom" }));

    it("durante a janela de falha não chama a API de novo; passada a janela, tenta outra vez", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
      const fetchMock = down();
      vi.stubGlobal("fetch", fetchMock);
      await getMenuOnServer("boa");
      await getMenuOnServer("boa");
      await getMenuOnServer("boa");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z").getTime() + NEGATIVE_CACHE_SECONDS * 1000 + 1);
      await getMenuOnServer("boa");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("é por loja: a falha de uma não bloqueia as outras", async () => {
      const fetchMock = down();
      vi.stubGlobal("fetch", fetchMock);
      await getMenuOnServer("boa");
      await getMenuOnServer("outra");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("nunca substitui a última cópia boa: na janela a função em cache LANÇA sem buscar (o Next não grava nada)", async () => {
      const fetchMock = down();
      vi.stubGlobal("fetch", fetchMock);
      await getMenuOnServer("boa"); // 1ª falha: busca, lança
      const insideCache = cacheCalls[0].fn; // a mesma função que o Next executa ao revalidar a cópia expirada
      await expect(insideCache()).rejects.toThrow();
      await expect(insideCache()).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(1); // nenhuma chamada nova à API
      expect(cacheStore.size).toBe(0); // e nada foi gravado no lugar da cópia boa
    });

    it("sem falha, o cache negativo não interfere: 200 e 503 de suspensão seguem normais", async () => {
      vi.useFakeTimers();
      stubFetch(reply(200, menu));
      expect((await getMenuOnServer("boa")).status).toBe("ok");
      cacheStore.clear();
      stubFetch(reply(503, { error: "x", code: "STORE_UNAVAILABLE" }));
      expect(await getMenuOnServer("boa")).toEqual({ status: "suspended" });
    });

    it("volta a funcionar assim que a API volta e a janela passa", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
      vi.stubGlobal("fetch", down());
      expect((await getMenuOnServer("boa")).status).toBe("unavailable");
      vi.setSystemTime(new Date("2026-11-17T12:00:00Z").getTime() + NEGATIVE_CACHE_SECONDS * 1000 + 1);
      stubFetch(reply(200, menu));
      expect((await getMenuOnServer("boa")).status).toBe("ok");
    });
  });
});

describe("metadados", () => {
  it("og:image só aceita URL absoluta http(s)", () => {
    expect(absoluteImageUrl("https://cdn.x/capa.png")).toBe("https://cdn.x/capa.png");
    expect(absoluteImageUrl("/uploads/capa.png")).toBeNull();
    expect(absoluteImageUrl("javascript:alert(1)")).toBeNull();
    expect(absoluteImageUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(absoluteImageUrl(null)).toBeNull();
    expect(absoluteImageUrl("")).toBeNull();
  });

  it("descrição traz nome, endereço e horário, no máximo 300 caracteres", () => {
    const text = storeDescription(menu);
    expect(text).toContain("Rua A, 1");
    expect(text).toContain("Seg a sex");
    const long = { ...menu, store: { ...menu.store, address: "x".repeat(500) } } as unknown as Menu;
    expect(storeDescription(long).length).toBeLessThanOrEqual(300);
  });

  it("loja sem produtos usa texto neutro", () => {
    const empty = { ...menu, categories: [] } as unknown as Menu;
    expect(storeDescription(empty)).toMatch(/^Cardápio de /);
  });
});
