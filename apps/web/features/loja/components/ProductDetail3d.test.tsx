import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/domain/storefront";
import { ProductDetailScreen } from "./ProductDetailScreen";

// PRATO 3D no cardápio: o botão "Ver em 3D" só existe quando o dono publicou o modelo.
const base: Product = { id: "p1", name: "Ramen", description: "Caldo de 12 h", imageUrl: null, priceCents: 4500, additionals: [] };

describe("detalhe do produto — prato 3D", () => {
  it("sem modelo publicado: nada de 3D", () => {
    render(<ProductDetailScreen product={base} logoUrl={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Ver em 3D" })).not.toBeInTheDocument();
  });
  it("com modelo publicado: botão 'Ver em 3D' sobre a foto", () => {
    render(<ProductDetailScreen product={{ ...base, model3dUrl: "/media/stores/s/3d-x.glb" }} logoUrl={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Ver em 3D" });
    expect(button).toHaveAttribute("aria-pressed", "false");
  });
});
