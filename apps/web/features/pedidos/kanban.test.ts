import { describe, expect, it } from "vitest";
import { ORDER_STATUSES, type Order } from "@/core/domain/orders";
import { STATUS_LABELS, UNKNOWN_STATUS_LABEL, statusLabel } from "@/core/domain/orderLabels";
import { KANBAN_COLUMNS, OFF_BOARD_STATUSES, groupOrders, ordersByStatus } from "./kanban";

const order = (id: string, status: string): Order =>
  ({ id, code: id, type: "BALCAO", status, customerName: null, totalCents: 1000, items: [], delivererId: null, payment: null }) as Order;

describe("kanban: filtro por status", () => {
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

// RN-KB-04 (Leonardo): em Novos, Em preparo, Prontos e Em entrega o pedido que espera há mais tempo fica no TOPO;
// Concluídos: o mais recente primeiro. A API devolve createdAt decrescente e a tela não reordenava.
describe("ordem das colunas (RN-KB-04, WEB-29)", () => {
  const at = (minutesAgo: number) => new Date(Date.parse("2026-11-17T20:00:00.000Z") - minutesAgo * 60_000).toISOString();
  const timed = (id: string, status: string, minutesAgo: number, extra: Partial<Order> = {}): Order => ({ ...order(id, status), createdAt: at(minutesAgo), ...extra });
  const ids = (list: Order[]) => list.map((o) => o.id);

  it("Novos: 5 pedidos fora de ordem, o que espera há mais tempo (vermelho) vai para o topo", () => {
    // a API manda createdAt decrescente (o mais novo primeiro): 2, 6, 9, 14, 25 min
    const fromApi = [timed("n2", "PENDENTE", 2), timed("n6", "PENDENTE", 6), timed("n9", "PENDENTE", 9), timed("n14", "PENDENTE", 14), timed("n25", "PENDENTE", 25)];
    expect(ids(groupOrders(fromApi).byStatus.PENDENTE)).toEqual(["n25", "n14", "n9", "n6", "n2"]);
  });

  it("não depende da ordem em que a lista chega", () => {
    const shuffled = [timed("b", "PENDENTE", 9), timed("e", "PENDENTE", 2), timed("a", "PENDENTE", 25), timed("d", "PENDENTE", 6), timed("c", "PENDENTE", 14)];
    expect(ids(groupOrders(shuffled).byStatus.PENDENTE)).toEqual(["a", "c", "b", "d", "e"]);
  });

  it.each(["CONFIRMADO", "EM_PREPARO", "PRONTO", "SAIU_PARA_ENTREGA"])("%s: o mais antigo primeiro", (status) => {
    const list = [timed("novo", status, 3), timed("velho", status, 40), timed("meio", status, 15)];
    expect(ids(groupOrders(list).byStatus[status])).toEqual(["velho", "meio", "novo"]);
  });

  it("Concluídos: o mais RECENTE primeiro", () => {
    const list = [timed("c1", "CONCLUIDO", 300), timed("c2", "CONCLUIDO", 10), timed("c3", "CONCLUIDO", 120)];
    expect(ids(groupOrders(list).byStatus.CONCLUIDO)).toEqual(["c2", "c3", "c1"]);
  });

  it("usa a hora em que ENTROU no estado (statusChangedAt), não a de criação", () => {
    // p1 foi criado há 60 min mas entrou em Pronto há 5; p2 foi criado há 30 e entrou em Pronto há 20: p2 espera mais
    const list = [timed("p1", "PRONTO", 60, { statusChangedAt: at(5) }), timed("p2", "PRONTO", 30, { statusChangedAt: at(20) })];
    expect(ids(groupOrders(list).byStatus.PRONTO)).toEqual(["p2", "p1"]);
  });

  it("sem nenhuma hora: vai para o fim e mantém a ordem em que chegou", () => {
    const list = [order("s1", "PENDENTE"), timed("t1", "PENDENTE", 30), order("s2", "PENDENTE"), timed("t2", "PENDENTE", 5)];
    expect(ids(groupOrders(list).byStatus.PENDENTE)).toEqual(["t1", "t2", "s1", "s2"]);
  });

  it("empate de hora: conserva a ordem em que chegou (não embaralha)", () => {
    const list = [timed("a", "PENDENTE", 10), timed("b", "PENDENTE", 10), timed("c", "PENDENTE", 10)];
    expect(ids(groupOrders(list).byStatus.PENDENTE)).toEqual(["a", "b", "c"]);
  });

  it("hora inválida não quebra a ordenação", () => {
    const list = [timed("ok", "PENDENTE", 5), { ...order("ruim", "PENDENTE"), createdAt: "isto não é data" }];
    expect(ids(groupOrders(list).byStatus.PENDENTE)).toEqual(["ok", "ruim"]);
  });

  it("'Outros' também fica do mais antigo ao mais novo", () => {
    const list = [timed("x2", "ESTADO_NOVO", 3), timed("x1", "ESTADO_NOVO", 30)];
    expect(ids(groupOrders(list).others)).toEqual(["x1", "x2"]);
  });

  it("ordenar não perde nem duplica pedido e não altera a lista original", () => {
    const list = [timed("a", "PENDENTE", 3), timed("b", "PENDENTE", 30), timed("c", "PRONTO", 7)];
    const snapshot = ids(list);
    const groups = groupOrders(list);
    expect(ids(list)).toEqual(snapshot);
    expect(ids([...groups.byStatus.PENDENTE, ...groups.byStatus.PRONTO]).sort()).toEqual(["a", "b", "c"]);
  });
});
