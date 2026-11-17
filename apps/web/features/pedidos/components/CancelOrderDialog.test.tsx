import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Order } from "@/core/domain/orders";
import type { CancelOutcome } from "../hooks/usePedidos";
import { CancelOrderDialog } from "./CancelOrderDialog";

const order = (over: Partial<Order> = {}): Order =>
  ({
    id: "o1",
    code: "0123",
    type: "DELIVERY",
    status: "PENDENTE",
    customerName: "Ana Souza",
    totalCents: 6900,
    items: [],
    delivererId: null,
    payment: null,
    allowedTransitions: [{ to: "CANCELADO", label: "Recusar", kind: "CANCEL", requires: { reason: true } }],
    ...over,
  }) as Order;

const refundOrder = () =>
  order({ payment: { status: "APROVADO" }, allowedTransitions: [{ to: "CANCELADO", label: "Recusar e estornar", kind: "CANCEL", requires: { reason: true, refund: true } }] });

function setup(props: { order?: Order; refund?: boolean; confirm?: () => Promise<CancelOutcome>; retry?: () => Promise<CancelOutcome> } = {}) {
  const onConfirm = vi.fn(props.confirm ?? (async () => ({ kind: "done" }) as CancelOutcome));
  const onRetryRefund = vi.fn(props.retry ?? (async () => ({ kind: "done" }) as CancelOutcome));
  const onClose = vi.fn();
  render(<CancelOrderDialog order={props.order ?? order()} refund={props.refund ?? false} onConfirm={onConfirm} onRetryRefund={onRetryRefund} onClose={onClose} />);
  return { onConfirm, onRetryRefund, onClose };
}

describe("CancelOrderDialog: recusar (spec 02 §5.1)", () => {
  it("é um diálogo 'Recusar pedido #0123' com a lista de motivos da spec", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Recusar pedido #0123" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(7);
    expect(screen.getByRole("radio", { name: "Item em falta" })).toBeInTheDocument();
    expect(screen.queryByText(/Pagamento não aprovado/)).not.toBeInTheDocument();
  });

  it("pedido já aceito vira 'Cancelar pedido'", () => {
    setup({ order: order({ status: "EM_PREPARO" }) });
    expect(screen.getByRole("dialog", { name: "Cancelar pedido #0123" })).toBeInTheDocument();
  });

  it("o botão fica desabilitado até escolher o motivo, e a razão aparece escrita", () => {
    setup();
    expect(screen.getByRole("button", { name: "Recusar pedido" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Escolha um motivo para continuar")).toBeInTheDocument();
  });

  it("'Outro' exige a nota e ela é identificada como interna", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Outro" }));
    expect(screen.getByRole("button", { name: "Recusar pedido" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Escreva o motivo para continuar")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Escreva o motivo (só a loja vê)"), "Fechamos mais cedo");
    expect(screen.getByRole("button", { name: "Recusar pedido" })).not.toHaveAttribute("aria-disabled");
  });
});

describe("CancelOrderDialog: o texto ao cliente é fixo e só leitura (GRW-15)", () => {
  it("mostra 'O cliente verá: …' com a frase do motivo e SEM campo para editar", async () => {
    setup();
    expect(screen.queryByText(/O cliente verá/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    expect(screen.getByText(/O cliente verá:/)).toHaveTextContent("Item indisponível no momento.");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("a frase acompanha o motivo escolhido", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Fora da área de entrega" }));
    expect(screen.getByText(/O cliente verá:/)).toHaveTextContent("Esta loja não entrega no endereço informado.");
  });

  it("em 'Outro' o campo é só a nota interna e a frase ao cliente continua a fixa", async () => {
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Outro" }));
    await userEvent.type(screen.getByRole("textbox"), "nota interna");
    expect(screen.getByText(/O cliente verá:/)).toHaveTextContent("Pedido cancelado pela loja.");
    expect(screen.getByText(/O cliente verá:/)).not.toHaveTextContent("nota interna");
  });
});

describe("CancelOrderDialog: confirmar", () => {
  it("confirma com o motivo escolhido e fecha ao concluir", async () => {
    const { onConfirm, onClose } = setup();
    await userEvent.click(screen.getByRole("radio", { name: "Cliente desistiu" }));
    await userEvent.click(screen.getByRole("button", { name: "Recusar pedido" }));
    expect(onConfirm).toHaveBeenCalledWith({ code: "CLIENTE_DESISTIU", text: "" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("erro da API aparece na folha como alerta e a folha continua aberta", async () => {
    const { onClose } = setup({ confirm: async () => ({ kind: "error", message: "Este pedido já mudou. A tela foi atualizada." }) });
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: "Recusar pedido" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Este pedido já mudou.");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("'Voltar' fecha sem fazer nada", async () => {
    const { onConfirm, onClose } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("nunca usa confirm() nativo", async () => {
    const spy = vi.spyOn(window, "confirm");
    setup();
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: "Recusar pedido" }));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("CancelOrderDialog: cancelar e estornar (spec 02 §5.3)", () => {
  it("título, efeito escrito e botão que repete o efeito e o valor", () => {
    setup({ order: refundOrder(), refund: true });
    expect(screen.getByRole("dialog", { name: "Recusar e estornar #0123" })).toBeInTheDocument();
    expect(screen.getByText(/PIX de R\$\s?69,00 pago por Ana Souza/)).toBeInTheDocument();
    expect(screen.getByText(/só é cancelado depois que o estorno for aceito/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Recusar e estornar R\$\s?69,00/ })).toBeInTheDocument();
  });

  it("estorno não aceito: a folha FICA, avisa que o pedido continua como está e oferece tentar de novo", async () => {
    const { onClose, onRetryRefund } = setup({ order: refundOrder(), refund: true, confirm: async () => ({ kind: "refund-pending" }) });
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: /Recusar e estornar/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível estornar agora. O pedido continua como está.");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /Tentar estorno de R\$\s?69,00/ }));
    expect(onRetryRefund).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("depois do estorno pendente os motivos ficam travados (não dá para trocar o motivo no meio)", async () => {
    setup({ order: refundOrder(), refund: true, confirm: async () => ({ kind: "refund-pending" }) });
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: /Recusar e estornar/ }));
    expect(screen.getByRole("radio", { name: "Cliente desistiu" })).toBeDisabled();
  });
});

// Deming F1/A2/A3: o estado do estorno vem do PEDIDO, e o botão de confirmar não pode perder o foco enquanto roda.
describe("CancelOrderDialog: reaberta com o estorno já pedido (Deming, F1/A3)", () => {
  const pending = (payment: Record<string, unknown> = { status: "ESTORNO_PENDENTE", refundPending: true }) =>
    order({ status: "CONFIRMADO", payment: payment as never, allowedTransitions: [], blocked: [{ to: "CANCELADO", reason: "REFUND_PENDING" }] });

  it("abre direto em 'Tentar estorno de R$ 69,00': sem motivos, sem 'Cancelar pedido'", () => {
    setup({ order: pending(), refund: true });
    expect(screen.getByRole("dialog", { name: "Estorno do pedido #0123" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar estorno de R$ 69,00" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Cancelar pedido|Cancelar e estornar/ })).not.toBeInTheDocument();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("O estorno de R$ 69,00 ainda não foi aceito");
  });

  it("confirmar chama o retry do estorno e NÃO o cancelar", async () => {
    const { onConfirm, onRetryRefund, onClose } = setup({ order: pending(), refund: true });
    await userEvent.click(screen.getByRole("button", { name: "Tentar estorno de R$ 69,00" }));
    expect(onRetryRefund).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("o status ESTORNO_PENDENTE sozinho (sem a marca refundPending) também vale", async () => {
    const { onConfirm, onRetryRefund } = setup({ order: pending({ status: "ESTORNO_PENDENTE" }), refund: true });
    await userEvent.click(screen.getByRole("button", { name: "Tentar estorno de R$ 69,00" }));
    expect(onRetryRefund).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("se o retry falhar, a folha fica e mostra 'Não foi possível estornar agora'", async () => {
    const { onClose } = setup({ order: pending(), refund: true, retry: async () => ({ kind: "refund-pending" }) });
    await userEvent.click(screen.getByRole("button", { name: "Tentar estorno de R$ 69,00" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível estornar agora. O pedido continua como está.");
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("CancelOrderDialog: o foco não se perde enquanto roda (Deming, A2)", () => {
  it("o botão de confirmar fica com aria-disabled (não disabled) e mantém o foco durante o pedido", async () => {
    let release: (outcome: CancelOutcome) => void = () => {};
    setup({ confirm: () => new Promise<CancelOutcome>((resolve) => (release = resolve)) });
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    const confirm = screen.getByRole("button", { name: "Recusar pedido" });
    confirm.focus();
    await userEvent.keyboard("{Enter}");
    const busyButton = await screen.findByRole("button", { name: "Recusando…" });
    expect(busyButton).toHaveAttribute("aria-disabled", "true");
    expect(busyButton).not.toBeDisabled();
    expect(busyButton).toHaveFocus();
    release({ kind: "done" });
  });

  it("com o motivo ainda não escolhido, tocar em confirmar não envia nada", async () => {
    const { onConfirm } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Recusar pedido" }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("clicar de novo com a chamada em andamento não envia duas vezes", async () => {
    let release: (outcome: CancelOutcome) => void = () => {};
    const { onConfirm } = setup({ confirm: () => new Promise<CancelOutcome>((resolve) => (release = resolve)) });
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: "Recusar pedido" }));
    await userEvent.click(await screen.findByRole("button", { name: "Recusando…" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    release({ kind: "done" });
  });
});


// API-67: faixa só para LEGACY com pedido já impresso
describe("CancelOrderDialog: faixa 'a cozinha não será avisada' (API-67)", () => {
  const BANNER = "A cozinha não será avisada pela impressora. Avise a cozinha.";
  const banner = () => screen.queryByText(BANNER);

  it("LEGACY com o pedido já impresso: mostra a faixa, como aviso (não como erro)", () => {
    setup({ order: order({ status: "EM_PREPARO", printMode: "LEGACY", printedAt: "2026-11-17T12:00:00Z" }) });
    expect(banner()).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(BANNER);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("vale também ao RECUSAR um pedido pendente já impresso", () => {
    setup({ order: order({ status: "PENDENTE", printMode: "LEGACY", printedAt: "2026-11-17T12:00:00Z" }) });
    expect(banner()).toBeInTheDocument();
  });

  it("QUEUE NUNCA mostra a faixa, mesmo impresso", () => {
    setup({ order: order({ status: "EM_PREPARO", printMode: "QUEUE", printedAt: "2026-11-17T12:00:00Z" }) });
    expect(banner()).not.toBeInTheDocument();
  });

  it("LEGACY mas ainda NÃO impresso (printedAt nulo ou ausente): sem faixa", () => {
    setup({ order: order({ printMode: "LEGACY", printedAt: null }) });
    expect(banner()).not.toBeInTheDocument();
  });

  it("API antiga (sem printMode nem printedAt): sem faixa", () => {
    setup({ order: order({ status: "EM_PREPARO" }) });
    expect(banner()).not.toBeInTheDocument();
  });

  it("valor desconhecido de printMode: sem faixa (em dúvida, não alarma)", () => {
    setup({ order: order({ printMode: "OUTRO" as unknown as "LEGACY", printedAt: "2026-11-17T12:00:00Z" }) });
    expect(banner()).not.toBeInTheDocument();
  });

  it("a faixa não atrapalha o fluxo: o botão segue desabilitado até escolher o motivo e confirma normalmente", async () => {
    const { onConfirm } = setup({ order: order({ status: "EM_PREPARO", printMode: "LEGACY", printedAt: "2026-11-17T12:00:00Z" }) });
    expect(screen.getByRole("button", { name: /Cancelar pedido/ })).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("radio", { name: "Item em falta" }));
    await userEvent.click(screen.getByRole("button", { name: /Cancelar pedido/ }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("no cancelar e estornar também aparece", () => {
    setup({ order: order({ ...refundOrder(), status: "EM_PREPARO", printMode: "LEGACY", printedAt: "2026-11-17T12:00:00Z" }), refund: true });
    expect(banner()).toBeInTheDocument();
  });
});
