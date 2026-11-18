import { describe, expect, it } from "vitest";
import type { AllowedTransition, BlockedReasonCode, Order } from "@/core/domain/orders";
import { BLOCK_REASON_TEXT, blockReasonText, confirmCancelLabel, deriveCardActions } from "./orderActions";

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;

const order = (over: Partial<Order> = {}): Order => ({
  id: "o1",
  code: "0123",
  type: "DELIVERY",
  status: "PENDENTE",
  customerName: "Ana",
  totalCents: 6900,
  items: [],
  delivererId: null,
  payment: null,
  ...over,
});

const accept: AllowedTransition = { to: "CONFIRMADO", label: "Aceitar", kind: "ADVANCE", primary: true };
const refuse: AllowedTransition = { to: "CANCELADO", label: "Recusar", kind: "CANCEL", requires: { reason: true } };
const refuseRefund: AllowedTransition = { to: "CANCELADO", label: "Recusar e estornar", kind: "CANCEL", requires: { reason: true, owner: true, refund: true } };

describe("deriveCardActions: os botões vêm do servidor (spec 02 §2)", () => {
  it("pedido novo: Aceitar é o principal e Recusar fica ao lado", () => {
    const a = deriveCardActions(order({ allowedTransitions: [accept, refuse] }));
    expect(a.primary?.label).toBe("Aceitar");
    expect(a.secondary?.label).toBe("Recusar");
    expect(a.secondary?.requiresReason).toBe(true);
    expect(a.menu).toEqual([]);
  });

  it("sem allowedTransitions (API antiga) não inventa botão: a tela cai no comportamento de hoje", () => {
    const a = deriveCardActions(order());
    expect(a.primary).toBeNull();
    expect(a.secondary).toBeNull();
    expect(a.menu).toEqual([]);
    expect(a.undo.enabled).toBe(false);
  });

  it("não existe botão para aresta que o servidor não listou (retirada não recebe 'Saiu para entrega')", () => {
    const a = deriveCardActions(
      order({ type: "BALCAO", status: "PRONTO", allowedTransitions: [{ to: "CONCLUIDO", label: "Concluir", kind: "ADVANCE", primary: true }] }),
    );
    expect(a.primary?.to).toBe("CONCLUIDO");
    expect(JSON.stringify(a)).not.toContain("SAIU_PARA_ENTREGA");
  });

  it("pedido aceito: cancelar vai para o menu ⋯, não ao lado do principal", () => {
    const a = deriveCardActions(
      order({ status: "CONFIRMADO", allowedTransitions: [{ to: "EM_PREPARO", label: "Iniciar preparo", kind: "ADVANCE", primary: true }, refuse] }),
    );
    expect(a.primary?.label).toBe("Iniciar preparo");
    expect(a.secondary).toBeNull();
    expect(a.menu.map((m) => m.label)).toEqual(["Recusar"]);
  });

  it("PIX aprovado em pedido novo: 'Recusar e estornar' pede estorno (só dono)", () => {
    const a = deriveCardActions(order({ allowedTransitions: [accept, refuseRefund], payment: { status: "APROVADO" } }));
    expect(a.secondary?.refund).toBe(true);
    expect(a.secondary?.label).toBe("Recusar e estornar");
  });
});

describe("deriveCardActions: botão bloqueado mostra o texto, nunca o código (contrato §9)", () => {
  it("STAFF diante de pedido novo com PIX pago: Recusar desabilitado com o texto de 'recusar'", () => {
    const a = deriveCardActions(order({ allowedTransitions: [accept], blocked: [{ to: "CANCELADO", reason: "REFUND_REQUIRES_OWNER" }], payment: { status: "APROVADO" } }));
    expect(a.secondary?.disabledReason).toBe("Só o dono pode recusar pedido pago.");
    expect(a.secondary?.label).toBe("Recusar");
  });

  it("STAFF diante de pedido aceito e pago: item do menu desabilitado com o texto de 'cancelar'", () => {
    const a = deriveCardActions(order({ status: "EM_PREPARO", blocked: [{ to: "CANCELADO", reason: "REFUND_REQUIRES_OWNER" }] }));
    expect(a.menu[0].disabledReason).toBe("Só o dono pode cancelar pedido pago.");
    expect(a.menu[0].label).toBe("Cancelar");
  });

  it.each(Object.keys(BLOCK_REASON_TEXT) as BlockedReasonCode[])("o motivo %s tem texto em português e não vaza o código", (code) => {
    const text = blockReasonText(code);
    expect(text.length).toBeGreaterThan(10);
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]+/);
    expect(text.endsWith(".")).toBe(true);
  });

  it("código desconhecido (a API ganhou um novo) cai num texto seguro, nunca no código cru", () => {
    expect(blockReasonText("ALGO_NOVO_DA_API")).toBe("Esta ação não está disponível agora.");
  });

  it("estorno em andamento trava o desfazer e explica", () => {
    const a = deriveCardActions(order({ status: "PENDENTE", canUndo: true, payment: { status: "APROVADO", refundPending: true } }));
    expect(a.refundPending).toBe(true);
    expect(a.undo).toEqual({ enabled: false, reason: "O estorno deste pedido está em andamento." });
  });
});

describe("deriveCardActions: desfazer", () => {
  it("habilita quando o servidor diz canUndo", () => {
    expect(deriveCardActions(order({ canUndo: true })).undo).toEqual({ enabled: true, reason: null });
  });

  it("fora dos 2 minutos da equipe: desabilitado com o motivo do catálogo", () => {
    const a = deriveCardActions(order({ canUndo: false, blocked: [{ to: "PENDENTE", reason: "UNDO_WINDOW_EXPIRED" }] }));
    expect(a.undo).toEqual({ enabled: false, reason: "Só o dono pode voltar este pedido." });
  });
});

describe("confirmCancelLabel: o botão repete o efeito e o valor", () => {
  it("recusar e cancelar comuns", () => {
    expect(confirmCancelLabel(order({ allowedTransitions: [refuse] }), brl)).toBe("Recusar pedido");
    expect(confirmCancelLabel(order({ status: "EM_PREPARO", allowedTransitions: [refuse] }), brl)).toBe("Cancelar pedido");
  });

  it("com estorno cita o valor ('Cancelar e estornar R$ 69,00')", () => {
    expect(confirmCancelLabel(order({ status: "EM_PREPARO", allowedTransitions: [refuseRefund] }), brl)).toBe("Cancelar e estornar R$ 69,00");
    expect(confirmCancelLabel(order({ status: "PENDENTE", allowedTransitions: [refuseRefund] }), brl)).toBe("Recusar e estornar R$ 69,00");
  });
});
