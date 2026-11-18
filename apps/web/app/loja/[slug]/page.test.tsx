import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import type { ServerMenuResult } from "@/lib/serverMenu";

let result: ServerMenuResult;
vi.mock("@/lib/serverMenu", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/serverMenu")>()),
  getMenuOnServer: vi.fn(async () => result),
}));
vi.mock("@/features/loja/LojaRoot", () => ({
  LojaRoot: ({ initialMenu }: { initialMenu?: Menu }) => <div data-testid="loja-root">{initialMenu?.store.name ?? "sem menu"}</div>,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import Page, { generateMetadata } from "./page";

const menu = { store: { name: "Pizzaria Boa", slug: "boa", address: "Rua A, 1", openingHours: "", coverImageUrl: null, logoUrl: null }, categories: [] } as unknown as Menu;
const props = { params: { slug: "boa" } };

describe("página do cardápio: cada resultado do servidor (ST-40)", () => {
  beforeEach(() => {
    result = { status: "ok", menu };
  });

  it("ok: entrega o menu para a loja", async () => {
    render(await Page(props));
    expect(screen.getByTestId("loja-root")).toHaveTextContent("Pizzaria Boa");
  });

  it("inexistente: 404 (notFound)", async () => {
    result = { status: "not-found" };
    await expect(Page(props)).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("suspensa: mostra 'indisponível' e NENHUM dado da loja (nome, endereço, produtos)", async () => {
    result = { status: "suspended" };
    const { container } = render(await Page(props));
    expect(screen.getByRole("heading", { name: /indisponível/i })).toBeInTheDocument();
    expect(screen.queryByTestId("loja-root")).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Pizzaria Boa|Rua A/);
  });

  it("suspensa: metadados neutros e sem indexação (o nome da loja não vaza para o link compartilhado)", async () => {
    result = { status: "suspended" };
    const metadata = await generateMetadata(props);
    expect(metadata.title).toBe("Cardápio");
    expect(metadata.robots).toEqual({ index: false });
    expect(JSON.stringify(metadata)).not.toMatch(/Pizzaria Boa/);
  });

  it("API fora do ar: a página abre sem menu e o navegador tenta sozinho", async () => {
    result = { status: "unavailable" };
    render(await Page(props));
    expect(screen.getByTestId("loja-root")).toHaveTextContent("sem menu");
  });
});
