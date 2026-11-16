import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Category, Product } from "@/core/domain/catalog";
import { CategorySection } from "./CategorySection";

const product = (over: Partial<Product> = {}): Product => ({
  id: "p1",
  name: "Refrigerante lata",
  description: "Gelado",
  imageUrl: "https://x/foto.png",
  priceCents: 600,
  active: true,
  featured: false,
  additionals: [{ id: "a1", name: "Gelo", priceCents: 0 }],
  ...over,
});
const category = (products: Product[]): Category => ({ id: "c1", name: "Bebidas", icon: null, products });

function setup(cat: Category, over: { del?: ReturnType<typeof vi.fn>; delCat?: ReturnType<typeof vi.fn>; save?: ReturnType<typeof vi.fn> } = {}) {
  const onDeleteProduct = over.del ?? vi.fn().mockResolvedValue(null);
  const onDeleteCategory = over.delCat ?? vi.fn().mockResolvedValue(null);
  const onSaveProduct = over.save ?? vi.fn().mockResolvedValue(null);
  render(
    <CategorySection category={cat} onUpdateIcon={vi.fn()} onDeleteCategory={onDeleteCategory} onDeleteProduct={onDeleteProduct} onSaveProduct={onSaveProduct} />,
  );
  return { onDeleteProduct, onDeleteCategory, onSaveProduct };
}

describe("excluir produto (UX-19): nunca no primeiro toque", () => {
  it("tocar em 'excluir' NÃO apaga: abre uma janela de confirmação", async () => {
    const { onDeleteProduct, onSaveProduct } = setup(category([product()]));
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    expect(onDeleteProduct).not.toHaveBeenCalled();
    expect(onSaveProduct).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /Ocultar ou excluir Refrigerante lata\?/ })).toBeInTheDocument();
  });

  it("o botão principal OCULTA (reversível) e mantém foto, adicionais e preço", async () => {
    const { onSaveProduct, onDeleteProduct } = setup(category([product()]));
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    await userEvent.click(screen.getByRole("button", { name: "Ocultar do cardápio" }));
    expect(onDeleteProduct).not.toHaveBeenCalled();
    expect(onSaveProduct).toHaveBeenCalledTimes(1);
    const [input, id] = onSaveProduct.mock.calls[0];
    expect(id).toBe("p1");
    expect(input).toMatchObject({ categoryId: "c1", name: "Refrigerante lata", priceCents: 600, imageUrl: "https://x/foto.png", active: false });
    expect(input.additionals).toHaveLength(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("'Excluir de vez' é a segunda opção e só então apaga", async () => {
    const { onDeleteProduct } = setup(category([product()]));
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("não dá para desfazer");
    await userEvent.click(screen.getByRole("button", { name: "Excluir de vez" }));
    expect(onDeleteProduct).toHaveBeenCalledWith("p1");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("'Voltar' fecha sem fazer nada", async () => {
    const { onDeleteProduct, onSaveProduct } = setup(category([product()]));
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDeleteProduct).not.toHaveBeenCalled();
    expect(onSaveProduct).not.toHaveBeenCalled();
  });

  it("Esc fecha sem apagar e o foco volta ao botão 'excluir'", async () => {
    const { onDeleteProduct } = setup(category([product()]));
    const trigger = screen.getByRole("button", { name: "excluir" });
    await userEvent.click(trigger);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDeleteProduct).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
  });

  it("produto já oculto: o principal é excluir, sem oferecer ocultar de novo", async () => {
    const { onDeleteProduct, onSaveProduct } = setup(category([product({ active: false })]));
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    expect(screen.getByRole("dialog", { name: "Excluir Refrigerante lata?" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ocultar do cardápio" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Excluir de vez" }));
    expect(onDeleteProduct).toHaveBeenCalledWith("p1");
    expect(onSaveProduct).not.toHaveBeenCalled();
  });

  it("erro da API aparece dentro da janela como alerta, sem alert() nativo, e a janela continua aberta", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const del = vi.fn().mockResolvedValue("Este produto está em um pedido em aberto.");
    setup(category([product()]), { del });
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    await userEvent.click(screen.getByRole("button", { name: "Excluir de vez" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Este produto está em um pedido em aberto.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("falha ao ocultar também aparece dentro da janela", async () => {
    const save = vi.fn().mockResolvedValue("Não foi possível salvar.");
    setup(category([product()]), { save });
    await userEvent.click(screen.getByRole("button", { name: "excluir" }));
    await userEvent.click(screen.getByRole("button", { name: "Ocultar do cardápio" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível salvar.");
  });
});

describe("excluir categoria (UX-19)", () => {
  it("categoria vazia: pede confirmação, escreve o efeito e só então exclui", async () => {
    const { onDeleteCategory } = setup(category([]));
    await userEvent.click(screen.getByRole("button", { name: "excluir categoria" }));
    expect(onDeleteCategory).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Excluir a categoria Bebidas?" })).toHaveTextContent("não dá para desfazer");
    await userEvent.click(screen.getByRole("button", { name: "Excluir categoria" }));
    expect(onDeleteCategory).toHaveBeenCalledWith("c1");
  });

  it("categoria com produtos: só explica, sem botão de excluir nem chamada à API", async () => {
    const { onDeleteCategory } = setup(category([product(), product({ id: "p2", name: "Suco" })]));
    await userEvent.click(screen.getByRole("button", { name: "excluir categoria" }));
    const dialog = screen.getByRole("dialog", { name: "Não dá para excluir Bebidas" });
    expect(dialog).toHaveTextContent("ainda tem 2 produtos");
    expect(screen.queryByRole("button", { name: "Excluir categoria" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Voltar" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Entendi" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onDeleteCategory).not.toHaveBeenCalled();
  });

  it("erro da API ao excluir categoria fica na janela", async () => {
    const delCat = vi.fn().mockResolvedValue("Categoria em uso.");
    setup(category([]), { delCat });
    await userEvent.click(screen.getByRole("button", { name: "excluir categoria" }));
    await userEvent.click(screen.getByRole("button", { name: "Excluir categoria" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Categoria em uso.");
  });
});
