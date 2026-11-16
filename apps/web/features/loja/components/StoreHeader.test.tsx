import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StoreInfo } from "@/core/domain/storefront";
import { StoreHeader } from "./StoreHeader";

const store: StoreInfo = {
  name: "Pizzaria Boa Massa", slug: "boa", logoUrl: "https://x/logo.png", coverImageUrl: "https://x/capa.png", primaryColor: null,
  address: "Rua A, 1", whatsapp: "5521999999999", openingHours: "Seg a sex, 18h às 23h", minOrderCents: null,
  deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 0,
};

const setup = (over: Partial<StoreInfo> = {}) => render(<StoreHeader store={{ ...store, ...over }} isOpenNow={true} onOpenSearch={vi.fn()} />);

describe("StoreHeader", () => {
  it("capa quebrada some em vez de mostrar o ícone de imagem quebrada", () => {
    const { container } = setup();
    const cover = container.querySelector(".loja__cover img") as HTMLImageElement;
    expect(cover).toBeInTheDocument();
    fireEvent.error(cover);
    expect(container.querySelector(".loja__cover img")).not.toBeInTheDocument();
  });

  it("logo quebrado some, mas o nome da loja continua na tela", () => {
    const { container } = setup();
    fireEvent.error(screen.getByAltText("Pizzaria Boa Massa"));
    expect(container.querySelector(".loja__logo img")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pizzaria Boa Massa" })).toBeInTheDocument();
  });

  it("'Ver horários' informa se está expandido e mostra o texto ao abrir", async () => {
    setup();
    const button = screen.getByRole("button", { name: /Ver horários/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Seg a sex, 18h às 23h")).toBeInTheDocument();
  });

  it("o link do WhatsApp tem nome acessível e avisa que abre em outra aba", () => {
    setup();
    const link = screen.getByRole("link", { name: /WhatsApp/ });
    expect(link).toHaveAttribute("href", "https://wa.me/5521999999999");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("sem WhatsApp não há link", () => {
    setup({ whatsapp: null });
    expect(screen.queryByRole("link", { name: /WhatsApp/ })).not.toBeInTheDocument();
  });
});
