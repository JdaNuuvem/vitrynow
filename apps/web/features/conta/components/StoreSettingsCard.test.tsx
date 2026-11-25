import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StoreSettings } from "@/core/domain/store";
import { AppearanceEditor } from "../aparencia/AppearanceEditor";
import { StoreSettingsCard } from "./StoreSettingsCard";

const store = {
  slug: "loja-teste", code: "ABC", name: "Loja Teste", logoUrl: null, coverImageUrl: null, primaryColor: null, address: null,
  whatsapp: null, openingHours: null, minOrderCents: null, deliveryFeeCents: 0, deliveryEnabled: true, pickupEnabled: true,
} as unknown as StoreSettings;

function setup() {
  const onSave = vi.fn().mockResolvedValue({ kind: "ok", text: "Salvo" });
  render(<AppearanceEditor store={store} canEdit readOnly={false} onSave={onSave} />);
  return { onSave };
}

describe("Configurações da loja e aparência do cardápio", () => {
  it("logo em http:// não salva e a mensagem fica no campo do logo", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("URL do logotipo (opcional)"), { target: { value: "http://exemplo.com/logo.png" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar aparência" }));
    const logo = screen.getByLabelText("URL do logotipo (opcional)");
    expect(logo).toHaveFocus();
    expect(logo).toHaveAccessibleDescription("Use um endereço que comece com https://");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("capa inválida: o foco vai ao primeiro campo com erro, e só a capa reclama", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("URL do banner (opcional)"), { target: { value: "exemplo.com/capa.png" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar aparência" }));
    expect(screen.getByLabelText("URL do banner (opcional)")).toHaveFocus();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("https nos dois salva", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("URL do logotipo (opcional)"), { target: { value: "https://exemplo.com/logo.png" } });
    fireEvent.change(screen.getByLabelText("URL do banner (opcional)"), { target: { value: "https://exemplo.com/capa.png" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar aparência" }));
    expect(onSave).toHaveBeenCalledWith({ logoUrl: "https://exemplo.com/logo.png", coverImageUrl: "https://exemplo.com/capa.png" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("altera o nome da loja sem regravar a capa local do cadastro", async () => {
    const onSave = vi.fn().mockResolvedValue({ kind: "ok", text: "Salvo" });
    render(<StoreSettingsCard store={{ ...store, coverImageUrl: "/local-ramenku/fachada.webp" }} onSave={onSave} />);
    const name = screen.getByLabelText("Nome da loja");
    fireEvent.change(name, { target: { value: "Ramenku Centro" } });
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const [input] = onSave.mock.calls[0];
    expect(input.name).toBe("Ramenku Centro");
    expect(input).not.toHaveProperty("coverImageUrl");
    expect(input).not.toHaveProperty("primaryColor");
  });

  it("reflete o contraste na prévia e envia só a cor alterada", async () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByLabelText("Código HEX"), { target: { value: "#f4ce6d" } });
    const preview = screen.getByRole("region", { name: "Prévia do cardápio" });
    expect(preview.style.getPropertyValue("--loja-accent")).toBe("#f4ce6d");
    expect(preview.style.getPropertyValue("--loja-accent-on")).toBe("#111111");
    await userEvent.click(screen.getByRole("button", { name: "Salvar aparência" }));
    expect(onSave).toHaveBeenCalledWith({ primaryColor: "#f4ce6d" });
  });

  it("permite que funcionários vejam a prévia com as opções de edição bloqueadas", () => {
    const onSave = vi.fn();
    render(<AppearanceEditor store={store} canEdit={false} readOnly onSave={onSave} />);
    expect(screen.getByRole("region", { name: "Prévia do cardápio" })).toBeInTheDocument();
    expect(screen.getByLabelText("Código HEX")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Enviar imagem de banner principal" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Salvar aparência" })).not.toBeInTheDocument();
  });
});
