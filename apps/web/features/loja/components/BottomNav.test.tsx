import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BottomNav } from "./BottomNav";

describe("BottomNav (spec 09 §2.3)", () => {
  it("três destinos com rótulo visível: Cardápio, Buscar, Pedidos", () => {
    render(<BottomNav active="itens" onSelect={vi.fn()} />);
    for (const name of ["Cardápio", "Buscar", "Pedidos"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeInTheDocument();
      expect(button).toHaveTextContent(name); // texto real, não só aria-label
    }
    expect(screen.getByRole("navigation", { name: "Navegação do cardápio" })).toBeInTheDocument();
  });

  it("os ícones são decorativos (aria-hidden)", () => {
    const { container } = render(<BottomNav active="itens" onSelect={vi.fn()} />);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(3);
    svgs.forEach((svg) => expect(svg).toHaveAttribute("aria-hidden", "true"));
  });

  it("só a aba ativa é marcada como página atual", () => {
    render(<BottomNav active="pesquisa" onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Buscar" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Cardápio" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Pedidos" })).not.toHaveAttribute("aria-current");
  });

  it("tocar numa aba avisa qual foi (os ids internos não mudaram)", async () => {
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
    expect(screen.getByRole("button", { name: "Buscar" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("pesquisa");
  });
});
