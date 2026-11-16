import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PANEL_ROUTES } from "@/core/navigation/panelNavigation";
import { SidebarNav } from "./SidebarNav";
import { Bottombar } from "./Bottombar";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/pedidos" }));
vi.mock("@/features/busca/SearchProvider", () => ({ useSearch: () => ({ openSearch: vi.fn() }) }));
vi.mock("@/features/planos/usePlanStatus", () => ({ usePlanStatus: () => null }));

describe("SidebarNav: nome acessível mesmo com o menu recolhido (UX-17)", () => {
  it("todo link do painel tem nome acessível igual ao rótulo da rota", () => {
    render(<SidebarNav onNavigate={vi.fn()} />);
    for (const route of PANEL_ROUTES) {
      expect(screen.getByRole("link", { name: new RegExp(route.label) })).toHaveAttribute("href", route.href);
    }
  });

  it("o nome vem do aria-label, não do texto (que some com o menu recolhido)", () => {
    const { container } = render(<SidebarNav onNavigate={vi.fn()} />);
    const links = [...container.querySelectorAll("a.shell-nav__item")];
    expect(links.length).toBe(PANEL_ROUTES.length);
    for (const link of links) expect(link.getAttribute("aria-label")?.length).toBeGreaterThan(1);
  });

  it("a rota atual é marcada com aria-current", () => {
    render(<SidebarNav onNavigate={vi.fn()} />);
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAttribute("href", "/dashboard/pedidos");
  });

  it("tocar num item avisa o menu para fechar (celular)", async () => {
    const onNavigate = vi.fn();
    render(<SidebarNav onNavigate={onNavigate} />);
    await userEvent.click(screen.getAllByRole("link")[0]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });
});

describe("Bottombar: botão 'Mais'", () => {
  it("informa se o menu está aberto e qual elemento controla", () => {
    const { rerender } = render(<Bottombar onOpenMenu={vi.fn()} onNavigate={vi.fn()} />);
    const more = screen.getByRole("button", { name: /Mais/ });
    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(more).toHaveAttribute("aria-controls", "shell-sidebar");
    rerender(<Bottombar onOpenMenu={vi.fn()} onNavigate={vi.fn()} menuOpen />);
    expect(screen.getByRole("button", { name: /Mais/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("abre o menu ao tocar", async () => {
    const onOpenMenu = vi.fn();
    render(<Bottombar onOpenMenu={onOpenMenu} onNavigate={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: /Mais/ }));
    expect(onOpenMenu).toHaveBeenCalledTimes(1);
  });
});
