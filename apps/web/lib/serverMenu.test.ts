import { describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import { absoluteImageUrl, fetchMenuOnServer, menuCacheTag, MENU_REVALIDATE_SECONDS, storeDescription } from "./serverMenu";

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

  it("pede à API interna, com revalidate curto e a tag do slug", async () => {
    const fetchMock = respond(200);
    await fetchMenuOnServer("boa", fetchMock);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("http://localhost:3001/stores/boa/menu");
    expect(init.next).toEqual({ revalidate: MENU_REVALIDATE_SECONDS, tags: [menuCacheTag("boa")] });
  });

  it("escapa o slug na URL", async () => {
    const fetchMock = respond(200);
    await fetchMenuOnServer("a/b?x=1", fetchMock);
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("http://localhost:3001/stores/a%2Fb%3Fx%3D1/menu");
  });

  it("404 = loja inexistente", async () => {
    expect(await fetchMenuOnServer("x", respond(404, { error: "loja não encontrada" }))).toEqual({ status: "not-found" });
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
