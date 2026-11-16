import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/domain/storefront";
import { ProductDetailScreen } from "./ProductDetailScreen";

const product = {
  id: "p1",
  name: "Cheeseburguer",
  description: "Pão, carne e queijo",
  imageUrl: null,
  priceCents: 1500,
  active: true,
  featured: false,
  additionals: [
    { id: "a1", name: "Bacon extra", priceCents: 400 },
    { id: "a2", name: "Ovo", priceCents: 200 },
  ],
} as unknown as Product;

function setup(over: Partial<React.ComponentProps<typeof ProductDetailScreen>> = {}) {
  const onClose = vi.fn();
  const onConfirm = vi.fn();
  render(<ProductDetailScreen product={product} logoUrl={null} onClose={onClose} onConfirm={onConfirm} {...over} />);
  return { onClose, onConfirm };
}

describe("ProductDetailScreen: botões nomeados (spec 09 §10.2)", () => {
  it("voltar e quantidade têm nome acessível", () => {
    setup();
    expect(screen.getByRole("button", { name: "Voltar ao cardápio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diminuir quantidade de Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aumentar quantidade de Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Quantidade" })).toBeInTheDocument();
  });

  it("o campo de observação tem rótulo ligado", () => {
    setup();
    expect(screen.getByLabelText("Alguma observação?")).toBeInTheDocument();
  });

  it("'−' começa desabilitado em 1 e habilita ao aumentar", async () => {
    setup();
    const minus = screen.getByRole("button", { name: "Diminuir quantidade de Cheeseburguer" });
    expect(minus).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Aumentar quantidade de Cheeseburguer" }));
    expect(minus).toBeEnabled();
  });
});

describe("ProductDetailScreen: escolha e total", () => {
  it("o botão Adicionar mostra o total com adicionais e quantidade", async () => {
    setup();
    await userEvent.click(screen.getByRole("checkbox", { name: /Bacon extra/ }));
    await userEvent.click(screen.getByRole("button", { name: "Aumentar quantidade de Cheeseburguer" }));
    expect(screen.getByRole("button", { name: /Adicionar/ })).toHaveTextContent("R$ 38,00");
  });

  it("confirma com quantidade, adicionais e observação sem espaços nas pontas", async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole("checkbox", { name: /Ovo/ }));
    await userEvent.type(screen.getByLabelText("Alguma observação?"), "  sem cebola  ");
    await userEvent.click(screen.getByRole("button", { name: /Adicionar/ }));
    expect(onConfirm).toHaveBeenCalledWith({ quantity: 1, additionalIds: ["a2"], notes: "sem cebola" });
  });

  it("desmarcar um adicional o tira da conta", async () => {
    setup();
    const bacon = screen.getByRole("checkbox", { name: /Bacon extra/ });
    await userEvent.click(bacon);
    await userEvent.click(bacon);
    expect(screen.getByRole("button", { name: /Adicionar/ })).toHaveTextContent("R$ 15,00");
  });

  it("voltar chama onClose", async () => {
    const { onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Voltar ao cardápio" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ProductDetailScreen: loja fechada (B3 da revisão da Da Vinci)", () => {
  it("não oferece Adicionar nem quantidade; mostra a faixa e Voltar ao cardápio", async () => {
    const { onClose, onConfirm } = setup({ closed: true });
    expect(screen.queryByRole("button", { name: /Adicionar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Quantidade" })).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Esta loja não está recebendo pedidos agora.");
    const back = screen.getAllByRole("button", { name: "Voltar ao cardápio" });
    await userEvent.click(back[back.length - 1]);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("o produto continua visível para consulta", () => {
    setup({ closed: true });
    expect(screen.getByRole("heading", { name: "Cheeseburguer" })).toBeInTheDocument();
    expect(screen.getByText("Pão, carne e queijo")).toBeInTheDocument();
  });
});
