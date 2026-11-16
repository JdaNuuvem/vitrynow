import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/core/domain/orders";
import { PedidosPage } from "./PedidosPage";

const state: { orders: Order[] } = { orders: [] };
vi.mock("./hooks/usePedidos", () => ({
  usePedidos: () => ({ orders: state.orders, deliverers: [], advance: vi.fn(), assignDeliverer: vi.fn(), refund: vi.fn() }),
}));

const order = (id: string, status: string, code = id): Order =>
  ({ id, code, type: "BALCAO", status, customerName: `Cliente ${id}`, totalCents: 1000, items: [], delivererId: null, payment: null }) as Order;

beforeEach(() => {
  state.orders = [];
});

describe("PedidosPage: quadro tolerante a status novo (WEB-21)", () => {
  it("pedido em SAIU_PARA_ENTREGA aparece na coluna 'Em entrega'", () => {
    state.orders = [order("1", "SAIU_PARA_ENTREGA", "0042")];
    render(<PedidosPage />);
    const column = screen.getByRole("heading", { name: "Em entrega" }).closest("section") as HTMLElement;
    expect(within(column).getByText(/#0042/)).toBeInTheDocument();
  });

  it("pedido com status desconhecido NÃO some: vai para a coluna 'Outros' com aviso", () => {
    state.orders = [order("9", "ESTADO_DO_FUTURO", "0099")];
    render(<PedidosPage />);
    const others = screen.getByRole("heading", { name: "Outros" }).closest("section") as HTMLElement;
    expect(within(others).getByText(/#0099/)).toBeInTheDocument();
    expect(within(others).getByText(/ainda não conhece/)).toBeInTheDocument();
    expect(screen.queryByText("ESTADO_DO_FUTURO")).not.toBeInTheDocument();
  });

  it("sem pedido desconhecido não existe a coluna 'Outros'", () => {
    state.orders = [order("1", "PENDENTE")];
    render(<PedidosPage />);
    expect(screen.queryByRole("heading", { name: "Outros" })).not.toBeInTheDocument();
  });

  it("pedido cancelado continua fora do quadro, como hoje", () => {
    state.orders = [order("c", "CANCELADO", "0777")];
    render(<PedidosPage />);
    expect(screen.queryByText(/#0777/)).not.toBeInTheDocument();
  });

  it("um pedido de cada status conhecido e um desconhecido: todos visíveis, menos o cancelado", () => {
    state.orders = [
      order("1", "PENDENTE", "0001"),
      order("2", "CONFIRMADO", "0002"),
      order("3", "EM_PREPARO", "0003"),
      order("4", "PRONTO", "0004"),
      order("5", "SAIU_PARA_ENTREGA", "0005"),
      order("6", "CONCLUIDO", "0006"),
      order("7", "CANCELADO", "0007"),
      order("8", "NOVO_STATUS", "0008"),
    ];
    render(<PedidosPage />);
    for (const code of ["0001", "0002", "0003", "0004", "0005", "0006", "0008"]) expect(screen.getByText(new RegExp(`#${code}`))).toBeInTheDocument();
    expect(screen.queryByText(/#0007/)).not.toBeInTheDocument();
  });
});
