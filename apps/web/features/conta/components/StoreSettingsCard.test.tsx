import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StoreSettings } from "@/core/domain/store";
import { StoreSettingsCard } from "./StoreSettingsCard";

const store = {
  slug: "loja-teste", code: "ABC", name: "Loja Teste", logoUrl: null, coverImageUrl: null, primaryColor: null, address: null,
  whatsapp: null, openingHours: null, minOrderCents: null, deliveryFeeCents: 0, deliveryEnabled: true, pickupEnabled: true,
} as unknown as StoreSettings;

function setup() {
  const onSave = vi.fn().mockResolvedValue({ kind: "ok", text: "Salvo" });
  render(<StoreSettingsCard store={store} onSave={onSave} />);
  return { onSave };
}

describe("StoreSettingsCard: logo e capa só em https (WEB-22, SEC-14/ST-17)", () => {
  it("logo em http:// não salva e a mensagem fica no campo do logo", async () => {
    const { onSave } = setup();
    await userEvent.type(screen.getByLabelText("URL do logo (opcional)"), "http://exemplo.com/logo.png");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    const logo = screen.getByLabelText("URL do logo (opcional)");
    expect(logo).toHaveFocus();
    expect(logo).toHaveAccessibleDescription("Use um endereço que comece com https://");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("capa inválida: o foco vai ao primeiro campo com erro, e só a capa reclama", async () => {
    const { onSave } = setup();
    await userEvent.type(screen.getByLabelText("URL da capa do cardápio (opcional)"), "exemplo.com/capa.png");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(screen.getByLabelText("URL da capa do cardápio (opcional)")).toHaveFocus();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("https nos dois salva", async () => {
    const { onSave } = setup();
    await userEvent.type(screen.getByLabelText("URL do logo (opcional)"), "https://exemplo.com/logo.png");
    await userEvent.type(screen.getByLabelText("URL da capa do cardápio (opcional)"), "https://exemplo.com/capa.png");
    await userEvent.click(screen.getByRole("button", { name: "Salvar" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
