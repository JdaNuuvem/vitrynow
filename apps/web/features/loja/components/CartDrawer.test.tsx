import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CartLine, Product } from "@/core/domain/storefront";
import { CartDrawer } from "./CartDrawer";

const burger = {
  id: "p1",
  name: "Cheeseburguer",
  priceCents: 1500,
  additionals: [{ id: "a1", name: "Bacon extra", priceCents: 400 }],
} as unknown as Product;
const products = new Map([["p1", burger]]);
const line: CartLine = { productId: "p1", quantity: 2, additionalIds: ["a1"], notes: "sem cebola" };

function setup(over: Partial<React.ComponentProps<typeof CartDrawer>> = {}) {
  const handlers = { onChangeQuantity: vi.fn(), onClose: vi.fn(), onContinue: vi.fn() };
  render(
    <CartDrawer
      cart={[line]}
      productsById={products}
      lineTotalCents={() => 3800}
      totalCents={3800}
      minOrderCents={null}
      closed={false}
      totalLabel="Subtotal"
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

describe("CartDrawer", () => {
  it("é um diálogo 'Seu carrinho' com a lista de itens", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Seu carrinho" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Itens do carrinho" })).toBeInTheDocument();
    expect(screen.getByText("Cheeseburguer")).toBeInTheDocument();
    expect(screen.getByText("Bacon extra")).toBeInTheDocument();
    expect(screen.getByText('"sem cebola"')).toBeInTheDocument();
    expect(screen.getAllByText("R$ 38,00").length).toBeGreaterThan(0);
  });

  it("os botões de quantidade e remover têm nome com o produto", () => {
    setup();
    expect(screen.getByRole("button", { name: "Diminuir quantidade de Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aumentar quantidade de Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remover Cheeseburguer" })).toBeInTheDocument();
  });

  it("− e + mudam 1; remover tira a linha inteira", async () => {
    const { onChangeQuantity } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Diminuir quantidade de Cheeseburguer" }));
    await userEvent.click(screen.getByRole("button", { name: "Aumentar quantidade de Cheeseburguer" }));
    await userEvent.click(screen.getByRole("button", { name: "Remover Cheeseburguer" }));
    expect(onChangeQuantity.mock.calls).toEqual([
      [0, -1],
      [0, 1],
      [0, -2],
    ]);
  });

  it("Continuar chama onContinue", async () => {
    const { onContinue } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("carrinho vazio avisa e desabilita Continuar", () => {
    setup({ cart: [], totalCents: 0 });
    expect(screen.getByText("Carrinho vazio.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("abaixo do pedido mínimo mostra quanto falta e bloqueia", () => {
    setup({ minOrderCents: 5000 });
    expect(screen.getByText(/Faltam R\$ 12,00 para o pedido mínimo de R\$ 50,00/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("loja fechada avisa com o texto oficial e bloqueia", () => {
    setup({ closed: true });
    expect(screen.getByText("Esta loja não está recebendo pedidos agora.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continuar" })).toBeDisabled();
  });

  it("Esc fecha e o botão Fechar tem nome acessível", async () => {
    const { onClose } = setup();
    expect(screen.getByRole("button", { name: "Fechar" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
