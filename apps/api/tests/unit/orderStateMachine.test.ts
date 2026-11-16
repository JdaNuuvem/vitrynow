import { describe, expect, it } from "vitest";
import type { OrderStatus, OrderType, PaymentStatus } from "@meucardapio/db";
import { BLOCK_REASONS, allowedTransitions, blockedTransitions, canCancel, holdsMoney, isAdvanceAllowed, nextAdvance, undoUntil } from "../../src/lib/orderStateMachine";

const STATUSES: OrderStatus[] = ["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO", "CANCELADO"];
const TYPES: OrderType[] = ["DELIVERY", "BALCAO", "MESA"];
const PAYMENTS: (PaymentStatus | null)[] = [null, "PENDENTE", "APROVADO", "ESTORNO_PENDENTE", "REEMBOLSADO"];

const facts = (status: OrderStatus, type: OrderType, payment: PaymentStatus | null = null, awaitingPayment = false) => ({
  status,
  type,
  awaitingPayment,
  payment: payment ? { status: payment } : null,
});

describe("máquina de estados do pedido (ADR-0007 §3)", () => {
  it("a sequência para frente é única por tipo", () => {
    const walk = (type: OrderType) => {
      const path: OrderStatus[] = ["PENDENTE"];
      for (let s: OrderStatus | null = "PENDENTE"; s; ) {
        s = nextAdvance({ status: path[path.length - 1], type });
        if (s) path.push(s);
      }
      return path;
    };
    expect(walk("DELIVERY")).toEqual(["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA", "CONCLUIDO"]);
    expect(walk("BALCAO")).toEqual(["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]);
    expect(walk("MESA")).toEqual(["PENDENTE", "CONFIRMADO", "EM_PREPARO", "PRONTO", "CONCLUIDO"]);
  });

  it("matriz completa: só a aresta seguinte é aceita; pular, voltar ou sair de estado final é recusado", () => {
    for (const type of TYPES) {
      for (const from of STATUSES) {
        for (const to of STATUSES) {
          const expected = nextAdvance({ status: from, type }) === to;
          expect(isAdvanceAllowed(facts(from, type), to), `${type} ${from}→${to}`).toBe(expected);
        }
      }
    }
  });

  it("pedido aguardando pagamento não pode ser aceito", () => {
    expect(isAdvanceAllowed(facts("PENDENTE", "BALCAO", "PENDENTE", true), "CONFIRMADO")).toBe(false);
    expect(isAdvanceAllowed(facts("PENDENTE", "BALCAO", "APROVADO", false), "CONFIRMADO")).toBe(true);
  });

  it("papéis de cancelamento (B3.2): STAFF só PENDENTE/CONFIRMADO sem dinheiro online; OWNER qualquer ativo; cliente só PENDENTE", () => {
    for (const type of TYPES) {
      for (const status of STATUSES) {
        for (const payment of PAYMENTS) {
          const f = facts(status, type, payment);
          const active = status !== "CONCLUIDO" && status !== "CANCELADO";
          expect(canCancel(f, "OWNER"), `OWNER ${status}`).toBe(active);
          expect(canCancel(f, "SYSTEM"), `SYSTEM ${status}`).toBe(active);
          expect(canCancel(f, "STAFF"), `STAFF ${status}/${payment}`).toBe(
            (status === "PENDENTE" || status === "CONFIRMADO") && payment !== "APROVADO" && payment !== "ESTORNO_PENDENTE",
          );
          expect(canCancel(f, "CUSTOMER"), `CUSTOMER ${status}`).toBe(status === "PENDENTE");
        }
      }
    }
  });

  it("allowedTransitions nunca oferece o que o servidor recusaria (e oferece o que aceita)", () => {
    for (const type of TYPES) {
      for (const status of STATUSES) {
        for (const payment of PAYMENTS) {
          for (const role of ["OWNER", "STAFF"] as const) {
            const f = facts(status, type, payment);
            const list = allowedTransitions(f, role);
            const advance = list.find((t) => t.kind === "ADVANCE");
            const cancel = list.find((t) => t.kind === "CANCEL");
            const next = nextAdvance(f);
            const refundPending = payment === "ESTORNO_PENDENTE";
            expect(!!advance, `${role} ${type} ${status}/${payment} avançar`).toBe(!!next && !refundPending && isAdvanceAllowed(f, next));
            expect(!!cancel, `${role} ${type} ${status}/${payment} cancelar`).toBe(canCancel(f, role) && !refundPending);
            if (advance) expect(advance.to).toBe(next);
            if (cancel) expect(cancel.requires?.refund).toBe(holdsMoney(f.payment));
            // Retirada nunca recebe "Saiu para entrega" (CA-B3-07).
            if (type !== "DELIVERY") expect(list.some((t) => t.to === "SAIU_PARA_ENTREGA")).toBe(false);
          }
        }
      }
    }
  });

  it("rótulos da Da Vinci por destino e tipo", () => {
    const label = (status: OrderStatus, type: OrderType, payment: PaymentStatus | null = null) =>
      allowedTransitions(facts(status, type, payment), "OWNER").map((t) => t.label);
    expect(label("PENDENTE", "BALCAO")).toEqual(["Aceitar", "Recusar"]);
    expect(label("CONFIRMADO", "BALCAO")).toEqual(["Iniciar preparo", "Cancelar"]);
    expect(label("PRONTO", "DELIVERY")).toEqual(["Saiu para entrega", "Cancelar"]);
    expect(label("SAIU_PARA_ENTREGA", "DELIVERY")).toEqual(["Concluir (entregue)", "Cancelar"]);
    expect(label("PRONTO", "BALCAO")).toEqual(["Concluir", "Cancelar"]);
    expect(label("PRONTO", "MESA")).toEqual(["Entregue na mesa", "Cancelar"]);
    expect(label("PENDENTE", "BALCAO", "APROVADO")).toEqual(["Aceitar", "Recusar e estornar"]);
    expect(label("EM_PREPARO", "BALCAO", "APROVADO")).toEqual(["Pronto", "Cancelar e estornar"]);
  });

  // Códigos do catálogo do Leonardo (leonardo/catalogo-codigos-erro.md §5b). Cópia fixa de propósito: o teste
  // falha se a API passar a devolver um código que o catálogo não tem texto para mostrar.
  const CATALOG_REASONS = [
    "REFUND_PENDING",
    "AWAITING_PAYMENT",
    "ORDER_ALREADY_RECEIVED",
    "CASH_CLOSED_OWNER_ONLY",
    "REFUND_REQUIRES_OWNER",
    "CANCEL_AFTER_PREP_OWNER_ONLY",
    "UNDO_WINDOW_EXPIRED",
    "FORBIDDEN_ROLE",
  ];

  it("blocked: todo motivo existe no catálogo; cada botão fica em allowed OU blocked; um motivo por transição; OWNER só recebe os 3 gerais", () => {
    expect([...BLOCK_REASONS]).toEqual(CATALOG_REASONS);
    const ownerReasons = new Set(["REFUND_PENDING", "AWAITING_PAYMENT", "ORDER_ALREADY_RECEIVED"]);
    for (const type of TYPES) {
      for (const status of STATUSES) {
        for (const payment of PAYMENTS) {
          for (const awaiting of [false, true]) {
            for (const role of ["OWNER", "STAFF"] as const) {
              const f = facts(status, type, payment, awaiting);
              const where = `${role} ${type} ${status}/${payment}/${awaiting}`;
              const allowed = allowedTransitions(f, role).map((t) => `${t.kind}:${t.to}`);
              const blocked = blockedTransitions(f, role);
              const keys = blocked.map((b) => `${b.kind}:${b.to}`);
              expect(new Set(keys).size, `${where}: dois motivos para a mesma transição`).toBe(keys.length);
              for (const b of blocked) {
                expect(CATALOG_REASONS, where).toContain(b.reason);
                expect(allowed, where).not.toContain(`${b.kind}:${b.to}`);
                if (role === "OWNER") expect(ownerReasons.has(b.reason), `${where}: OWNER recebeu ${b.reason}`).toBe(true);
              }
              if (status === "CONCLUIDO" || status === "CANCELADO") expect(blocked).toEqual([]);
            }
          }
        }
      }
    }
  });

  it("blocked: motivo mais específico para cada situação (contrato B3 §9)", () => {
    // STAFF + dinheiro online: REFUND_REQUIRES_OWNER vence CANCEL_AFTER_PREP_OWNER_ONLY.
    expect(blockedTransitions(facts("EM_PREPARO", "BALCAO", "APROVADO"), "STAFF")).toEqual([{ to: "CANCELADO", kind: "CANCEL", reason: "REFUND_REQUIRES_OWNER" }]);
    expect(blockedTransitions(facts("PENDENTE", "BALCAO", "APROVADO"), "STAFF")).toEqual([{ to: "CANCELADO", kind: "CANCEL", reason: "REFUND_REQUIRES_OWNER" }]);
    // STAFF depois que o preparo começou, sem dinheiro online.
    for (const status of ["EM_PREPARO", "PRONTO"] as const) {
      expect(blockedTransitions(facts(status, "BALCAO"), "STAFF")).toEqual([{ to: "CANCELADO", kind: "CANCEL", reason: "CANCEL_AFTER_PREP_OWNER_ONLY" }]);
    }
    expect(blockedTransitions(facts("SAIU_PARA_ENTREGA", "DELIVERY"), "STAFF")).toEqual([{ to: "CANCELADO", kind: "CANCEL", reason: "CANCEL_AFTER_PREP_OWNER_ONLY" }]);
    // Estorno em curso: tudo bloqueado com REFUND_PENDING (vale para OWNER também), e cancelar de novo não é oferecido.
    for (const role of ["OWNER", "STAFF"] as const) {
      expect(blockedTransitions(facts("PENDENTE", "BALCAO", "ESTORNO_PENDENTE"), role)).toEqual([
        { to: "CONFIRMADO", kind: "ADVANCE", reason: "REFUND_PENDING" },
        { to: "CANCELADO", kind: "CANCEL", reason: "REFUND_PENDING" },
      ]);
      expect(allowedTransitions(facts("PENDENTE", "BALCAO", "ESTORNO_PENDENTE"), role)).toEqual([]);
    }
    // Aguardando pagamento: não aceita, mas pode recusar.
    expect(blockedTransitions(facts("PENDENTE", "BALCAO", "PENDENTE", true), "OWNER")).toEqual([{ to: "CONFIRMADO", kind: "ADVANCE", reason: "AWAITING_PAYMENT" }]);
    expect(allowedTransitions(facts("PENDENTE", "BALCAO", "PENDENTE", true), "OWNER").map((t) => t.to)).toEqual(["CANCELADO"]);
    // Nada bloqueado quando tudo é permitido.
    expect(blockedTransitions(facts("CONFIRMADO", "BALCAO"), "OWNER")).toEqual([]);
    expect(blockedTransitions(facts("CONFIRMADO", "BALCAO"), "STAFF")).toEqual([]);
  });

  it("prazo de desfazer: 2 min para STAFF; OWNER sem prazo", () => {
    const at = new Date("2026-11-16T12:00:00.000Z");
    expect(undoUntil(at, "STAFF")?.toISOString()).toBe("2026-11-16T12:02:00.000Z");
    expect(undoUntil(at, "OWNER")).toBeNull();
  });
});
