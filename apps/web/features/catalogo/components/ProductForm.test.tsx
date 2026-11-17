import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProductForm } from "./ProductForm";

function setup() {
  const onSave = vi.fn().mockResolvedValue(null);
  const onClose = vi.fn();
  render(<ProductForm categoryId="c1" onSave={onSave} onClose={onClose} />);
  return { onSave, onClose };
}

async function fill(imageUrl: string) {
  await userEvent.type(screen.getByPlaceholderText("Nome"), "Suco");
  if (imageUrl) await userEvent.type(screen.getByLabelText("URL da foto do produto (opcional)"), imageUrl);
  await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
}

describe("ProductForm: foto só em https (WEB-22, SEC-14/ST-17)", () => {
  it("http:// não salva: mostra a mensagem no campo e leva o foco até ele", async () => {
    const { onSave } = setup();
    await fill("http://exemplo.com/suco.png");
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Use um endereço que comece com https://");
    const field = screen.getByLabelText("URL da foto do produto (opcional)");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Use um endereço que comece com https://");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("corrigir para https salva e some com a mensagem", async () => {
    const { onSave, onClose } = setup();
    await fill("http://exemplo.com/suco.png");
    const field = screen.getByLabelText("URL da foto do produto (opcional)");
    await userEvent.clear(field);
    await userEvent.type(field, "https://exemplo.com/suco.png");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
  });

  it("foto vazia continua valendo (campo opcional)", async () => {
    const { onSave } = setup();
    await fill("");
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
