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

  it("o cabeçalho não vaza para as outras rotas (a regra é só desta)", async () => {
    const rules = await nextConfig.headers!();
    expect(rules.every((r: { source: string }) => r.source === "/reset-senha")).toBe(true);
  });

  it("o metadata também pede no-referrer e noindex (vale em navegação no cliente)", () => {
    expect(metadata.referrer).toBe("no-referrer");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });
});
