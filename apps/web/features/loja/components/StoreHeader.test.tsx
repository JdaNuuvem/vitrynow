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

const setup = (over: Partial<StoreInfo> = {}) => render(<StoreHeader store={{ ...store, ...over }} onOpenSearch={vi.fn()} />);

describe("capa (spec 09 §2.1)", () => {
  it("com capa válida usa a imagem e não o bloco vazio", () => {
    const { container } = setup();
    expect(container.querySelector(".loja__cover img")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover--empty")).not.toBeInTheDocument();
  });

  it("sem capa vira o bloco liso e baixo, sem imagem nem ícone", () => {
    const { container } = setup({ coverImageUrl: null });
    expect(container.querySelector(".loja__cover--empty")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover img")).not.toBeInTheDocument();
    expect(container.querySelector(".loja__cover")?.textContent).toBe("");
  });

  it("capa quebrada cai no bloco liso e não tenta de novo", () => {
    const { container } = setup();
    fireEvent.error(container.querySelector(".loja__cover img") as HTMLImageElement);
    expect(container.querySelector(".loja__cover--empty")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover img")).not.toBeInTheDocument();
  });
});

describe("logo (spec 09 §2.2)", () => {
  it("sem logo mostra as iniciais, decorativas", () => {
    const { container } = setup({ logoUrl: null });
    const initials = container.querySelector(".loja__logo--initials") as HTMLElement;
    expect(initials).toHaveTextContent("PB");
    expect(initials).toHaveAttribute("aria-hidden", "true");
  });

  it("logo quebrado cai nas iniciais e o nome da loja continua na tela", () => {
    const { container } = setup();
    fireEvent.error(screen.getByAltText("Pizzaria Boa Massa"));
    expect(container.querySelector(".loja__logo--initials")).toHaveTextContent("PB");
    expect(screen.getByRole("heading", { name: "Pizzaria Boa Massa" })).toBeInTheDocument();
  });
});

describe("horário (spec 09 §2.4)", () => {
  it("a linha inteira é um botão com aria-expanded e aria-controls, e mostra o texto ao abrir", async () => {
    const { container } = setup();
    const button = screen.getByRole("button", { name: /Horário de funcionamento/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "loja-horarios");
    expect(container.querySelector("#loja-horarios")).not.toBeVisible();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Seg a sex, 18h às 23h")).toBeVisible();
  });

  it("não afirma 'aberto agora' nem 'fechado agora' (o servidor ainda não sabe: B5)", () => {
    setup();
    expect(screen.queryByText(/aberto agora|fechado agora/i)).not.toBeInTheDocument();
  });

  it("sem horário cadastrado não há linha de horário", () => {
    setup({ openingHours: null });
    expect(screen.queryByRole("button", { name: /Horário/ })).not.toBeInTheDocument();
  });
});

describe("contato", () => {
  it("o link do WhatsApp tem nome acessível", () => {
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
