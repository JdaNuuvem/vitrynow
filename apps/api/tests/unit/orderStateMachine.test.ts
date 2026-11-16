import { describe, expect, it } from "vitest";
import type { OrderStatus, OrderType, PaymentStatus } from "@meucardapio/db";
import { allowedTransitions, canCancel, holdsMoney, isAdvanceAllowed, nextAdvance, undoUntil } from "../../src/lib/orderStateMachine";

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
            expect(!!cancel, `${role} ${type} ${status}/${payment} cancelar`).toBe(canCancel(f, role));
            if (advance) expect(advance.to).toBe(next);
            if (cancel) expect(cancel.requires?.refund).toBe(holdsMoney(f.payment));
            // Retirada nunca recebe "Saiu para entrega" (CA-B3-07).
            if (type !== "DELIVERY") expect(list.some((t) => t.to === "SAIU_PARA_ENTREGA")).toBe(false);
          }
        }
      }
    }
  });

  it("prazo de desfazer: 2 min para STAFF; OWNER sem prazo", () => {
    const at = new Date("2026-11-16T12:00:00.000Z");
    expect(undoUntil(at, "STAFF")?.toISOString()).toBe("2026-11-16T12:02:00.000Z");
    expect(undoUntil(at, "OWNER")).toBeNull();
  });
});
