import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoreInfo } from "@/core/domain/storefront";
import { StoreHeader } from "./StoreHeader";

const store: StoreInfo = {
  name: "Pizzaria Boa Massa", slug: "boa", logoUrl: "https://x/logo.png", coverImageUrl: "https://x/capa.png", primaryColor: null,
  address: "Rua A, 1", whatsapp: "5521999999999", openingHours: "Seg a sex, 18h às 23h", minOrderCents: null,
  deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 0,
};

const setup = (over: Partial<StoreInfo> = {}, extra: { showCategoriesHead?: boolean; onViewAllCategories?: () => void; onOpenSearch?: () => void } = {}) =>
  render(<StoreHeader store={{ ...store, ...over }} onOpenSearch={extra.onOpenSearch ?? vi.fn()} onViewAllCategories={extra.onViewAllCategories ?? vi.fn()} showCategoriesHead={extra.showCategoriesHead ?? false} />);

describe("capa (spec 09 §2.1)", () => {
  it("com capa válida usa a imagem e não o bloco vazio", () => {
    const { container } = setup();
    expect(container.querySelector(".loja__cover img")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover--empty")).not.toBeInTheDocument();
  });

  it("sem capa vira o bloco liso e baixo, sem imagem nem ícone", () => {
    const { container } = setup({ coverImageUrl: null });
    expect(container.querySelector(".loja__cover--empty")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover--compact")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover img")).not.toBeInTheDocument();
    expect(container.querySelector(".loja__cover")?.textContent).toBe("");
  });

  it("capa quebrada cai no bloco liso e não tenta de novo", () => {
    const { container } = setup();
    fireEvent.error(container.querySelector(".loja__cover img") as HTMLImageElement);
    expect(container.querySelector(".loja__cover--empty")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover--compact")).not.toBeInTheDocument();
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
    fireEvent.error(container.querySelector(".loja__logo img") as HTMLImageElement);
    expect(container.querySelector(".loja__logo--initials")).toHaveTextContent("PB");
    expect(screen.getByRole("heading", { name: "Pizzaria Boa Massa" })).toBeInTheDocument();
  });
});

describe("horário e status (spec 12 §2.5)", () => {
  it("'Ver horários' é um botão com aria-expanded e aria-controls, e mostra o texto ao abrir", async () => {
    const { container } = setup();
    const button = screen.getByRole("button", { name: /Ver horários/ });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", "loja-horarios");
    expect(container.querySelector("#loja-horarios")).not.toBeVisible();
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Seg a sex, 18h às 23h")).toBeVisible();
  });

  it("sem horário estruturado avisa que recebe pedidos, sem inventar hora de fechamento", () => {
    setup();
    expect(screen.getByText("Recebendo pedidos")).toBeInTheDocument();
    expect(screen.queryByText(/aberto agora|fecha às|fechado agora/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("loja que não aceita pedidos: 'Fechado agora' com a frase de apoio anunciada como status", () => {
    setup({ acceptingOrders: false });
    expect(screen.getByText("Fechado agora")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Esta loja não está recebendo pedidos agora.");
    expect(screen.queryByText("Recebendo pedidos")).not.toBeInTheDocument();
  });

  it("apresenta a pausa informada pela API mesmo com o interruptor ligado", () => {
    setup({ accepting: false, hours: { status: "PAUSADO", reason: "PAUSED", nextOpenAt: "2026-11-18T18:00:00Z", closesAt: null, message: "Voltamos em 15 min" } });
    expect(screen.getByText("Pedidos pausados")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Voltamos em 15 min");
  });

  it("usa o horário da loja e mostra prazo de preparo somente para modalidade habilitada", () => {
    setup({ accepting: true, hours: { status: "ABERTO", reason: null, nextOpenAt: null, closesAt: "2026-11-18T23:00:00Z", message: "Aberto até 20:00" },
      deliveryEnabled: false, prepMinutes: { delivery: 40, pickup: 15 } });
    expect(screen.getByText("Aberto até 20:00")).toBeVisible();
    expect(screen.getByText("Retirada: 15 min de preparo")).toBeVisible();
    expect(screen.queryByText(/40 min/)).not.toBeInTheDocument();
  });

  it("preserva o bloqueio geral sem exibir a mensagem do horário", () => {
    setup({ acceptingOrders: false, accepting: false, hours: { status: "PAUSADO", reason: "PAUSED", nextOpenAt: null, closesAt: null, message: "Voltamos em 15 min" } });
    expect(screen.getByRole("status")).toHaveTextContent("Esta loja não está recebendo pedidos agora.");
    expect(screen.queryByText("Voltamos em 15 min")).not.toBeInTheDocument();
  });

  it("sem horário cadastrado não há 'Ver horários'", () => {
    setup({ openingHours: null });
    expect(screen.queryByRole("button", { name: /Ver horários/ })).not.toBeInTheDocument();
  });
});

describe("identidade e condições (spec 12 §2.4)", () => {
  it("nome é o h1; endereço e a linha 'Mínimo · Entrega · Retirada' só com o que existe", () => {
    setup({ minOrderCents: 2000, deliveryFeeCents: 600 });
    expect(screen.getByRole("heading", { level: 1, name: "Pizzaria Boa Massa" })).toBeInTheDocument();
    expect(screen.getByText("Rua A, 1")).toBeInTheDocument();
    expect(screen.getByText(/Mínimo R\$\s?20,00 · Entrega R\$\s?6,00 · Retirada/)).toBeInTheDocument();
  });

  it("sem endereço nem condições, as linhas somem (sem texto inventado)", () => {
    setup({ address: null, minOrderCents: null, deliveryEnabled: false, pickupEnabled: false });
    expect(screen.queryByText(/Mínimo|Entrega|Retirada/)).not.toBeInTheDocument();
  });
});

describe("busca e categorias", () => {
  it("a busca tem 48 px de altura de alvo e abre a tela Buscar", async () => {
    const onOpenSearch = vi.fn();
    setup({}, { onOpenSearch });
    await userEvent.click(screen.getByRole("button", { name: /Pesquisar/ }));
    expect(onOpenSearch).toHaveBeenCalledTimes(1);
  });

  it("'Categorias / Ver todas ›' só aparece quando há o que escolher", async () => {
    const onViewAllCategories = vi.fn();
    const { unmount } = setup({}, { showCategoriesHead: false });
    expect(screen.queryByRole("button", { name: /Ver todas/ })).not.toBeInTheDocument();
    unmount();
    setup({}, { showCategoriesHead: true, onViewAllCategories });
    expect(screen.getByRole("heading", { level: 2, name: "Categorias" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Ver todas/ }));
    expect(onViewAllCategories).toHaveBeenCalledTimes(1);
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

describe("imagem que falha ANTES da hidratação (B1 da revisão da Da Vinci)", () => {
  afterEach(() => {
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).complete;
    delete (HTMLImageElement.prototype as unknown as Record<string, unknown>).naturalWidth;
  });

  it("capa e logo já falhos ao montar caem no bloco liso e nas iniciais, sem depender do onError", () => {
    // O navegador já terminou de falhar (complete e largura 0) quando o React hidrata: o evento passou.
    Object.defineProperty(HTMLImageElement.prototype, "complete", { configurable: true, get: () => true });
    Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", { configurable: true, get: () => 0 });
    const { container } = setup({ coverImageUrl: "http://localhost:9/nao-existe.jpg", logoUrl: "http://localhost:9/logo.png" });
    expect(container.querySelector(".loja__cover--empty")).toBeInTheDocument();
    expect(container.querySelector(".loja__cover img")).not.toBeInTheDocument();
    expect(container.querySelector(".loja__logo--initials")).toHaveTextContent("PB");
    expect(container.querySelector(".loja__logo img")).not.toBeInTheDocument();
  });

  it("o logo usa alt vazio (o nome da loja já está no título)", () => {
    const { container } = setup();
    expect(container.querySelector(".loja__logo img")).toHaveAttribute("alt", "");
  });
});
