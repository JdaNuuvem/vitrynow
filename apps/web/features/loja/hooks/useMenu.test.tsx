import { act, renderHook, waitFor } from "@testing-library/react";
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
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(getMenu).not.toHaveBeenCalled();
  });

  it("sem menu inicial (API fora do ar no SSR), busca no navegador", async () => {
    const getMenu = vi.fn().mockResolvedValue({ ok: true, data: menu });
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.menu).toBe(menu));
    expect(getMenu).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("sem menu inicial e a API devolve 404: loja não encontrada, sem erro temporário", async () => {
    const getMenu = vi.fn().mockResolvedValue({ ok: false, status: 404, error: "x" });
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("refresh busca de novo e atualiza (loja fechou durante o carrinho)", async () => {
    const closed = { store: { name: "Loja", acceptingOrders: false }, categories: [] } as unknown as Menu;
    const getMenu = vi.fn().mockResolvedValue({ ok: true, data: closed });
    const { result } = setup(getMenu, menu);
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(result.current.menu).toBe(closed));
  });

  it("mantém o carregamento enquanto aguarda o menu", async () => {
    let resolveMenu!: (value: unknown) => void;
    const getMenu = vi.fn().mockReturnValue(new Promise((resolve) => { resolveMenu = resolve; }));
    const { result } = setup(getMenu);
    expect(result.current.loading).toBe(true);
    expect(result.current.notFound).toBe(false);
    await act(async () => { resolveMenu({ ok: true, data: menu }); });
    expect(result.current.menu).toBe(menu);
    expect(result.current.loading).toBe(false);
  });

  it.each([0, 401, 500, 503])("status %s é erro temporário, sem afirmar que a loja não existe", async (status) => {
    const getMenu = vi.fn().mockResolvedValue({ ok: false, status, error: "detalhe interno" });
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.error).toBe("Não foi possível carregar o cardápio. Tente novamente."));
    expect(result.current.notFound).toBe(false);
    expect(result.current.menu).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("uma rejeição inesperada também oferece recuperação", async () => {
    const getMenu = vi.fn().mockRejectedValue(new Error("sem conexão"));
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.error).toBe("Não foi possível carregar o cardápio. Tente novamente."));
    expect(result.current.notFound).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it.each([404, 503])("tentar novamente limpa o estado do status %s e recupera o menu", async (status) => {
    let resolveRetry!: (value: unknown) => void;
    const getMenu = vi.fn()
      .mockResolvedValueOnce({ ok: false, status, error: "x" })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRetry = resolve; }));
    const { result } = setup(getMenu);
    await waitFor(() => expect(result.current.loading).toBe(false));
    let retry!: Promise<void>;
    act(() => { retry = result.current.refresh(); });
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(result.current.loading).toBe(true);
    await act(async () => {
      resolveRetry({ ok: true, data: menu });
      await retry;
    });
    expect(result.current.menu).toBe(menu);
    expect(result.current.error).toBeNull();
    expect(result.current.notFound).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("falha temporária no refresh preserva o menu que já estava visível", async () => {
    const getMenu = vi.fn().mockResolvedValue({ ok: false, status: 503, error: "x" });
    const { result } = setup(getMenu, menu);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.menu).toBe(menu);
    expect(result.current.error).toBe("Não foi possível carregar o cardápio. Tente novamente.");
    expect(result.current.notFound).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("confirma o fechamento informado pelo pedido sem alterar os demais dados do cardápio", () => {
    const openMenu = {
      ...menu,
      store: { ...menu.store, acceptingOrders: true, primaryColor: "#1f7a54" },
    };
    const { result } = setup(vi.fn(), openMenu);
    const markClosedByServer = result.current.markClosedByServer;
    act(() => { markClosedByServer(); });
    expect(result.current.menu).toEqual({ ...openMenu, store: { ...openMenu.store, acceptingOrders: false } });
    expect(result.current.menu?.categories).toBe(openMenu.categories);
    expect(openMenu.store.acceptingOrders).toBe(true);
    expect(result.current.markClosedByServer).toBe(markClosedByServer);
  });

  it("confirmar fechamento sem menu não cria dados de loja", () => {
    const getMenu = vi.fn().mockReturnValue(new Promise(() => {}));
    const { result } = setup(getMenu);
    act(() => { result.current.markClosedByServer(); });
    expect(result.current.menu).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("preserva o fechamento confirmado pelo servidor quando o refresh falha e reconcilia no sucesso", async () => {
    const openMenu = { ...menu, store: { ...menu.store, acceptingOrders: true } };
    const getMenu = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503, error: "x" })
      .mockResolvedValueOnce({ ok: true, data: openMenu });
    const { result } = setup(getMenu, openMenu);
    const markClosedByServer = result.current.markClosedByServer;
    act(() => { markClosedByServer(); });
    await act(async () => { await result.current.refresh(); });
    expect(result.current.menu?.store.acceptingOrders).toBe(false);
    expect(result.current.error).toBe("Não foi possível carregar o cardápio. Tente novamente.");
    await act(async () => { await result.current.refresh(); });
    expect(result.current.menu).toBe(openMenu);
    expect(result.current.menu?.store.acceptingOrders).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.markClosedByServer).toBe(markClosedByServer);
  });

  it("confirmar uma loja já fechada preserva o mesmo menu", () => {
    const closedMenu = { ...menu, store: { ...menu.store, acceptingOrders: false } };
    const { result } = setup(vi.fn(), closedMenu);
    act(() => { result.current.markClosedByServer(); });
    expect(result.current.menu).toBe(closedMenu);
  });

  it("uma resposta antiga não sobrescreve o refresh mais recente", async () => {
    let resolveOld!: (value: unknown) => void;
    const getMenu = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, data: menu });
    const { result } = setup(getMenu);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.menu).toBe(menu);
    await act(async () => { resolveOld({ ok: false, status: 404, error: "x" }); });
    expect(result.current.menu).toBe(menu);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
