import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("tem o link 'Ir para o cardápio' como primeiro foco, apontando para o conteúdo", () => {
    const { container } = render(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    const skip = screen.getByRole("link", { name: "Ir para o cardápio" });
    expect(skip).toHaveAttribute("href", "#cardapio-conteudo");
    expect(container.querySelector("#cardapio-conteudo")).toBeInTheDocument();
    expect(container.querySelector("a, button")).toBe(skip);
  });

  it("cardápio sem nenhum produto mostra a mensagem neutra e o contato, e esconde a categoria vazia", () => {
    const empty = {
      ...menu,
      store: { ...menu.store, whatsapp: "5521999999999" },
      categories: [{ id: "c1", name: "Vazia", icon: null, products: [] }],
    } as unknown as Menu;
    render(<LojaRoot slug="boa-massa" initialMenu={empty} />);
    expect(screen.getByText("Este cardápio ainda não tem produtos.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Falar com a loja" })).toHaveAttribute("href", "https://wa.me/5521999999999");
    expect(screen.queryByText("Vazia")).not.toBeInTheDocument();
  });

  it("categoria vazia some, mas as categorias com produto continuam", () => {
    const base = menu as unknown as { categories: unknown[] };
    const mixed = { ...menu, categories: [{ id: "c0", name: "Sem produtos", icon: null, products: [] }, ...base.categories] } as unknown as Menu;
    render(<LojaRoot slug="boa-massa" initialMenu={mixed} />);
    expect(screen.queryByText("Sem produtos")).not.toBeInTheDocument();
    expect(screen.getByText("Calabresa Especial")).toBeInTheDocument();
    expect(screen.queryByText("Este cardápio ainda não tem produtos.")).not.toBeInTheDocument();
  });

  it("sem menu inicial (API fora do ar no SSR) mostra 'Carregando' e busca no navegador", () => {
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);
    render(<LojaRoot slug="boa-massa" />);
    expect(screen.getByText("Carregando...")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// WEB-22 (F2 do Deming): a troca de tela desmonta a lista. Ao fechar o detalhe, a rolagem e o foco voltam ao produto.
describe("detalhe do produto: devolve rolagem e foco ao fechar", () => {
  function setupDetail() {
    // Devolve um valor de propósito: se o efeito repassasse o retorno do scrollTo, o React o chamaria como
    // função de limpeza e a página quebraria ao fechar o detalhe (visto no navegador).
    const scrollTo = vi.fn(() => "não é função");
    vi.stubGlobal("scrollTo", scrollTo);
    Object.defineProperty(window, "scrollY", { value: 480, configurable: true });
    render(<LojaRoot slug="boa-massa" initialMenu={menu} />);
    return scrollTo;
  }

  it("Voltar devolve o foco ao produto que abriu e a rolagem de onde estava", async () => {
    const scrollTo = setupDetail();
    await userEvent.click(screen.getByRole("button", { name: /Calabresa Especial/ }));
    expect(screen.getByRole("heading", { level: 1, name: "Calabresa Especial" })).toHaveFocus();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);

    await userEvent.click(screen.getByRole("button", { name: "Voltar ao cardápio" }));
    expect(screen.getByRole("button", { name: /Calabresa Especial/ })).toHaveFocus();
    expect(scrollTo).toHaveBeenLastCalledWith(0, 480);
  });

  it("Esc também devolve o foco ao produto", async () => {
    setupDetail();
    await userEvent.click(screen.getByRole("button", { name: /Calabresa Especial/ }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: /Calabresa Especial/ })).toHaveFocus();
  });

  it("Adicionar devolve o foco ao produto", async () => {
    setupDetail();
    await userEvent.click(screen.getByRole("button", { name: /Calabresa Especial/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Adicionar/ }));
    expect(screen.getByRole("button", { name: /Calabresa Especial/ })).toHaveFocus();
  });
});
