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

  it("no-referrer vale para as rotas com tokens, mantendo a política comum nas demais", async () => {
    const rules = await nextConfig.headers!();
    const withToken = rules.filter((rule: { headers: { key: string; value: string }[] }) =>
      rule.headers.some(({ key, value }) => key === "Referrer-Policy" && value === "no-referrer"));
    expect(withToken.map((rule: { source: string }) => rule.source)).toEqual(["/reset-senha", "/loja/:slug/m/:token"]);
  });

  it("o metadata também pede no-referrer e noindex (vale em navegação no cliente)", () => {
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
