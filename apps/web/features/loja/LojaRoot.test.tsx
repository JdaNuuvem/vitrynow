import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import { LojaRoot } from "./LojaRoot";

const menu = {
  store: {
    name: "Pizzaria Boa Massa", slug: "boa-massa", logoUrl: null, coverImageUrl: null, primaryColor: null, address: "Rua A, 1",
    whatsapp: null, openingHours: null, minOrderCents: null, deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 0,
  },
  categories: [
    {
      id: "c1", name: "Pizzas Tradicionais", icon: null,
      products: [{ id: "p1", name: "Calabresa Especial", description: "Molho e calabresa", imageUrl: null, priceCents: 4000, active: true, featured: false, additionals: [] }],
    },
  ],
} as unknown as Menu;

afterEach(() => vi.unstubAllGlobals());

// Defeito pego no navegador (WEB-16): o LojaRoot não repassava o menu do servidor ao LojaPage,
// então o HTML saía "Carregando..." e o cliente buscava tudo de novo. Estes testes cobrem a ligação.
describe("LojaRoot com o menu vindo do servidor (ADR-0013)", () => {
  it("o HTML renderizado no servidor já traz nome, categoria e produto (sem JS)", () => {
    const html = renderToString(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    expect(html).toContain("Pizzaria Boa Massa");
    expect(html).toContain("Pizzas Tradicionais");
    expect(html).toContain("Calabresa Especial");
    expect(html).not.toContain("Carregando");
  });

  it("no navegador mostra o menu na hora e não chama a API", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    expect(screen.getAllByText("Pizzaria Boa Massa").length).toBeGreaterThan(0);
    expect(screen.getByText("Calabresa Especial")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem menu inicial (API fora do ar no SSR) mostra 'Carregando' e busca no navegador", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<LojaRoot slug="boa-massa" />);
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
