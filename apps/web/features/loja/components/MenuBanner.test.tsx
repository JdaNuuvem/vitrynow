import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Category, Product } from "@/core/domain/storefront";
import type { MenuBannerConfig } from "../banners";
import { MenuBanner } from "./MenuBanner";

const product: Product = {
  id: "pizza", name: "Pizza da casa", description: null, imageUrl: null, priceCents: 4500, additionals: [],
};
const categories: Category[] = [
  { id: "pizzas", name: "Pizzas", icon: null, products: [product] },
  { id: "vazia", name: "Sem produtos", icon: null, products: [] },
];
const banner: MenuBannerConfig = {
  id: "pizza-da-casa", title: "Pizza da casa", description: "Conheça os ingredientes e escolha suas opções.",
  imageUrl: "https://imagens.example/pizza.webp", imagePosition: "70% 50%",
  action: { label: "Ver pizzas", target: { kind: "category", id: "pizzas" } },
};

function setup(config: MenuBannerConfig | undefined = banner) {
  const onSelectCategory = vi.fn();
  const onOpenProduct = vi.fn();
  const result = render(<MenuBanner banner={config} categories={categories} onSelectCategory={onSelectCategory} onOpenProduct={onOpenProduct} />);
  return { ...result, onSelectCategory, onOpenProduct };
}

describe("MenuBanner", () => {
  it("sem configuração não reserva uma campanha vazia", () => {
    const { container } = render(<MenuBanner categories={categories} onSelectCategory={vi.fn()} onOpenProduct={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("mantém título e descrição em HTML e nomeia a região pelo título", () => {
    const { container } = setup();
    const heading = screen.getByRole("heading", { level: 2, name: banner.title });
    expect(screen.getByRole("region", { name: banner.title })).toHaveAttribute("aria-labelledby", heading.id);
    expect(screen.getByText(banner.description!)).toBeInTheDocument();
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width");
    expect(img).toHaveAttribute("height");
    expect(img).toHaveStyle({ objectPosition: "70% 50%" });
  });

  it("abre categoria real sem abrir nem adicionar um produto", async () => {
    const { onSelectCategory, onOpenProduct } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Ver pizzas" }));
    expect(onSelectCategory).toHaveBeenCalledWith("pizzas");
    expect(onOpenProduct).not.toHaveBeenCalled();
  });

  it("abre o detalhe do produto atual sem adicionar ao carrinho", async () => {
    const { onOpenProduct, onSelectCategory } = setup({ ...banner, action: { label: "Ver prato", target: { kind: "product", id: "pizza" } } });
    await userEvent.click(screen.getByRole("button", { name: "Ver prato" }));
    expect(onOpenProduct).toHaveBeenCalledWith(product);
    expect(onSelectCategory).not.toHaveBeenCalled();
  });

  it.each([
    { kind: "category" as const, id: "removida" },
    { kind: "category" as const, id: "vazia" },
    { kind: "product" as const, id: "removido" },
  ])("oculta a ação para destino indisponível: $kind / $id", (target) => {
    setup({ ...banner, action: { label: "Ver opções", target } });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: banner.title })).toBeInTheDocument();
  });

  it("permite banner informativo sem ação e sem descrição", () => {
    setup({ ...banner, description: undefined, action: undefined });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText(banner.description!)).not.toBeInTheDocument();
  });

  it("imagem quebrada mantém texto e CTA com alternativa sem imagem", async () => {
    const { container, onSelectCategory } = setup();
    fireEvent.error(container.querySelector("img")!);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".loja__banner-media--empty")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: banner.title })).not.toHaveClass("loja__banner--text-only");
    expect(screen.getByText(banner.description!)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Ver pizzas" }));
    expect(onSelectCategory).toHaveBeenCalledWith("pizzas");
  });

  it("ação recebe foco pelo Tab e funciona com Enter e Espaço", async () => {
    const { onSelectCategory } = setup();
    const action = screen.getByRole("button", { name: "Ver pizzas" });
    await userEvent.tab();
    expect(action).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onSelectCategory).toHaveBeenCalledTimes(2);
  });
});
