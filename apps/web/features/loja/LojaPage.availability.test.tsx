import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Menu } from "@/core/domain/storefront";
import type { StorefrontGateway } from "@/core/gateways/StorefrontGateway";
import { StorefrontServicesProvider } from "@/core/services/StorefrontServices";
import { LojaPage } from "./LojaPage";

const orderState = vi.hoisted(() => ({ errorCode: null as string | null }));
vi.mock("./hooks/useOrderFlow", () => ({
  useOrderFlow: () => ({ ...orderState, placed: null, pendingPix: null }),
}));
afterEach(() => { orderState.errorCode = null; });

it.each(["STORE_CLOSED", "SUBSCRIPTION_INACTIVE"])("bloqueio %s prevalece sobre menu antigo quando a releitura falha", async (code) => {
  const menu: Menu = {
    store: {
      name: "Loja de teste", slug: "teste", logoUrl: null, coverImageUrl: null, primaryColor: null,
      address: null, whatsapp: null, openingHours: null, minOrderCents: null,
      deliveryEnabled: true, pickupEnabled: true, acceptingOrders: true, deliveryFeeCents: 0,
    },
    categories: [{ id: "pratos", name: "Pratos", icon: null, products: [{
      id: "prato", name: "Prato de teste", description: null, imageUrl: null, priceCents: 3500, additionals: [],
    }] }],
  };
  const getMenu = vi.fn().mockResolvedValue({ ok: false, status: 503, error: "Indisponível" });
  const services = { storefront: { getMenu } as unknown as StorefrontGateway };
  const page = () => <StorefrontServicesProvider services={services}><LojaPage slug="teste" initialMenu={menu} /></StorefrontServicesProvider>;
  const { rerender } = render(page());
  expect(screen.getByText("Recebendo pedidos")).toBeInTheDocument();

  orderState.errorCode = code;
  rerender(page());
  await waitFor(() => expect(getMenu).toHaveBeenCalledTimes(1));
  expect(await screen.findByText("Fechado agora")).toBeInTheDocument();
  expect(screen.queryByText("Recebendo pedidos")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adicionar Prato de teste" })).not.toBeInTheDocument();
  expect(screen.getByText("Prato de teste")).toBeInTheDocument();

  orderState.errorCode = null;
  rerender(page());
  expect(screen.getByText("Fechado agora")).toBeInTheDocument();
});
