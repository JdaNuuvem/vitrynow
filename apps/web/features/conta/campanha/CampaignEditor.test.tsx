import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CampaignDemoPage } from "./CampaignPages";

describe("Campanha do cardápio", () => {
  it("salva rascunho e publica somente na prévia local", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const user = userEvent.setup();
    try {
      render(<CampaignDemoPage />);
      const title = await screen.findByRole("textbox", { name: "Título" });
      const previewControls = screen.getByRole("group", { name: "Conteúdo exibido" });
      const published = within(previewControls).getByRole("button", { name: "Publicada" });
      expect(published).toBeDisabled();

      await user.clear(title);
      await user.click(screen.getByRole("button", { name: "Publicar na prévia" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Informe um título antes de publicar.");

      await user.type(title, "Prato especial");
      await user.click(screen.getByRole("button", { name: "Salvar rascunho" }));
      expect(await screen.findByText("Rascunho salvo.")).toBeInTheDocument();
      expect(published).toBeDisabled();
      await user.click(screen.getByRole("button", { name: "Publicar na prévia" }));
      expect(await screen.findByText("Campanha publicada.")).toBeInTheDocument();
      expect(published).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { name: "Prato especial" })).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Ver ramens" }));
      expect(await screen.findByText("O botão abre Ramens.")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Desktop" }));
      expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute("aria-pressed", "true");

      await user.click(screen.getByRole("button", { name: "Retirar publicação" }));
      expect(await screen.findByText("Campanha retirada do cardápio.")).toBeInTheDocument();
      expect(published).toBeDisabled();
      expect(title).toHaveValue("Prato especial");
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      fetch.mockRestore();
    }
  });
});
