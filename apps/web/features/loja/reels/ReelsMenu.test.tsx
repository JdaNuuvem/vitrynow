import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Category } from "@/core/domain/storefront";
import { ReelsMenu } from "./ReelsMenu";
import type { PublicReel } from "./useReels";

// MODELO REELS: um prato por tela; vídeo quando há Reel; abas de categoria; "Adicionar" usa o carrinho da página.
const categories = [
  { id: "c1", name: "Ramen", icon: null, products: [
    { id: "p1", name: "Shoyu", description: "Caldo de soja", imageUrl: "/img/shoyu.webp", priceCents: 3990, additionals: [] },
    { id: "p2", name: "Tonkotsu", description: null, imageUrl: null, priceCents: 4290, additionals: [] },
  ] },
  { id: "c2", name: "Bebidas", icon: null, products: [{ id: "p3", name: "Chá gelado", description: null, imageUrl: null, priceCents: 990, soldOut: true, additionals: [] }] },
] as unknown as Category[];
const reels: PublicReel[] = [{ id: "r1", videoUrl: "/media/v.mp4", posterUrl: "/media/p.webp", durationMs: 8000, product: { id: "p2", name: "Tonkotsu", description: null, priceCents: 4290, promoCents: null, imageUrl: null, soldOut: false } }];

function setup(closed = false) {
  const onAdd = vi.fn();
  const onOpen = vi.fn();
  const onShowList = vi.fn();
  const view = render(<ReelsMenu storeName="Ramenku" logoUrl={null} categories={categories} reels={reels} quantityByProduct={{ p1: 2 }} closed={closed} onAdd={onAdd} onOpen={onOpen} onShowList={onShowList} />);
  return { onAdd, onOpen, onShowList, ...view };
}

describe("cardápio no modelo Reels", () => {
  it("um prato por tela; dentro da categoria, o prato com vídeo vem primeiro; vídeo só onde há Reel", () => {
    const { container } = setup();
    const names = [...container.querySelectorAll(".reels-menu__slide h3")].map((h) => h.textContent);
    expect(names).toEqual(["Tonkotsu", "Shoyu", "Chá gelado"]);
    expect(container.querySelectorAll("video")).toHaveLength(1);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Ramen", "Bebidas"]);
  });
  it("Adicionar chama o carrinho da página (com a quantidade já no carrinho); esgotado não adiciona; Detalhes abre o produto", () => {
    const { onAdd, onOpen } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar Shoyu" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ id: "p1" }));
    expect(screen.getByRole("button", { name: "Adicionar Shoyu" })).toHaveTextContent("Adicionar (2)");
    expect(screen.getByRole("button", { name: "Adicionar Chá gelado" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("button", { name: "Detalhes" })[0]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "p2" }));
  });
  it("loja fechada: botão mostra 'Fechado' e não adiciona; 'Ver em lista' troca para o clássico", () => {
    const { onAdd, onShowList } = setup(true);
    const add = screen.getByRole("button", { name: "Adicionar Shoyu" });
    expect(add).toBeDisabled();
    expect(add).toHaveTextContent("Fechado");
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver em lista" }));
    expect(onShowList).toHaveBeenCalled();
  });
});
