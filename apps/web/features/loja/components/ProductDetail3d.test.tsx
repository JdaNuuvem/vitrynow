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

  // TAMANHO REAL: um toque abre a câmera; o botão só existe com a medida real e num celular com câmera de AR
  const withUa = (userAgent: string) => Object.defineProperty(window.navigator, "userAgent", { value: userAgent, configurable: true });
  const sized = { ...base, model3dUrl: "/media/stores/s/3d-x.glb", model3dWidthMm: 180 };
  it("celular Android + medida real: botão 'Ver na mesa em tamanho real' sobre a foto", async () => {
    withUa("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120 Mobile");
    render(<ProductDetailScreen product={sized} logoUrl={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "Ver na mesa em tamanho real" })).toBeInTheDocument();
  });
  it("sem a medida real ou no computador: sem botão de câmera", async () => {
    withUa("Mozilla/5.0 (Linux; Android 14; Pixel 7) Chrome/120 Mobile");
    const { unmount } = render(<ProductDetailScreen product={{ ...sized, model3dWidthMm: null }} logoUrl={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    await screen.findByRole("button", { name: "Ver em 3D" });
    expect(screen.queryByRole("button", { name: "Ver na mesa em tamanho real" })).not.toBeInTheDocument();
    unmount();
    withUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120");
    render(<ProductDetailScreen product={sized} logoUrl={null} onClose={vi.fn()} onConfirm={vi.fn()} />);
    await screen.findByRole("button", { name: "Ver em 3D" });
    expect(screen.queryByRole("button", { name: "Ver na mesa em tamanho real" })).not.toBeInTheDocument();
  });
});
