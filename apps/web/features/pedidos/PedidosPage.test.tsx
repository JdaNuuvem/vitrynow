import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/core/domain/orders";
import { PedidosPage } from "./PedidosPage";

type HookState = {
  orders: Order[];
  openHidden: number;
  loadState: "loading" | "ready" | "error";
  notice: string | null;
  undoOffer: { orderId: string; text: string } | null;
};
const state: HookState = { orders: [], openHidden: 0, loadState: "ready", notice: null, undoOffer: null };
const fns = {
  transition: vi.fn(),
  undo: vi.fn(),
  cancel: vi.fn(),
  retryRefund: vi.fn(),
  assignDeliverer: vi.fn(),
  dismissNotice: vi.fn(),
  dismissUndo: vi.fn(),
  retryLoad: vi.fn(),
};
vi.mock("./hooks/usePedidos", () => ({
  usePedidos: () => ({ ...state, deliverers: [], busyId: null, ...fns }),
}));

// Roteador e parâmetros: objetos ESTÁVEIS (um novo a cada render refaria os efeitos em laço).
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn() };
let query = "";
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => new URLSearchParams(query) }));
vi.mock("./detail/OrderDetailPanel", () => ({
  OrderDetailPanel: (props: { orderId: string; desktop: boolean }) => <div data-testid="detalhe" data-order={props.orderId} data-desktop={String(props.desktop)} />,
}));

let role: "OWNER" | "STAFF" | null = "OWNER";
vi.mock("@/core/session/useCurrentRole", () => ({ useCurrentRole: () => role }));

const accept = { to: "CONFIRMADO", label: "Aceitar", kind: "ADVANCE", primary: true };
const refuse = { to: "CANCELADO", label: "Recusar", kind: "CANCEL", requires: { reason: true } };

const order = (id: string, status: string, code = id, extra: Partial<Order> = {}): Order =>
  ({ id, code, type: "BALCAO", status, customerName: `Cliente ${id}`, totalCents: 1000, items: [], delivererId: null, payment: null, ...extra }) as Order;

const column = (name: string) => screen.getByRole("region", { name }) as HTMLElement;

beforeEach(() => {
  state.orders = [];
  state.openHidden = 0;
  state.loadState = "ready";
  state.notice = null;
  state.undoOffer = null;
  role = "OWNER";
  query = "";
  Object.values(router).forEach((fn) => fn.mockReset());
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
    // sem ações (avançar, recusar, entregador); só abrir o detalhe, que é leitura (spec 11 §2)
    expect(within(others).getAllByRole("button").map((button) => button.getAttribute("aria-label"))).toEqual(["Abrir pedido 0099"]);
    expect(within(others).queryByRole("combobox")).not.toBeInTheDocument();
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

describe("PedidosPage: carregando não é vazio (revisão da Da Vinci, B1)", () => {
  it("na 1ª carga mostra 'Carregando pedidos…' e NÃO diz 'Nenhum pedido aqui', nem mostra colunas ou abas", () => {
    state.loadState = "loading";
    render(<PedidosPage />);
    expect(screen.getByRole("status")).toHaveTextContent("Carregando pedidos…");
    expect(screen.queryByText("Nenhum pedido aqui.")).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Etapas do pedido" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pendente" })).not.toBeInTheDocument();
  });

  it("falha na 1ª carga: alerta com 'Tentar de novo', sem fingir que não há pedidos", async () => {
    state.loadState = "error";
    render(<PedidosPage />);
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível carregar os pedidos.");
    expect(screen.queryByText("Nenhum pedido aqui.")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(fns.retryLoad).toHaveBeenCalledTimes(1);
  });

  it("pronto e sem pedidos: aí sim 'Nenhum pedido aqui.'", () => {
    state.loadState = "ready";
    render(<PedidosPage />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(within(column("Pendente")).getByText("Nenhum pedido aqui.")).toBeInTheDocument();
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

// Deming, F1: com a folha fechada, o "Tentar estorno" do cartão reabria a folha com refundPending=false (estado local):
// o botão virava "Cancelar pedido" e chamava /cancel, que responde 409 REFUND_PENDING. O estado agora vem do pedido.
describe("PedidosPage: tentar o estorno de novo depois de fechar a folha (Deming, F1/A1/A3)", () => {
  const pendingOrder = (extra: Partial<Order> = {}) =>
    order("5", "CONFIRMADO", "0045", {
      totalCents: 4500,
      payment: { status: "ESTORNO_PENDENTE", refundPending: true },
      allowedTransitions: [],
      blocked: [{ to: "CANCELADO", reason: "REFUND_PENDING" }],
      ...extra,
    } as Partial<Order>);

  async function openRetrySheet() {
    await userEvent.click(screen.getByText("⋯"));
    await userEvent.click(screen.getByRole("button", { name: "Tentar estorno" }));
    return screen.findByRole("dialog");
  }

  it("a folha reaberta já está em 'Tentar estorno de R$ 45,00' e confirmar chama o retry, NUNCA o cancelar", async () => {
    state.orders = [pendingOrder()];
    fns.retryRefund.mockResolvedValue({ kind: "done" });
    render(<PedidosPage />);
    const dialog = await openRetrySheet();
    expect(within(dialog).queryByRole("button", { name: /Cancelar pedido/ })).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Tentar estorno de R$ 45,00" });
    await userEvent.click(confirm);
    expect(fns.retryRefund).toHaveBeenCalledTimes(1);
    expect(fns.cancel).not.toHaveBeenCalled();
  });

  it("explica que o estorno ainda não foi aceito e não pede motivo de novo", async () => {
    state.orders = [pendingOrder()];
    render(<PedidosPage />);
    const dialog = await openRetrySheet();
    expect(within(dialog).getByRole("status")).toHaveTextContent("O estorno de R$ 45,00 ainda não foi aceito");
    expect(within(dialog).queryByText("Por que você está cancelando?")).not.toBeInTheDocument();
  });

  it("vale também quando a API só manda o status do pagamento (ESTORNO_PENDENTE) sem a marca refundPending", async () => {
    state.orders = [pendingOrder({ payment: { status: "ESTORNO_PENDENTE" } } as Partial<Order>)];
    fns.retryRefund.mockResolvedValue({ kind: "done" });
    render(<PedidosPage />);
    const dialog = await openRetrySheet();
    await userEvent.click(within(dialog).getByRole("button", { name: "Tentar estorno de R$ 45,00" }));
    expect(fns.retryRefund).toHaveBeenCalledTimes(1);
    expect(fns.cancel).not.toHaveBeenCalled();
  });

  it("funcionário (STAFF) não vê 'Tentar estorno' habilitado: vê o motivo escrito (A1)", async () => {
    role = "STAFF";
    state.orders = [pendingOrder()];
    render(<PedidosPage />);
    await userEvent.click(screen.getByText("⋯"));
    expect(screen.queryByRole("button", { name: "Tentar estorno" })).not.toBeInTheDocument();
    expect(screen.getByText("Só o dono pode tentar o estorno de novo.")).toBeInTheDocument();
  });

  it("papel ainda desconhecido (carregando ou falha) conta como não-dono: nunca libera por engano", async () => {
    role = null;
    state.orders = [pendingOrder()];
    render(<PedidosPage />);
    await userEvent.click(screen.getByText("⋯"));
    expect(screen.queryByRole("button", { name: "Tentar estorno" })).not.toBeInTheDocument();
  });
});

describe("PedidosPage: abrir o detalhe do pedido (WEB-26, UI-D-01)", () => {
  it("tocar no número do pedido abre o detalhe pela URL e NÃO avança o pedido", async () => {
    state.orders = [order("7", "PENDENTE", "0042", { allowedTransitions: [accept as never] })];
    render(<PedidosPage />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir pedido 0042" }));
    expect(router.push).toHaveBeenCalledWith("/dashboard/pedidos?pedido=7");
    expect(fns.transition).not.toHaveBeenCalled();
    expect(fns.cancel).not.toHaveBeenCalled();
  });

  it("pedido no coletor 'Outros' também abre o detalhe", async () => {
    state.orders = [order("9", "ESTADO_DO_FUTURO", "0099")];
    render(<PedidosPage />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir pedido 0099" }));
    expect(router.push).toHaveBeenCalledWith("/dashboard/pedidos?pedido=9");
  });

  it("sem ?pedido= não há detalhe; com ?pedido= o painel recebe o id", () => {
    state.orders = [order("7", "PENDENTE", "0042")];
    const { unmount } = render(<PedidosPage />);
    expect(screen.queryByTestId("detalhe")).not.toBeInTheDocument();
    unmount();
    query = "pedido=7";
    render(<PedidosPage />);
    expect(screen.getByTestId("detalhe")).toHaveAttribute("data-order", "7");
  });

  it("o botão 'Aceitar' do cartão continua avançando (abrir e avançar são toques diferentes)", async () => {
    state.orders = [order("7", "PENDENTE", "0042", { allowedTransitions: [accept as never] })];
    fns.transition.mockResolvedValue(undefined);
    render(<PedidosPage />);
    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(fns.transition).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("PedidosPage: faixa dos abertos escondidos pelo teto (API-70, WEB-37)", () => {
  const banner = () => screen.queryByText(/em aberto não aparece/);

  it("com abertos de fora mostra a faixa com o número e o caminho, como aviso (role=status, não alerta)", () => {
    state.openHidden = 7;
    render(<PedidosPage />);
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("7 pedidos antigos em aberto não aparecem aqui. Veja em Histórico › Em aberto.");
    expect(region.textContent?.replace(/\s+/g, " ").trim()).toBe("7 pedidos antigos em aberto não aparecem aqui. Veja em Histórico › Em aberto.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // o caminho da frase é um LINK para a tela que ela promete (WEB-44): a faixa nunca aponta para o vazio
    expect(screen.getByRole("link", { name: "Histórico › Em aberto" })).toHaveAttribute("href", "/dashboard/pedidos/historico?status=ABERTO");
  });

  it("um só: singular", () => {
    state.openHidden = 1;
    render(<PedidosPage />);
    expect(screen.getByRole("status")).toHaveTextContent("1 pedido antigo em aberto não aparece aqui. Veja em Histórico › Em aberto.");
  });

  it("o cabeçalho de Pedidos tem o botão 'Histórico' para a tela nova, com alvo de 44 px", () => {
    render(<PedidosPage />);
    const link = screen.getByRole("link", { name: "Histórico" });
    expect(link).toHaveAttribute("href", "/dashboard/pedidos/historico");
    expect(link).toHaveClass("ds-button", "ds-button--secondary");
  });

  it("sem nenhum escondido, nada de faixa", () => {
    state.openHidden = 0;
    render(<PedidosPage />);
    expect(banner()).not.toBeInTheDocument();
  });

  it("não aparece enquanto carrega nem na falha da 1ª carga (nunca um aviso sobre dados que ainda não vieram)", () => {
    state.openHidden = 4;
    state.loadState = "loading";
    const { unmount } = render(<PedidosPage />);
    expect(banner()).not.toBeInTheDocument();
    unmount();
    state.loadState = "error";
    render(<PedidosPage />);
    expect(banner()).not.toBeInTheDocument();
  });

  it("tem ícone de atenção decorativo (aria-hidden) antes do texto", () => {
    state.openHidden = 2;
    render(<PedidosPage />);
    const region = screen.getByText(/pedidos antigos em aberto/).closest("[role=status]") as HTMLElement;
    const icon = region.querySelector("svg") as SVGElement;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).not.toHaveAttribute("hidden"); // decorativo para o leitor de tela, mas VISÍVEL na tela
    expect(icon).toBeVisible();
    expect(region.firstElementChild).toBe(icon);
  });

  it("os pedidos que a API devolveu continuam todos no quadro (a faixa não esconde nada)", () => {
    state.openHidden = 3;
    state.orders = [order("1", "PENDENTE", "0001")];
    render(<PedidosPage />);
    expect(within(column("Pendente")).getByText("#0001")).toBeInTheDocument();
  });
});
