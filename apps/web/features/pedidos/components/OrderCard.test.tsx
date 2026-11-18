import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { AllowedTransition, Order } from "@/core/domain/orders";
import { OrderCard } from "./OrderCard";

const NOW = Date.parse("2026-11-16T20:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const accept: AllowedTransition = { to: "CONFIRMADO", label: "Aceitar", kind: "ADVANCE", primary: true };
const refuse: AllowedTransition = { to: "CANCELADO", label: "Recusar", kind: "CANCEL", requires: { reason: true } };

const base: Order = {
  id: "o1",
  code: "0042",
  type: "DELIVERY",
  status: "PENDENTE",
  customerName: "Maria",
  totalCents: 3550,
  items: [{ id: "i1", quantity: 2, productName: "Pizza" }],
  delivererId: null,
  payment: null,
  createdAt: minutesAgo(4),
  allowedTransitions: [accept, refuse],
};

function setup(order: Partial<Order> = {}, props: { readOnly?: boolean; busy?: boolean; canRetryRefund?: boolean } = {}) {
  const handlers = { onAdvance: vi.fn(), onOpenCancel: vi.fn(), onUndo: vi.fn(), onRetryRefund: vi.fn(), onAssignDeliverer: vi.fn() };
  render(<OrderCard order={{ ...base, ...order }} deliverers={[]} nowMs={NOW} {...props} {...handlers} />);
  return handlers;
}

describe("OrderCard: o que o card mostra", () => {
  it("código, estado, tipo em português, cliente, itens e total", () => {
    setup();
    expect(screen.getByText("#0042")).toBeInTheDocument();
    expect(screen.getByText("Pendente")).toBeInTheDocument();
    expect(screen.getByText(/Delivery · Maria/)).toBeInTheDocument();
    expect(screen.getByText("2× Pizza")).toBeInTheDocument();
    expect(screen.getByText(/35,50/)).toBeInTheDocument();
  });

  it("nunca mostra o código cru do tipo (BALCAO vira Retirada)", () => {
    setup({ type: "BALCAO" });
    expect(screen.getByText(/Retirada/)).toBeInTheDocument();
    expect(screen.queryByText(/BALCAO/)).not.toBeInTheDocument();
  });

  it("sem nome do cliente usa o texto padrão", () => {
    setup({ customerName: null });
    expect(screen.getByText(/Cliente não informado/)).toBeInTheDocument();
  });

  it("mais de 2 itens: mostra 2 e resume o resto", () => {
    setup({
      items: [
        { id: "1", quantity: 1, productName: "A" },
        { id: "2", quantity: 1, productName: "B" },
        { id: "3", quantity: 1, productName: "C" },
        { id: "4", quantity: 1, productName: "D" },
      ],
    });
    expect(screen.getByText(/\+2 itens/)).toBeInTheDocument();
  });

  it("tempo no estado em texto, com aviso a partir de 5 min e perigo a partir de 10 (cor nunca sozinha)", () => {
    const { unmount } = render(<OrderCard order={{ ...base, createdAt: minutesAgo(4) }} deliverers={[]} nowMs={NOW} onAdvance={vi.fn()} onOpenCancel={vi.fn()} onUndo={vi.fn()} onRetryRefund={vi.fn()} onAssignDeliverer={vi.fn()} />);
    expect(screen.getByText("há 4 min")).toBeInTheDocument();
    unmount();
    render(<OrderCard order={{ ...base, createdAt: minutesAgo(12) }} deliverers={[]} nowMs={NOW} onAdvance={vi.fn()} onOpenCancel={vi.fn()} onUndo={vi.fn()} onRetryRefund={vi.fn()} onAssignDeliverer={vi.fn()} />);
    expect(screen.getByText(/há 12 min/)).toHaveClass("pedidos-card__age--danger");
    expect(screen.getByText(/⛔/)).toBeInTheDocument();
  });

  it("pedido que não é novo e sem statusChangedAt não inventa tempo", () => {
    setup({ status: "EM_PREPARO", createdAt: minutesAgo(90), allowedTransitions: [] });
    expect(screen.queryByText(/há \d+/)).not.toBeInTheDocument();
  });

  it("PIX pago aparece como selo com texto", () => {
    setup({ payment: { status: "APROVADO" } });
    expect(screen.getByText("PIX pago ✓")).toBeInTheDocument();
  });

  it("estorno pendente aparece como selo de perigo e ganha 'Tentar estorno' no menu", async () => {
    const { onRetryRefund } = setup({ payment: { status: "APROVADO", refundPending: true }, allowedTransitions: [] }, { canRetryRefund: true });
    expect(screen.getByText("Estorno pendente")).toBeInTheDocument();
    await userEvent.click(screen.getByText("⋯"));
    await userEvent.click(screen.getByRole("button", { name: "Tentar estorno" }));
    expect(onRetryRefund).toHaveBeenCalledTimes(1);
  });

  it("quem não é o dono não recebe o botão 'Tentar estorno': vê o motivo escrito (Deming, A1)", async () => {
    const { onRetryRefund } = setup({ payment: { status: "APROVADO", refundPending: true }, allowedTransitions: [] });
    await userEvent.click(screen.getByText("⋯"));
    expect(screen.queryByRole("button", { name: "Tentar estorno" })).not.toBeInTheDocument();
    expect(screen.getByText("Só o dono pode tentar o estorno de novo.")).toBeInTheDocument();
    expect(onRetryRefund).not.toHaveBeenCalled();
  });
});

describe("OrderCard: as ações vêm do servidor", () => {
  it("clicar no corpo do card NÃO avança o pedido (o defeito antigo: avançava sem aviso)", async () => {
    const { onAdvance } = setup();
    await userEvent.click(screen.getByText("2× Pizza"));
    await userEvent.click(screen.getByText("#0042"));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("Aceitar avança pela aresta do servidor; o rótulo é o que o servidor mandou", async () => {
    const { onAdvance } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(onAdvance).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }), expect.objectContaining({ to: "CONFIRMADO", label: "Aceitar" }));
  });

  it("Recusar abre a folha de motivo, não cancela direto", async () => {
    const { onOpenCancel, onAdvance } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Recusar" }));
    expect(onOpenCancel).toHaveBeenCalledWith(expect.objectContaining({ id: "o1" }), expect.objectContaining({ to: "CANCELADO", requiresReason: true }));
    expect(onAdvance).not.toHaveBeenCalled();
  });

  it("sem allowedTransitions não há botão de avançar nem de recusar", () => {
    setup({ allowedTransitions: [] });
    expect(screen.queryByRole("button", { name: "Aceitar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recusar" })).not.toBeInTheDocument();
  });

  it("pedido aceito: Cancelar fica no menu ⋯ e Voltar um passo só com canUndo", async () => {
    const { onOpenCancel, onUndo } = setup({
      status: "CONFIRMADO",
      canUndo: true,
      allowedTransitions: [{ to: "EM_PREPARO", label: "Iniciar preparo", kind: "ADVANCE", primary: true }, { ...refuse, label: "Cancelar" }],
    });
    expect(screen.getByRole("button", { name: "Iniciar preparo" })).toBeInTheDocument();
    await userEvent.click(screen.getByText("⋯"));
    await userEvent.click(screen.getByRole("button", { name: "Voltar um passo" }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onOpenCancel).toHaveBeenCalledTimes(1);
  });

  it("ocupado: o botão principal mostra 'Aguarde…' e não dispara de novo", async () => {
    const { onAdvance } = setup({}, { busy: true });
    const button = screen.getByRole("button", { name: "Aguarde…" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onAdvance).not.toHaveBeenCalled();
  });
});

describe("OrderCard: botão bloqueado mostra o motivo escrito (contrato §9)", () => {
  const blocked = { allowedTransitions: [accept], blocked: [{ to: "CANCELADO" as const, reason: "REFUND_REQUIRES_OWNER" as const }], payment: { status: "APROVADO" as const } };

  it("STAFF em pedido novo e pago: 'Recusar' bloqueado com o texto de 'recusar pedido pago'", () => {
    setup(blocked);
    const button = screen.getByRole("button", { name: "Recusar" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription("Só o dono pode recusar pedido pago.");
    expect(screen.getByText("Só o dono pode recusar pedido pago.")).toBeVisible();
  });

  it("o botão bloqueado não faz nada ao clicar, mas continua focável por teclado", async () => {
    const { onOpenCancel } = setup(blocked);
    const button = screen.getByRole("button", { name: "Recusar" });
    await userEvent.click(button);
    expect(onOpenCancel).not.toHaveBeenCalled();
    await userEvent.tab();
    expect(document.body).not.toHaveFocus();
  });

  it("o código do motivo nunca aparece na tela", () => {
    setup(blocked);
    expect(screen.queryByText(/REFUND_REQUIRES_OWNER/)).not.toBeInTheDocument();
  });
});

describe("OrderCard: coletor 'Outros' (somente leitura)", () => {
  it("mostra o pedido mas não oferece ação nenhuma, nem entregador", () => {
    setup({ allowedTransitions: [accept, refuse] }, { readOnly: true });
    expect(screen.getByText("#0042")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Entregador/)).not.toBeInTheDocument();
  });
});

describe("OrderCard: entregador", () => {
  it("só pedido de delivery mostra o seletor", () => {
    setup({ type: "BALCAO" });
    expect(screen.queryByLabelText(/Entregador/)).not.toBeInTheDocument();
  });

  it("delivery mostra o seletor com o código do pedido no nome", () => {
    setup();
    expect(screen.getByLabelText("Entregador do pedido 0042")).toBeInTheDocument();
  });
});
