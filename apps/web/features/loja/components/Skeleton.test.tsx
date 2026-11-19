import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MenuSkeleton, Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("o bloco é decorativo: leitor de tela não o percorre", () => {
    const { container } = render(<Skeleton width={120} height={16} radius={8} />);
    const block = container.querySelector(".loja__skeleton") as HTMLElement;
    expect(block).toHaveAttribute("aria-hidden", "true");
    expect(block.style.width).toBe("120px");
    expect(block.style.getPropertyValue("--loja-skeleton-radius")).toBe("8px");
  });

  it("o conjunto anuncia UMA vez que está carregando, em vez de um aviso por bloco", () => {
    const { container } = render(<MenuSkeleton products={3} />);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy");
    expect(screen.getByRole("status").closest('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector(".loja__skeleton-menu")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Carregando o cardápio…")).toBeInTheDocument();
    // capa + nome + endereço + 3 produtos
    expect(container.querySelectorAll(".loja__skeleton")).toHaveLength(6);
  });
});
