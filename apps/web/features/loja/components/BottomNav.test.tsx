import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

describe("BottomNav (acessibilidade, página 1)", () => {
  it("as três abas têm nome acessível, mesmo as que mostram só o ícone", () => {
    render(<BottomNav active="itens" onSelect={vi.fn()} />);
    for (const name of ["Itens", "Pesquisa", "Pedidos"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("navigation", { name: "Navegação do cardápio" })).toBeInTheDocument();
  });

  it("só a aba ativa é marcada como página atual", () => {
    render(<BottomNav active="pesquisa" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Pesquisa" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Itens" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Pedidos" })).not.toHaveAttribute("aria-current");
  });

  it("tocar numa aba avisa qual foi", async () => {
    const onSelect = vi.fn();
    render(<BottomNav active="itens" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("button", { name: "Pedidos" }));
    expect(onSelect).toHaveBeenCalledWith("pedidos");
  });

  it("funciona só pelo teclado (Tab até a aba e Enter)", async () => {
    const onSelect = vi.fn();
    render(<BottomNav active="itens" onSelect={onSelect} />);
    await userEvent.tab();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Pesquisa" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("pesquisa");
  });
});
