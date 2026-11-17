import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/domain/storefront";
import { ProductListItem } from "./ProductListItem";

const base = {
  id: "p1",
  name: "Cheeseburguer",
  description: "Pão, carne e queijo",
  imageUrl: "https://x/foto.png",
  priceCents: 1500,
  active: true,
  featured: false,
  additionals: [],
} as unknown as Product;

function setup(over: { product?: Product; quantityInCart?: number; closed?: boolean } = {}) {
  const onOpen = vi.fn();
  const onQuickAdd = vi.fn();
  const { container } = render(
    <ProductListItem product={over.product ?? base} quantityInCart={over.quantityInCart ?? 0} closed={over.closed} onOpen={onOpen} onQuickAdd={onQuickAdd} />,
  );
  return { onOpen, onQuickAdd, container };
}

describe("ProductListItem", () => {
  it("mostra nome, preço e descrição", () => {
    setup();
    expect(screen.getByText("Cheeseburguer")).toBeInTheDocument();
    expect(screen.getByText("R$ 15,00")).toBeInTheDocument();
    expect(screen.getByText("Pão, carne e queijo")).toBeInTheDocument();
  });

  it("clicar abre o detalhe; Enter também", async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByRole("button", { name: /Cheeseburguer/ }));
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenCalledWith(base);
  });

  it("o + rápido adiciona sem abrir o detalhe", async () => {
    const { onOpen, onQuickAdd } = setup();
    await userEvent.click(screen.getByText("+"));
    expect(onQuickAdd).toHaveBeenCalledWith(base);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("com itens no carrinho o selo mostra a quantidade", () => {
    setup({ quantityInCart: 3 });
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
  });

  it("loja fechada: o + rápido some (spec 09 §2.4), mas o produto ainda abre", async () => {
    const { onOpen } = setup({ closed: true });
    expect(screen.queryByText("+")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Cheeseburguer/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("sem foto não há selo de adicionar rápido nem imagem", () => {
    const { container } = setup({ product: { ...base, imageUrl: null } as Product });
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.queryByText("+")).not.toBeInTheDocument();
  });

  it("Espaço também abre o detalhe (o role=button promete Enter e Espaço)", async () => {
    const { onOpen } = setup();
    screen.getByRole("button", { name: /Cheeseburguer/ }).focus();
    await userEvent.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("carrega o id do produto para o foco poder voltar a ele (WEB-22)", () => {
    const { container } = setup();
    expect(container.querySelector('[data-product-id="p1"]')).toBeInTheDocument();
  });
});
