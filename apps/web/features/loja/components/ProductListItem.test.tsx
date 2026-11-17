import { fireEvent, render, screen, within } from "@testing-library/react";
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
  additionals: [],
} as unknown as Product;

const withOptions = { ...base, additionals: [{ id: "a1", name: "Bacon", priceCents: 400 }] } as unknown as Product;

type Over = { product?: Product; quantityInCart?: number; closed?: boolean; compact?: boolean; categoryIcon?: string | null };

function setup(over: Over = {}) {
  const onOpen = vi.fn();
  const onQuickAdd = vi.fn();
  const onRemoveOne = vi.fn();
  const { container } = render(
    <ProductListItem
      product={over.product ?? base}
      quantityInCart={over.quantityInCart ?? 0}
      closed={over.closed}
      compact={over.compact}
      categoryIcon={over.categoryIcon}
      onOpen={onOpen}
      onQuickAdd={onQuickAdd}
      onRemoveOne={onRemoveOne}
    />,
  );
  return { onOpen, onQuickAdd, onRemoveOne, container };
}

describe("ProductListItem: estrutura do cartão v2 (spec 12 §3)", () => {
  it("mostra nome, descrição e preço", () => {
    setup();
    expect(screen.getByRole("button", { name: "Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByText("Pão, carne e queijo")).toBeInTheDocument();
    expect(screen.getByText("R$ 15,00")).toBeInTheDocument();
  });

  it("o nome é um botão e o '+' é OUTRO botão: nenhum controle dentro de outro", () => {
    const { container } = setup();
    const name = screen.getByRole("button", { name: "Cheeseburguer" });
    const add = screen.getByRole("button", { name: "Adicionar Cheeseburguer" });
    expect(name).not.toBe(add);
    expect(name.contains(add)).toBe(false);
    expect(add.contains(name)).toBe(false);
    // nenhum botão ou elemento clicável dentro de outro botão
    container.querySelectorAll("button").forEach((button) => expect(button.querySelector("button, a, [role=button]")).toBeNull());
    expect(container.querySelector('[role="button"]')).toBeNull();
  });

  it("tocar no nome abre o detalhe; o '+' não abre o detalhe", async () => {
    const { onOpen, onQuickAdd } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Cheeseburguer" }));
    expect(onOpen).toHaveBeenCalledWith(base);
    onOpen.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar Cheeseburguer" }));
    expect(onQuickAdd).toHaveBeenCalledWith(base);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("o nome abre com Enter e com Espaço (é um botão de verdade)", async () => {
    const { onOpen } = setup();
    screen.getByRole("button", { name: "Cheeseburguer" }).focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("ordem do Tab: nome → '+' (o '+' vem depois, no DOM)", async () => {
    setup();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Cheeseburguer" })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Adicionar Cheeseburguer" })).toHaveFocus();
  });

  it("carrega o id do produto no botão do nome, para o foco poder voltar a ele (WEB-22)", () => {
    const { container } = setup();
    const target = container.querySelector('[data-product-id="p1"]');
    expect(target).toBe(screen.getByRole("button", { name: "Cheeseburguer" }));
  });

  it("a foto é decorativa (alt vazio, o nome está ao lado) e carrega preguiçosa", () => {
    const { container } = setup();
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveAttribute("loading", "lazy");
  });
});

describe("ProductListItem: regra do '+' (spec 12 §3, Leonardo)", () => {
  it("(a) sem adicionais: com 0 no carrinho é só o '+'; com itens vira stepper com quantidade", () => {
    setup({ quantityInCart: 3 });
    const stepper = screen.getByRole("group", { name: "Quantidade de Cheeseburguer" });
    expect(within(stepper).getByText("3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tirar um Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mais um Cheeseburguer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Adicionar / })).not.toBeInTheDocument();
  });

  it("(a) o stepper adiciona e tira uma unidade", async () => {
    const { onQuickAdd, onRemoveOne } = setup({ quantityInCart: 2 });
    await userEvent.click(screen.getByRole("button", { name: "Mais um Cheeseburguer" }));
    await userEvent.click(screen.getByRole("button", { name: "Tirar um Cheeseburguer" }));
    expect(onQuickAdd).toHaveBeenCalledTimes(1);
    expect(onRemoveOne).toHaveBeenCalledTimes(1);
  });

  it("(b) só adicionais opcionais: o '+' adiciona 1 unidade simples (não abre o detalhe) e o cartão diz 'Tem opções'", async () => {
    const { onQuickAdd, onOpen } = setup({ product: withOptions });
    expect(screen.getByText("Tem opções")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Adicionar Cheeseburguer" }));
    expect(onQuickAdd).toHaveBeenCalledWith(withOptions);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("(b) com opções e itens no carrinho: selo com a quantidade total e SEM '−' no cartão", () => {
    setup({ product: withOptions, quantityInCart: 3 });
    expect(screen.getByRole("button", { name: "Adicionar Cheeseburguer (3 no carrinho)" })).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Tirar um/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /Quantidade/ })).not.toBeInTheDocument();
  });

  it("(d) loja que não aceita pedidos: sem '+' nem stepper, mas o produto ainda abre", async () => {
    const { onOpen } = setup({ closed: true, quantityInCart: 2 });
    expect(screen.queryByRole("button", { name: /Adicionar|Mais um|Tirar um/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cheeseburguer" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("ProductListItem: sem foto, foto quebrada e linha compacta", () => {
  it("sem foto: bloco de tinta com o emoji da categoria; o '+' continua", () => {
    const { container } = setup({ product: { ...base, imageUrl: null } as Product, categoryIcon: "🍔" });
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".loja__item-media--tint")).toBeInTheDocument();
    expect(screen.getByText("🍔")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("button", { name: "Adicionar Cheeseburguer" })).toBeInTheDocument();
  });

  it("sem foto e sem emoji da categoria: usa um prato genérico, nunca vazio", () => {
    setup({ product: { ...base, imageUrl: null } as Product, categoryIcon: null });
    expect(screen.getByText("🍽️")).toBeInTheDocument();
  });

  it("foto quebrada vira o estado 'sem foto' (nunca ícone de imagem quebrada)", () => {
    const { container } = setup({ categoryIcon: "🍔" });
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector(".loja__item-media--tint")).toBeInTheDocument();
  });

  it("linha compacta: sem bloco de foto, com nome, descrição, preço e '+'", () => {
    const { container } = setup({ compact: true });
    expect(container.querySelector(".loja__item--compact")).toBeInTheDocument();
    expect(container.querySelector(".loja__item-media")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByText("Pão, carne e queijo")).toBeInTheDocument();
    expect(screen.getByText("R$ 15,00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Adicionar Cheeseburguer" })).toBeInTheDocument();
  });

  it("não desenha o que a API ainda não manda: sem selo de esgotado nem tempo estimado", () => {
    setup();
    expect(screen.queryByText(/esgotado/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/min\b/)).not.toBeInTheDocument();
  });
});
