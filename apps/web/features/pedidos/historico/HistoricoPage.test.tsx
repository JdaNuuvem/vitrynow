import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryRow } from "@/core/domain/orderHistory";
import type { Order } from "@/core/domain/orders";
import {
  HISTORY_EMPTY_TEXT,
  HISTORY_ERROR_TEXT,
  HISTORY_MORE_ERROR_TEXT,
  HISTORY_RATE_TEXT,
  HistoricoPage,
} from "./HistoricoPage";

// ---- a lista do histórico (hook simulado) ----
type ListState = {
  rows: HistoryRow[];
  total: number;
  timezone: string | undefined;
  loadState: "loading" | "ready" | "error";
  hasMore: boolean;
  loadingMore: boolean;
  moreFailed: boolean;
  rateLimited: boolean;
};
const list: ListState = { rows: [], total: 0, timezone: "America/Sao_Paulo", loadState: "ready", hasMore: false, loadingMore: false, moreFailed: false, rateLimited: false };
const listFns = { loadMore: vi.fn(), retry: vi.fn(), refresh: vi.fn() };
let lastQuery: unknown = null;
vi.mock("./useOrderHistoryList", () => ({
  useOrderHistoryList: (query: unknown) => {
    lastQuery = query;
    return { ...list, ...listFns };
  },
}));

// ---- as ações e o quadro (mesmo hook da página de pedidos) ----
type BoardState = { orders: Order[]; notice: string | null; undoOffer: { orderId: string; text: string } | null };
const board: BoardState = { orders: [], notice: null, undoOffer: null };
const boardFns = {
  transition: vi.fn().mockResolvedValue(undefined),
  undo: vi.fn().mockResolvedValue(undefined),
  cancel: vi.fn(),
  retryRefund: vi.fn(),
  assignDeliverer: vi.fn().mockResolvedValue(undefined),
  dismissNotice: vi.fn(),
  dismissUndo: vi.fn(),
};
let boardLoad: "loading" | "ready" | "error" = "ready";
vi.mock("../hooks/usePedidos", () => ({
  usePedidos: () => ({ ...board, loadState: boardLoad, deliverers: [], busyId: null, ...boardFns }),
}));

let role: "OWNER" | "STAFF" | null = "OWNER";
vi.mock("@/core/session/useCurrentRole", () => ({ useCurrentRole: () => role }));

const push = vi.fn();
const replace = vi.fn();
const back = vi.fn();
const router = { push, replace, back };
let query = "";
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(query) }));

vi.mock("../detail/OrderDetailPanel", () => ({
  OrderDetailPanel: (props: { orderId: string; refreshKey: string; onClose: () => void; onAdvance: (o: Order, a: never) => void; onOpenCancel: (o: Order, a: never) => void }) => (
    <aside data-testid="detalhe" data-order={props.orderId} data-refresh={props.refreshKey}>
      <button type="button" onClick={props.onClose}>
        fechar detalhe
      </button>
      <button type="button" onClick={() => props.onAdvance({ id: props.orderId, code: "0042" } as Order, { to: "CONCLUIDO" } as never)}>
        concluir
      </button>
      <button type="button" onClick={() => props.onOpenCancel({ id: props.orderId, code: "0042", status: "PENDENTE", totalCents: 1000, payment: null } as Order, { to: "CANCELADO", refund: false } as never)}>
        cancelar
      </button>
    </aside>
  ),
}));

const row = (id: string, over: Partial<HistoryRow> = {}): HistoryRow => ({
  id,
  code: id.padStart(4, "0"),
  createdAt: "2026-11-10T22:05:00Z",
  customerName: "Ana Souza",
  customerPhone: "*******5678",
  hasPhone: true,
  type: "DELIVERY",
  totalCents: 6900,
  status: "PENDENTE",
  display: "ABERTO",
  paymentMethod: null,
  paymentStatus: null,
  refundPending: false,
  notPrinted: false,
  ...over,
});

beforeEach(() => {
  Object.assign(list, { rows: [], total: 0, timezone: "America/Sao_Paulo", loadState: "ready", hasMore: false, loadingMore: false, moreFailed: false, rateLimited: false });
  Object.assign(board, { orders: [], notice: null, undoOffer: null });
  boardLoad = "ready";
  role = "OWNER";
  query = "";
  lastQuery = null;
  [...Object.values(listFns), push, replace, back].forEach((fn) => fn.mockReset());
  boardFns.transition.mockReset().mockResolvedValue(undefined);
  boardFns.cancel.mockReset();
  boardFns.retryRefund.mockReset();
});

describe("HistoricoPage: consulta e cabeçalho", () => {
  it("consulta a situação ABERTO SEM período: nada de period, from ou to (API-72)", () => {
    query = "status=ABERTO&period=7d&from=2026-11-01&to=2026-11-18";
    render(<HistoricoPage />);
    expect(lastQuery).toMatchObject({ status: "ABERTO" });
    for (const key of ["period", "from", "to"]) expect(lastQuery).not.toHaveProperty(key);
  });

  it("tem título, link de volta para Pedidos e permite filtrar situação e período", () => {
    render(<HistoricoPage />);
    expect(screen.getByRole("heading", { name: "Histórico" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Voltar aos pedidos" })).toHaveAttribute("href", "/dashboard/pedidos");
    expect(within(screen.getByRole("combobox", { name: "Situação" })).getByRole("option", { name: "Em aberto" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Período" })).toHaveValue("7d");
    expect(lastQuery).toMatchObject({ status: "ALL", period: "7d" });
  });
});

describe("HistoricoPage: a lista", () => {
  it("cada linha mostra código, data e hora NO FUSO DA LOJA, cliente, tipo, total e situação", () => {
    list.rows = [row("42", { type: "BALCAO", status: "EM_PREPARO", totalCents: 5800 })];
    list.total = 1;
    render(<HistoricoPage />);
    const line = screen.getByRole("button", { name: "Abrir pedido 0042" });
    expect(line).toHaveTextContent("#0042");
    expect(line).toHaveTextContent("10/11 · 19:05"); // 22:05Z em São Paulo
    expect(line).toHaveTextContent("Ana Souza");
    expect(line).toHaveTextContent("Retirada");
    expect(line).toHaveTextContent("R$ 58,00");
    expect(line).toHaveTextContent("Em preparo");
  });

  it("a situação traz ícone decorativo e texto, e os selos extras aparecem", () => {
    list.rows = [row("7", { refundPending: true, notPrinted: true })];
    list.total = 1;
    render(<HistoricoPage />);
    const line = screen.getByRole("button", { name: "Abrir pedido 0007" });
    expect(line.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(line).toHaveTextContent("Estorno pendente");
    expect(line).toHaveTextContent("Não impresso");
  });

  it("sem nome, mostra o telefone MASCARADO; um telefone completo nunca aparece na lista", () => {
    list.rows = [row("1", { customerName: null }), row("2", { customerName: null, customerPhone: "11987655678" })];
    list.total = 2;
    render(<HistoricoPage />);
    expect(screen.getByRole("button", { name: "Abrir pedido 0001" })).toHaveTextContent("*******5678");
    expect(document.body.textContent).not.toContain("11987655678");
  });

  it("a contagem fica em aria-live=polite, no singular e no plural", () => {
    list.rows = [row("1")];
    list.total = 1;
    const { unmount } = render(<HistoricoPage />);
    expect(screen.getByText("1 pedido", { exact: true })).toHaveAttribute("aria-live", "polite");
    unmount();
    list.rows = [row("1"), row("2")];
    list.total = 1234;
    render(<HistoricoPage />);
    expect(screen.getByText("1.234 pedidos", { exact: true })).toBeInTheDocument();
  });

  it("vazio: mensagem própria e nenhuma lista", () => {
    render(<HistoricoPage />);
    expect(screen.getByText(HISTORY_EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("carregando: 'Carregando pedidos…' e nada de 'nenhum pedido'", () => {
    list.loadState = "loading";
    render(<HistoricoPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando pedidos…");
    expect(screen.queryByText(HISTORY_EMPTY_TEXT)).not.toBeInTheDocument();
  });

  it("erro: alerta com 'Tentar de novo', sem fingir que não há pedidos", async () => {
    list.loadState = "error";
    render(<HistoricoPage />);
    expect(screen.getByRole("alert")).toHaveTextContent(HISTORY_ERROR_TEXT);
    expect(screen.queryByText(HISTORY_EMPTY_TEXT)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(listFns.retry).toHaveBeenCalledTimes(1);
  });

  it("429: faixa de espera (sem o texto de erro) e a lista que já estava continua", () => {
    list.rateLimited = true;
    list.rows = [row("1")];
    list.total = 1;
    render(<HistoricoPage />);
    expect(screen.getByText(HISTORY_RATE_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Abrir pedido 0001" })).toBeInTheDocument();
  });

  it("429 na 1ª carga não mostra o erro de rede por cima da faixa de espera", () => {
    list.rateLimited = true;
    list.loadState = "error";
    render(<HistoricoPage />);
    expect(screen.getByText(HISTORY_RATE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(HISTORY_ERROR_TEXT)).not.toBeInTheDocument();
  });
});

describe("HistoricoPage: carregar mais", () => {
  it("o botão diz quantos já vieram e o total, e pede mais", async () => {
    list.rows = [row("1"), row("2")];
    list.total = 60;
    list.hasMore = true;
    render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "Carregar mais (2 de 60)" }));
    expect(listFns.loadMore).toHaveBeenCalledTimes(1);
  });

  it("sem mais páginas não há botão; enquanto carrega fica desabilitado", () => {
    list.rows = [row("1")];
    list.total = 1;
    const { unmount } = render(<HistoricoPage />);
    expect(screen.queryByRole("button", { name: /Carregar mais/ })).not.toBeInTheDocument();
    unmount();
    list.hasMore = true;
    list.loadingMore = true;
    render(<HistoricoPage />);
    expect(screen.getByRole("button", { name: "Carregando…" })).toBeDisabled();
  });

  it("falha ao carregar mais avisa e mantém o botão para tentar de novo", () => {
    list.rows = [row("1")];
    list.total = 5;
    list.hasMore = true;
    list.moreFailed = true;
    render(<HistoricoPage />);
    expect(screen.getByText(HISTORY_MORE_ERROR_TEXT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Carregar mais/ })).toBeInTheDocument();
  });
});

describe("HistoricoPage: abrir o detalhe (o mesmo da WEB-26)", () => {
  beforeEach(() => {
    list.rows = [row("42")];
    list.total = 1;
  });

  it("tocar na linha abre o detalhe pela URL, sem mudar o pedido", async () => {
    render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir pedido 0042" }));
    expect(push).toHaveBeenCalledWith("/dashboard/pedidos/historico?pedido=42", { scroll: false });
    expect(boardFns.transition).not.toHaveBeenCalled();
    expect(boardFns.cancel).not.toHaveBeenCalled();
  });

  it("sem ?pedido= não há detalhe; com ?pedido= o painel recebe o id", () => {
    const { unmount } = render(<HistoricoPage />);
    expect(screen.queryByTestId("detalhe")).not.toBeInTheDocument();
    unmount();
    query = "pedido=42";
    render(<HistoricoPage />);
    expect(screen.getByTestId("detalhe")).toHaveAttribute("data-order", "42");
  });

  it("chegou direto pelo link (?pedido=): fechar apenas tira o parâmetro e fica no histórico", async () => {
    query = "pedido=42";
    render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "fechar detalhe" }));
    expect(replace).toHaveBeenCalledWith("/dashboard/pedidos/historico", { scroll: false });
    expect(back).not.toHaveBeenCalled();
  });

  it("abriu pela lista: fechar volta uma entrada do navegador", async () => {
    const view = render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir pedido 0042" }));
    query = "pedido=42";
    view.rerender(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "fechar detalhe" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("HistoricoPage: concluir e cancelar a partir do histórico", () => {
  beforeEach(() => {
    list.rows = [row("42")];
    list.total = 1;
    query = "pedido=42";
  });

  it("avançar pelo detalhe usa a ação do quadro e RECARREGA a lista e o detalhe", async () => {
    render(<HistoricoPage />);
    const before = screen.getByTestId("detalhe").getAttribute("data-refresh");
    await userEvent.click(screen.getByRole("button", { name: "concluir" }));
    expect(boardFns.transition).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(listFns.refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId("detalhe").getAttribute("data-refresh")).not.toBe(before));
  });

  it("cancelar abre a folha de cancelamento do quadro e, ao concluir, recarrega a lista", async () => {
    boardFns.cancel.mockResolvedValue({ kind: "done" });
    render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "cancelar" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: /Recusar pedido|Cancelar pedido/ }));
    await waitFor(() => expect(boardFns.cancel).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listFns.refresh).toHaveBeenCalled());
  });

  it("cancelamento recusado pelo servidor NÃO recarrega a lista (nada mudou)", async () => {
    boardFns.cancel.mockResolvedValue({ kind: "error", message: "A loja já aceitou." });
    render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: "cancelar" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: /Recusar pedido|Cancelar pedido/ }));
    expect(await screen.findByText("A loja já aceitou.")).toBeInTheDocument();
    expect(listFns.refresh).not.toHaveBeenCalled();
  });

  it("aviso de erro de uma ação aparece na tela, com botão de fechar", async () => {
    board.notice = "Não foi possível avançar o pedido.";
    render(<HistoricoPage />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível avançar o pedido.");
    await userEvent.click(within(alert).getByRole("button", { name: "Fechar aviso" }));
    expect(boardFns.dismissNotice).toHaveBeenCalled();
  });

  it("'Desfazer' usa o id do pedido da oferta, sem montar pedido de mentira", async () => {
    board.undoOffer = { orderId: "42", text: "Pedido #0042 · Concluído" };
    render(<HistoricoPage />);
    await userEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    expect(boardFns.undo).toHaveBeenCalledWith("42");
    await waitFor(() => expect(listFns.refresh).toHaveBeenCalled());
  });
});

describe("HistoricoPage: acompanha o quadro em tempo real", () => {
  it("quando o quadro muda por outro lado, a lista do histórico recarrega; a 1ª carga não conta", async () => {
    list.rows = [row("1")];
    list.total = 1;
    board.orders = [{ id: "1", status: "EM_PREPARO", code: "0001" } as Order];
    const view = render(<HistoricoPage />);
    expect(listFns.refresh).not.toHaveBeenCalled(); // o quadro pronto na 1ª renderização só registra a assinatura
    board.orders = [{ id: "1", status: "EM_PREPARO", code: "0001" } as Order];
    view.rerender(<HistoricoPage />);
    expect(listFns.refresh).not.toHaveBeenCalled(); // mesma situação, outro objeto: nada muda
    board.orders = [{ id: "1", status: "PRONTO", code: "0001" } as Order];
    view.rerender(<HistoricoPage />);
    await waitFor(() => expect(listFns.refresh).toHaveBeenCalledTimes(1));
  });

  it("enquanto o quadro ainda carrega, nada de recarregar o histórico", () => {
    boardLoad = "loading";
    const view = render(<HistoricoPage />);
    board.orders = [{ id: "1", status: "PRONTO", code: "0001" } as Order];
    view.rerender(<HistoricoPage />);
    expect(listFns.refresh).not.toHaveBeenCalled();
  });
});
