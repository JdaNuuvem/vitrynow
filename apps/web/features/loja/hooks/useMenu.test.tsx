import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";
import { StorefrontServicesProvider } from "@/core/services/StorefrontServices";
import { useMenu } from "./useMenu";

const menu = { store: { name: "Loja" }, categories: [] } as unknown as Menu;

function setup(getMenu: ReturnType<typeof vi.fn>, initial?: Menu) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StorefrontServicesProvider services={{ storefront: { getMenu } as unknown as StorefrontGateway }}>{children}</StorefrontServicesProvider>
  );
  return renderHook(() => useMenu("loja", initial), { wrapper });
}

describe("useMenu com menu inicial do servidor (ADR-0013)", () => {
  it("usa o menu do servidor e não busca de novo ao montar", async () => {
    const getMenu = vi.fn();
    const { result } = setup(getMenu, menu);
    expect(result.current.menu).toBe(menu);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getMenu).not.toHaveBeenCalled();
  });

  it("sem menu inicial (API fora do ar no SSR), busca no navegador", async () => {
    const getMenu = vi.fn().mockResolvedValue({ ok: true, data: menu });
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.menu).toBe(menu));
    expect(getMenu).toHaveBeenCalledTimes(1);
  });

  it("sem menu inicial e a API devolve erro: notFound", async () => {
    const getMenu = vi.fn().mockResolvedValue({ ok: false, status: 404, error: "x" });
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.notFound).toBe(true));
  });

  it("refresh busca de novo e atualiza (loja fechou durante o carrinho)", async () => {
    const closed = { store: { name: "Loja", acceptingOrders: false }, categories: [] } as unknown as Menu;
    const getMenu = vi.fn().mockResolvedValue({ ok: true, data: closed });
    const { result } = setup(getMenu, menu);
    await result.current.refresh();
    await waitFor(() => expect(result.current.menu).toBe(closed));
  });
});
