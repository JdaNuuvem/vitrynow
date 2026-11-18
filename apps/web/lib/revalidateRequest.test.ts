import { describe, expect, it, vi } from "vitest";
import { handleRevalidate } from "@/lib/revalidateRequest";

const SECRET = "segredo-de-teste-com-tamanho-razoavel";
const request = (body: unknown, headers: Record<string, string> = { "x-revalidate-secret": SECRET }) =>
  new Request("http://web:3000/api/revalidate", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("POST /api/revalidate (API-58)", () => {
  it("com o segredo certo invalida a tag menu:<slug>", async () => {
    const revalidateTag = vi.fn();
    const response = await handleRevalidate(request({ slug: "loja-do-ze" }), { secret: SECRET, revalidateTag });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: true, tag: "menu:loja-do-ze" });
    expect(revalidateTag).toHaveBeenCalledTimes(1);
    expect(revalidateTag).toHaveBeenCalledWith("menu:loja-do-ze");
  });

  it("sem segredo, com segredo errado ou de outro tamanho: 401 e nada é invalidado", async () => {
    const revalidateTag = vi.fn();
    const wrong: Record<string, string>[] = [{}, { "x-revalidate-secret": "errado" }, { "x-revalidate-secret": SECRET + "x" }, { "x-revalidate-secret": SECRET.slice(0, -1) }];
    for (const headers of wrong) {
      const response = await handleRevalidate(request({ slug: "loja" }, headers), { secret: SECRET, revalidateTag });
      expect(response.status, JSON.stringify(headers)).toBe(401);
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("sem REVALIDATE_SECRET configurado a rota fica FECHADA, mesmo que mandem cabeçalho vazio ou qualquer valor", async () => {
    const revalidateTag = vi.fn();
    for (const secret of [undefined, ""]) {
      const any: Record<string, string>[] = [{}, { "x-revalidate-secret": "" }, { "x-revalidate-secret": "qualquer" }];
      for (const headers of any) {
        const response = await handleRevalidate(request({ slug: "loja" }, headers), { secret, revalidateTag });
        expect(response.status).toBe(401);
      }
    }
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("slug inválido (vazio, maiúscula, barra, ponto, espaço, muito longo, não texto) é 400 e não vira tag", async () => {
    const revalidateTag = vi.fn();
    for (const slug of ["", "Loja", "a/b", "../x", "a b", "a".repeat(81), 42, null, ["a"], { $ne: 1 }]) {
      const response = await handleRevalidate(request({ slug }), { secret: SECRET, revalidateTag });
      expect(response.status, JSON.stringify(slug)).toBe(400);
    }
    const noBody = await handleRevalidate(request("não é json"), { secret: SECRET, revalidateTag });
    expect(noBody.status).toBe(400);
    expect(revalidateTag).not.toHaveBeenCalled();
  });
});
