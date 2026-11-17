import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/core/domain/orders";
import { PedidosPage } from "./PedidosPage";

type HookState = {
  orders: Order[];
  notice: string | null;
  undoOffer: { orderId: string; text: string } | null;
};
const state: HookState = { orders: [], notice: null, undoOffer: null };
const fns = {
  transition: vi.fn(),
  undo: vi.fn(),
  cancel: vi.fn(),
  retryRefund: vi.fn(),
  assignDeliverer: vi.fn(),
  dismissNotice: vi.fn(),
  dismissUndo: vi.fn(),
};
vi.mock("./hooks/usePedidos", () => ({
  usePedidos: () => ({ ...state, deliverers: [], busyId: null, ...fns }),
}));

const accept = { to: "CONFIRMADO", label: "Aceitar", kind: "ADVANCE", primary: true };
const refuse = { to: "CANCELADO", label: "Recusar", kind: "CANCEL", requires: { reason: true } };

const order = (id: string, status: string, code = id, extra: Partial<Order> = {}): Order =>
  ({ id, code, type: "BALCAO", status, customerName: `Cliente ${id}`, totalCents: 1000, items: [], delivererId: null, payment: null, ...extra }) as Order;

const column = (name: string) => screen.getByRole("region", { name }) as HTMLElement;

beforeEach(() => {
  state.orders = [];
  state.notice = null;
  state.undoOffer = null;
  Object.values(fns).forEach((fn) => fn.mockReset());
});

describe("PedidosPage: quadro tolerante a status novo (WEB-21)", () => {
  it("pedido em SAIU_PARA_ENTREGA aparece na coluna 'Em entrega'", () => {
    state.orders = [order("1", "SAIU_PARA_ENTREGA", "0042")];
    render(<PedidosPage />);
    expect(within(column("Em entrega")).getByText("#0042")).toBeInTheDocument();
  });

  it("pedido com status desconhecido NÃO some: vai para 'Outros', com aviso e sem ações", () => {
    state.orders = [order("9", "ESTADO_DO_FUTURO", "0099", { allowedTransitions: [accept as never] })];
    render(<PedidosPage />);
    const others = column("Outros");
    expect(within(others).getByText("#0099")).toBeInTheDocument();
    expect(within(others).getByText(/ainda não conhece/)).toBeInTheDocument();
    expect(within(others).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByText("ESTADO_DO_FUTURO")).not.toBeInTheDocument();
  });

  it("sem pedido desconhecido não existe a coluna 'Outros'", () => {
    state.orders = [order("1", "PENDENTE")];
    render(<PedidosPage />);
    expect(screen.queryByRole("region", { name: "Outros" })).not.toBeInTheDocument();
  });

  it("pedido cancelado continua fora do quadro", () => {
    state.orders = [order("c", "CANCELADO", "0777")];
    render(<PedidosPage />);
    expect(screen.queryByText("#0777")).not.toBeInTheDocument();
  });

  it("um pedido de cada status conhecido e um desconhecido: todos visíveis, menos o cancelado", () => {
    const codes = ["0001", "0002", "0003", "0004", "0005", "0006"];
    state.orders = [
      ...["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"].map((s, i) => order(String(i + 1), s, codes[i])),
      order("7", "CANCELADO", "0007"),
      order("8", "NOVO_STATUS", "0008"),
    ];
    render(<PedidosPage />);
    for (const code of [...codes, "0008"]) expect(screen.getByText(`#${code}`)).toBeInTheDocument();
    expect(screen.queryByText("#0007")).not.toBeInTheDocument();
  });
});

describe("PedidosPage: cabeçalhos, contadores e estados vazios", () => {
  it("cada coluna mostra o contador e, vazia, a mensagem", () => {
    state.orders = [order("1", "PENDENTE", "0001"), order("2", "PENDENTE", "0002")];
    render(<PedidosPage />);
    expect(within(column("Pendente")).getByRole("heading")).toHaveTextContent("Pendente 2");
    expect(within(column("Pronto")).getByText("Nenhum pedido aqui.")).toBeInTheDocument();
  });

  it("os rótulos de status estão em português, nunca o código cru", () => {
    state.orders = [order("1", "EM_PREPARO", "0001")];
    render(<PedidosPage />);
    expect(screen.queryByText("EM_PREPARO")).not.toBeInTheDocument();
    expect(screen.queryByText("PENDENTE")).not.toBeInTheDocument();
  });
});

describe("PedidosPage: abas do celular", () => {
  it("há um botão por etapa, com contador, e a primeira vem marcada", () => {
    state.orders = [order("1", "PRONTO", "0001")];
    render(<PedidosPage />);
    const group = screen.getByRole("group", { name: "Etapas do pedido" });
    expect(within(group).getAllByRole("button")).toHaveLength(6);
    expect(within(group).getByRole("button", { name: /Pendente/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: /Pronto 1/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("tocar numa aba a marca e ativa a coluna correspondente", async () => {
    render(<PedidosPage />);
    await userEvent.click(within(screen.getByRole("group", { name: "Etapas do pedido" })).getByRole("button", { name: /Em entrega/ }));
    expect(column("Em entrega")).toHaveClass("is-active");
    expect(column("Pendente")).not.toHaveClass("is-active");
  });
});

describe("PedidosPage: ações, avisos e desfazer", () => {
  it("Aceitar chama a transição do servidor com a ação escolhida", async () => {
    state.orders = [order("1", "PENDENTE", "0001", { allowedTransitions: [accept as never, refuse as never] })];
    render(<PedidosPage />);
    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(fns.transition).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }), expect.objectContaining({ to: "CONFIRMADO" }));
  });

  it("Recusar abre a folha de cancelamento com o título e sem cancelar ainda", async () => {
    state.orders = [order("1", "PENDENTE", "0001", { allowedTransitions: [accept as never, refuse as never] })];
    render(<PedidosPage />);
    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(screen.getByRole("dialog", { name: "Recusar pedido #0001" })).toBeInTheDocument();
    expect(fns.cancel).not.toHaveBeenCalled();
  });

  it("erro de uma ação aparece como alerta na página, sem alert() nativo, e pode ser fechado", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    state.notice = "Este pedido já mudou. A tela foi atualizada.";
    render(<PedidosPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Este pedido já mudou. A tela foi atualizada.");
    await userEvent.click(screen.getByRole("button", { name: "Fechar aviso" }));
    expect(fns.dismissNotice).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("depois de avançar aparece o toast com Desfazer, anunciado como status", async () => {
    state.undoOffer = { orderId: "1", text: "Pedido #0001 · Em preparo" };
    render(<PedidosPage />);
    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent("Pedido #0001 · Em preparo.");
    await userEvent.click(within(toast).getByRole("button", { name: "Desfazer" }));
    expect(fns.undo).toHaveBeenCalledWith("1");
  });

  it("nunca usa confirm() nativo (o estorno agora passa pela folha)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");
    state.orders = [order("1", "PENDENTE", "0001", { allowedTransitions: [accept as never, refuse as never] })];
    render(<PedidosPage />);
    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
