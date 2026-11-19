import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import { bannerForStore, type MenuBannerConfig } from "./banners";
import { LojaRoot } from "./LojaRoot";

vi.mock("./banners", async (importOriginal) => ({
  ...await importOriginal<typeof import("./banners")>(),
  bannerForStore: vi.fn(),
}));

const menu: Menu = {
  store: {
    name: "Restaurante de teste", slug: "teste", logoUrl: null, coverImageUrl: null,
    primaryColor: "#ffd54a", address: null, whatsapp: null, openingHours: null,
    minOrderCents: null, deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 0,
  },
  categories: [{ id: "pratos", name: "Pratos", icon: null, products: [{
    id: "prato", name: "Prato de teste", description: null, imageUrl: null, priceCents: 3500, additionals: [],
  }] }],
};
const banner: MenuBannerConfig = {
  id: "campanha-teste", title: "Conheça os pratos", imageUrl: "/teste.webp",
  action: { label: "Ver prato", target: { kind: "product", id: "prato" } },
};

afterEach(() => { vi.mocked(bannerForStore).mockReset(); vi.unstubAllGlobals(); });

describe("campanha no fluxo do cardápio", () => {
  it("sem campanha mantém o catálogo sem região editorial", () => {
    render(<LojaRoot slug="teste" initialMenu={menu} />);
    expect(bannerForStore).toHaveBeenCalledWith("teste");
    expect(screen.queryByRole("region", { name: banner.title })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Prato de teste" })).toBeInTheDocument();
  });

  it("CTA abre o detalhe sem adicionar e devolve foco à campanha ao voltar", async () => {
    vi.mocked(bannerForStore).mockReturnValue(banner);
    vi.stubGlobal("scrollTo", vi.fn());
    render(<LojaRoot slug="teste" initialMenu={menu} />);
    await userEvent.click(screen.getByRole("button", { name: "Ver prato" }));
    expect(screen.getByRole("heading", { level: 1, name: "Prato de teste" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Ver carrinho:/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Voltar ao cardápio" }));
    expect(screen.getByRole("button", { name: "Ver prato" })).toHaveFocus();
  });

  it("CTA de categoria usa a rolagem existente para uma seção real", async () => {
    vi.mocked(bannerForStore).mockReturnValue({ ...banner, action: { label: "Ver pratos", target: { kind: "category", id: "pratos" } } });
    const { container } = render(<LojaRoot slug="teste" initialMenu={menu} />);
    const section = container.querySelector("#categoria-pratos") as HTMLElement;
    section.scrollIntoView = vi.fn();
    await userEvent.click(screen.getByRole("button", { name: "Ver pratos" }));
    await waitFor(() => expect(section.scrollIntoView).toHaveBeenCalledTimes(1));
    expect(section).toHaveFocus();
  });

  it("campanha não esconde a disponibilidade real da loja fechada", () => {
    vi.mocked(bannerForStore).mockReturnValue(banner);
    render(<LojaRoot slug="teste" initialMenu={{ ...menu, store: { ...menu.store, acceptingOrders: false } }} />);
    expect(screen.getByText("Fechado agora")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver prato" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Adicionar Prato de teste/ })).not.toBeInTheDocument();
  });
});
