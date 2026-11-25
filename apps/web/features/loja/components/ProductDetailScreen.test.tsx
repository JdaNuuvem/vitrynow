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

it("informa que o produto esgotou mesmo quando a loja aceita pedidos", () => {
  setup({ product: { ...product, soldOut: true } });
  expect(screen.getByRole("status")).toHaveTextContent("Este produto está esgotado.");
  expect(screen.queryByRole("button", { name: /Adicionar/ })).not.toBeInTheDocument();
});

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
  it("exige uma variação de preço-base e cobra cada unidade de uma opção adicional", async () => {
    const { onConfirm } = setup({ product: { ...product, fromPriceCents: 1200, optionGroups: [
      { id: "size", name: "Tamanho", helpText: null, priceMode: "BASE", minSelect: 1, maxSelect: 1, maxPerOption: 1,
        options: [{ id: "p", name: "Pequeno", priceCents: 1200 }, { id: "g", name: "Grande", priceCents: 2400 }] },
      { id: "sauces", name: "Molhos", helpText: null, priceMode: "SUM", minSelect: 0, maxSelect: 2, maxPerOption: 2,
        options: [{ id: "bbq", name: "Barbecue", priceCents: 300 }] },
    ] } });
    const add = screen.getByRole("button", { name: /^Adicionar · R\$/ });
    expect(add).toBeDisabled();
    await userEvent.click(screen.getByRole("radio", { name: /Grande/ }));
    const moreSauce = screen.getByRole("button", { name: "Adicionar uma unidade de Barbecue" });
    await userEvent.click(moreSauce);
    await userEvent.click(moreSauce);
    expect(moreSauce).toBeDisabled();
    expect(add).toHaveTextContent("R$ 30,00");
    await userEvent.click(add);
    expect(onConfirm).toHaveBeenCalledWith({ quantity: 1, additionalIds: [], notes: "", optionSelections: [
      { optionId: "g", quantity: 1 }, { optionId: "bbq", quantity: 2 },
    ] });
  });

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

describe("ProductDetailScreen: foco e teclado (WEB-22, F2)", () => {
  it("abre com o foco no título do produto, não no body", () => {
    setup();
    expect(screen.getByRole("heading", { level: 1, name: "Cheeseburguer" })).toHaveFocus();
  });

  it("Esc volta ao cardápio", async () => {
    const { onClose } = setup();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc dentro da observação já escrita não joga o texto fora", async () => {
    const { onClose } = setup();
    await userEvent.type(screen.getByLabelText("Alguma observação?"), "sem cebola");
    await userEvent.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Esc na observação vazia ainda volta ao cardápio", async () => {
    const { onClose } = setup();
    screen.getByLabelText("Alguma observação?").focus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
