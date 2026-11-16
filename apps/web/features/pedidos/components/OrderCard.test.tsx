import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "@/core/domain/orders";
import { OrderCard } from "./OrderCard";

const base: Order = {
  id: "o1",
  code: "42",
  type: "DELIVERY",
  status: "PENDENTE",
  customerName: "Maria",
  totalCents: 3550,
  items: [{ id: "i1", quantity: 2, productName: "Pizza" }],
  delivererId: null,
  payment: null,
};

function setup(order: Partial<Order> = {}) {
  const handlers = { onAdvance: vi.fn(), onAssignDeliverer: vi.fn(), onRefund: vi.fn() };
  render(<OrderCard order={{ ...base, ...order }} deliverers={[]} {...handlers} />);
  return handlers;
}

describe("OrderCard", () => {
  it("mostra código, cliente, itens e total", () => {
    setup();
    expect(screen.getByText(/#42/)).toBeInTheDocument();
    expect(screen.getByText("Maria")).toBeInTheDocument();
    expect(screen.getByText("2x Pizza")).toBeInTheDocument();
    expect(screen.getByText(/35,50/)).toBeInTheDocument();
  });

  it("usa texto padrão quando não há nome do cliente", () => {
    setup({ customerName: null });
    expect(screen.getByText("Cliente não informado")).toBeInTheDocument();
  });

  it("clicar no cartão avança o pedido", async () => {
    const { onAdvance } = setup();
    await userEvent.click(screen.getByRole("button", { name: /#42/ }));
    expect(onAdvance).toHaveBeenCalledOnce();
  });

  it("só pedido de delivery mostra o seletor de entregador", () => {
    setup({ type: "BALCAO" });
    expect(screen.queryByLabelText("Entregador")).not.toBeInTheDocument();
  });

  it("só pagamento aprovado oferece estorno", async () => {
    const { onRefund } = setup({ payment: { status: "APROVADO" } });
    await userEvent.click(screen.getByRole("button", { name: "Estornar pagamento" }));
    expect(onRefund).toHaveBeenCalledOnce();
  });

  it("pagamento pendente não oferece estorno", () => {
    setup({ payment: { status: "PENDENTE" } });
    expect(screen.queryByRole("button", { name: "Estornar pagamento" })).not.toBeInTheDocument();
  });
});
