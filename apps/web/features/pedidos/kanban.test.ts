import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type Order } from "@/core/domain/orders";
import { STATUS_LABELS, UNKNOWN_STATUS_LABEL, statusLabel } from "@/core/domain/orderLabels";
import { KANBAN_COLUMNS, OFF_BOARD_STATUSES, groupOrders, nextStatus, ordersByStatus } from "./kanban";

const order = (id: string, status: string): Order =>
  ({ id, code: id, type: "BALCAO", status, customerName: null, totalCents: 1000, items: [], delivererId: null, payment: null }) as Order;

describe("kanban: avanço do clique de hoje (rota legada)", () => {
  it("avança na ordem do fluxo que a API atual aceita", () => {
    expect(nextStatus("PENDENTE")).toBe("CONFIRMADO");
    expect(nextStatus("PRONTO")).toBe("CONCLUIDO");
  });

  it("NÃO leva a SAIU_PARA_ENTREGA: a API atual recusaria (a coluna existe, o clique não vai para lá)", () => {
    expect(nextStatus("PRONTO")).not.toBe("SAIU_PARA_ENTREGA");
  });

  it("depois de CONCLUIDO, em SAIU_PARA_ENTREGA e a partir de CANCELADO não avança", () => {
    expect(nextStatus("CONCLUIDO")).toBeNull();
    expect(nextStatus("SAIU_PARA_ENTREGA")).toBeNull();
    expect(nextStatus("CANCELADO")).toBeNull();
  });

  it("filtra pedidos por status", () => {
    const list = [order("1", "PENDENTE"), order("2", "PRONTO"), order("3", "PENDENTE")];
    expect(ordersByStatus(list, "PENDENTE").map((o) => o.id)).toEqual(["1", "3"]);
  });
});

describe("colunas do quadro (contrato B3 §10)", () => {
  it("SAIU_PARA_ENTREGA tem coluna própria, entre Pronto e Concluído", () => {
    const i = KANBAN_COLUMNS.indexOf("SAIU_PARA_ENTREGA");
    expect(i).toBeGreaterThan(KANBAN_COLUMNS.indexOf("PRONTO"));
    expect(i).toBeLessThan(KANBAN_COLUMNS.indexOf("CONCLUIDO"));
  });

  it("CANCELADO é a única exceção e está fora do quadro de propósito", () => {
    expect(OFF_BOARD_STATUSES).toEqual(["CANCELADO"]);
    expect(KANBAN_COLUMNS).not.toContain("CANCELADO");
  });
});

describe("groupOrders: nenhum pedido some por status (contrato B3 §10)", () => {
  it("percorre TODO o enum: cada valor cai em exatamente uma coluna, ou fora só se for CANCELADO", () => {
    for (const status of ORDER_STATUSES) {
      const { byStatus, others } = groupOrders([order("x", status)]);
      const places = [...Object.values(byStatus), others].filter((list) => list.some((o) => o.id === "x")).length;
      if (OFF_BOARD_STATUSES.includes(status)) expect(places, `${status} fica fora`).toBe(0);
      else expect(places, `${status} aparece em um lugar só`).toBe(1);
    }
  });

  it("todo valor do enum que não é coluna nem está fora de propósito teria um lugar (nenhum buraco no enum)", () => {
    const covered = new Set<string>([...KANBAN_COLUMNS, ...OFF_BOARD_STATUSES]);
    // O que sobrar do enum cairia em "Outros": o teste acima garante que aparece. Aqui garantimos que
    // hoje não sobra nada, então "Outros" fica vazio com a API conhecida.
    expect(ORDER_STATUSES.filter((s) => !covered.has(s))).toEqual([]);
  });

  it("status que a tela nunca viu cai em 'Outros', não desaparece", () => {
    const { others, byStatus } = groupOrders([order("a", "ESTADO_DO_FUTURO"), order("b", "PENDENTE")]);
    expect(others.map((o) => o.id)).toEqual(["a"]);
    expect(byStatus.PENDENTE.map((o) => o.id)).toEqual(["b"]);
  });

  it("status vazio, minúsculo ou com espaço também vão para 'Outros'", () => {
    const { others } = groupOrders([order("1", ""), order("2", "pendente"), order("3", "PENDENTE ")]);
    expect(others.map((o) => o.id)).toEqual(["1", "2", "3"]);
  });

  it("a quantidade total se conserva: coluna + Outros + cancelados = entrada", () => {
    const all = [...ORDER_STATUSES.map((s, i) => order(`s${i}`, s)), order("novo1", "NOVO_1"), order("novo2", "NOVO_2")];
    const { byStatus, others } = groupOrders(all);
    const onBoard = Object.values(byStatus).reduce((n, list) => n + list.length, 0) + others.length;
    const cancelled = all.filter((o) => OFF_BOARD_STATUSES.includes(o.status)).length;
    expect(onBoard + cancelled).toBe(all.length);
  });

  it("lista vazia: colunas vazias e nenhum 'Outros'", () => {
    const { byStatus, others } = groupOrders([]);
    expect(others).toEqual([]);
    expect(Object.keys(byStatus)).toEqual([...KANBAN_COLUMNS]);
  });
});

describe("rótulos de status", () => {
  it("todo valor do enum tem rótulo em português", () => {
    for (const status of ORDER_STATUSES) expect(STATUS_LABELS[status].length).toBeGreaterThan(2);
    expect(STATUS_LABELS.SAIU_PARA_ENTREGA).toBe("Em entrega");
  });

  it("status desconhecido ganha texto neutro, nunca o código cru", () => {
    expect(statusLabel("ESTADO_DO_FUTURO")).toBe(UNKNOWN_STATUS_LABEL);
    expect(statusLabel("PRONTO")).toBe("Pronto");
  });
});
