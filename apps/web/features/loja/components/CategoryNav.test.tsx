import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "@/core/domain/storefront";
import { CategoryChips, StickyBar } from "./CategoryNav";

const categories = [
  { id: "c1", name: "Lanches", icon: "🍔", products: [] },
  { id: "c2", name: "Bebidas", icon: null, products: [] },
  { id: "c3", name: "Sobremesas", icon: "🍰", products: [] },
] as unknown as Category[];

const identity = { name: "Pizzaria Boa Massa", logoUrl: null, initials: "PB" };

function setup(over: Partial<React.ComponentProps<typeof CategoryChips>> = {}) {
  const onSelect = vi.fn();
  const onOpenSearch = vi.fn();
  render(<CategoryChips categories={categories} activeCategoryId="c1" stuck={false} identity={identity} onSelect={onSelect} onOpenSearch={onOpenSearch} {...over} />);
  return { onSelect, onOpenSearch };
}

describe("CategoryChips (spec 12 §2.1, §9)", () => {
  it("é uma navegação 'Categorias' com um botão por categoria, com o emoji só como enfeite", () => {
    setup();
    const nav = screen.getByRole("navigation", { name: "Categorias" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Lanches" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bebidas" })).toBeInTheDocument();
    expect(screen.getByText("🍔")).toHaveAttribute("aria-hidden", "true");
  });

  it("só o chip ativo tem aria-current='true'", () => {
    setup({ activeCategoryId: "c2" });
    expect(screen.getByRole("button", { name: "Bebidas" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Lanches" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Sobremesas" })).not.toHaveAttribute("aria-current");
  });

  it("tocar num chip avisa qual categoria", async () => {
    const { onSelect } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Sobremesas" }));
    expect(onSelect).toHaveBeenCalledWith("c3");
  });

  it("trocar o chip ativo NÃO move o foco (o scrollspy nunca mexe no foco)", () => {
    const props = { categories, stuck: false, identity, onSelect: vi.fn(), onOpenSearch: vi.fn() };
    const { rerender } = render(<CategoryChips {...props} activeCategoryId="c1" />);
    const chip = screen.getByRole("button", { name: "Bebidas" });
    chip.focus();
    rerender(<CategoryChips {...props} activeCategoryId="c3" />);
    expect(screen.getByRole("button", { name: "Sobremesas" })).toHaveAttribute("aria-current", "true");
    expect(chip).toHaveFocus();
  });

  it("centraliza o chip ativo dentro da linha, sem rolagem suave", () => {
    const { rerender } = render(<CategoryChips categories={categories} activeCategoryId="c1" stuck={false} identity={identity} onSelect={vi.fn()} onOpenSearch={vi.fn()} />);
    const row = document.querySelector(".loja__chips") as HTMLElement;
    Object.defineProperty(row, "clientWidth", { value: 300, configurable: true });
    const chip = screen.getByRole("button", { name: "Sobremesas" });
    Object.defineProperty(chip, "offsetLeft", { value: 500, configurable: true });
    Object.defineProperty(chip, "offsetWidth", { value: 100, configurable: true });
    rerender(<CategoryChips categories={categories} activeCategoryId="c3" stuck={false} identity={identity} onSelect={vi.fn()} onOpenSearch={vi.fn()} />);
    expect(row.scrollLeft).toBe(400); // 500 − (300 − 100) / 2
  });

  it("com uma categoria só (ou nenhuma) a barra não aparece", () => {
    const { container } = render(<CategoryChips categories={[categories[0]]} activeCategoryId="c1" stuck={false} identity={identity} onSelect={vi.fn()} onOpenSearch={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fixa (stuck): ganha a classe que a prende ao topo e o botão de buscar entra na ordem do Tab", () => {
    setup({ stuck: true });
    expect(screen.getByRole("navigation", { name: "Categorias" })).toHaveClass("loja__chipsbox--stuck");
    expect(screen.getByRole("button", { name: "Pesquisar no cardápio" })).toHaveAttribute("tabindex", "0");
  });

  it("não fixa: o buscar do sticky fica fora do Tab", () => {
    setup({ stuck: false });
    expect(screen.getByRole("button", { name: "Pesquisar no cardápio" })).toHaveAttribute("tabindex", "-1");
  });

  it("logo e nome da identidade ficam escondidos do leitor de tela (já estão no título)", () => {
    const { container } = render(<CategoryChips categories={categories} activeCategoryId="c1" stuck identity={identity} onSelect={vi.fn()} onOpenSearch={vi.fn()} />);
    expect(container.querySelector(".loja__stick-id")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("StickyBar (barra de 56 px no celular)", () => {
  it("escondida: aria-hidden e o buscar fora do Tab", () => {
    const { container } = render(<StickyBar visible={false} identity={identity} onOpenSearch={vi.fn()} />);
    expect(container.querySelector("header")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("Pizzaria Boa Massa")).toBeInTheDocument();
    expect(container.querySelector("button")).toHaveAttribute("tabindex", "-1");
  });

  it("visível: mostra logo, nome e o botão de buscar de 44 px que abre a busca", async () => {
    const onOpenSearch = vi.fn();
    const { container } = render(<StickyBar visible identity={identity} onOpenSearch={onOpenSearch} />);
    expect(container.querySelector("header")).not.toHaveAttribute("aria-hidden");
    expect(container.querySelector(".loja__bar--on")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pesquisar no cardápio" }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("sem logo mostra o monograma", () => {
    render(<StickyBar visible identity={identity} onOpenSearch={vi.fn()} />);
    expect(screen.getByText("PB")).toBeInTheDocument();
  });
});
