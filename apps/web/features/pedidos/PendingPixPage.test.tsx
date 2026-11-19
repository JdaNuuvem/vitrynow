import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PendingPixPage } from "./PendingPixPage";

const orders = vi.hoisted(() => ({ awaitingPayments: vi.fn(), checkPayment: vi.fn() }));
vi.mock("@/core/services/PanelServices", () => ({ usePanelServices: () => ({ orders }) }));
const pending = {
  id: "a", code: "102", totalCents: 1500, customerName: "Cliente",
  createdAt: "2026-11-18T10:00:00Z", expiresAt: null, secondsLeft: null,
};

describe("Conferência de PIX pendente", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    orders.awaitingPayments.mockResolvedValue({ ok: true, data: { count: 1, orders: [pending] } });
  });

  it("mantém o pedido na fila quando o provedor não consegue verificar e limita a repetição", async () => {
    orders.checkPayment.mockResolvedValue({ ok: true, data: { result: "UNVERIFIED" } });
    render(<PendingPixPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Conferir pagamento" }));
    expect(orders.checkPayment).toHaveBeenCalledWith("a");
    expect(await screen.findByText(/não conseguiu verificar/)).toBeInTheDocument();
    expect(screen.getByText("#102")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aguarde um minuto" })).toBeDisabled();
  });

  it.each([401, 403])("limpa os dados da fila quando a API recusa o acesso (%i)", async (status) => {
    orders.checkPayment.mockResolvedValue({ ok: false, status, error: "Acesso negado" });
    render(<PendingPixPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Conferir pagamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Acesso negado");
    expect(screen.queryByText(/#102/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Cliente/)).not.toBeInTheDocument();
  });

  it("remove o aviso da última conferência quando o acesso à fila é revogado", async () => {
    orders.awaitingPayments.mockResolvedValueOnce({ ok: true, data: { count: 1, orders: [pending] } })
      .mockResolvedValue({ ok: false, status: 403, error: "Acesso negado" });
    orders.checkPayment.mockResolvedValue({ ok: true, data: { result: "UNVERIFIED" } });
    render(<PendingPixPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Conferir pagamento" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Acesso negado");
    expect(screen.queryByText(/#102/)).not.toBeInTheDocument();
  });

  it("atualiza a fila após a confirmação do provedor", async () => {
    orders.awaitingPayments.mockResolvedValueOnce({ ok: true, data: { count: 1, orders: [pending] } })
      .mockResolvedValue({ ok: true, data: { count: 0, orders: [] } });
    orders.checkPayment.mockResolvedValue({ ok: true, data: { result: "PAID" } });
    render(<PendingPixPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Conferir pagamento" }));
    expect(await screen.findByText(/Pagamento confirmado pelo provedor/)).toBeInTheDocument();
    expect(screen.queryByText("#102")).not.toBeInTheDocument();
  });
});
