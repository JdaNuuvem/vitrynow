import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Dish3dViewer, formatRealSize } from "./Dish3dViewer";

// a biblioteca do <model-viewer> só roda no navegador de verdade; aqui basta o elemento com os atributos
vi.mock("@google/model-viewer", () => ({}));

// PRATO 3D EM TAMANHO REAL: a câmera mostra o prato do tamanho de verdade em cima da mesa, e o cliente NÃO consegue
// aumentar nem diminuir (ar-scale="fixed"). Sem a medida, não há câmera (um tamanho inventado enganaria o cliente).
describe("visualizador 3D — tamanho real", () => {
  it("com a medida: câmera ligada, escala FIXA, pousa na superfície e mostra o tamanho", async () => {
    const { container } = render(<Dish3dViewer src="/media/stores/s/3d-x.glb" alt="Ramen em 3D" realWidthMm={180} />);
    await waitFor(() => expect(container.querySelector("model-viewer")).not.toBeNull());
    const viewer = container.querySelector("model-viewer")!;
    expect(viewer).toHaveAttribute("ar");
    expect(viewer).toHaveAttribute("ar-scale", "fixed");
    expect(viewer).toHaveAttribute("ar-placement", "floor");
    expect(viewer.getAttribute("ar-modes")).toContain("quick-look");
    expect(screen.getByText("Tamanho real: 18 cm")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver na mesa em tamanho real" })).toBeInTheDocument();
  });

  it("sem a medida: só gira na tela, sem câmera", async () => {
    const { container } = render(<Dish3dViewer src="/media/stores/s/3d-x.glb" alt="Ramen em 3D" />);
    await waitFor(() => expect(container.querySelector("model-viewer")).not.toBeNull());
    const viewer = container.querySelector("model-viewer")!;
    expect(viewer).not.toHaveAttribute("ar");
    expect(viewer).toHaveAttribute("camera-controls");
    expect(screen.queryByRole("button", { name: /Ver na mesa/ })).not.toBeInTheDocument();
  });

  it("medida em cm com meio centímetro e vírgula", () => {
    expect(formatRealSize(180)).toBe("18 cm");
    expect(formatRealSize(185)).toBe("18,5 cm");
  });
});
