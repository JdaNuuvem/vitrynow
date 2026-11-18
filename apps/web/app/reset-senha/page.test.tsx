import { describe, expect, it } from "vitest";
// @ts-expect-error -- next.config.mjs é JavaScript puro, sem declaração de tipos
import nextConfig from "../../next.config.mjs";
import { metadata } from "./page";

describe("rota /reset-senha: nada de Referer e fora do índice (ST-56)", () => {
  it("o cabeçalho Referrer-Policy: no-referrer vale para /reset-senha", async () => {
    const rules = await nextConfig.headers!();
    const rule = rules.find((r: { source: string }) => r.source === "/reset-senha");
    expect(rule?.headers).toContainEqual({ key: "Referrer-Policy", value: "no-referrer" });
  });

  it("o no-referrer não vaza para as outras rotas: só a regra desta rota o traz (NG-07 acrescentou a CSP global)", async () => {
    const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    const noReferrer = rules.filter((r) => r.headers.some((h) => h.key === "Referrer-Policy" && h.value === "no-referrer"));
    expect(noReferrer.map((r) => r.source)).toEqual(["/reset-senha"]);
  });

  it("a regra global deixa de fora o /reset-senha (nunca duas regras definindo o mesmo cabeçalho) e esta rota segue com a CSP", async () => {
    const rules = (await nextConfig.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    const reset = rules.find((r) => r.source === "/reset-senha")!;
    expect(reset.headers.some((h) => h.key === "Content-Security-Policy")).toBe(true);
    const global = rules.find((r) => r.source !== "/reset-senha")!;
    expect(new RegExp(`^${global.source}$`).test("/reset-senha")).toBe(false);
    expect(new RegExp(`^${global.source}$`).test("/login")).toBe(true);
  });

  it("o metadata também pede no-referrer e noindex (vale em navegação no cliente)", () => {
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
