import { describe, expect, it } from "vitest";
import type { Order } from "@/core/domain/orders";
import { KANBAN_COLUMNS, nextStatus, ordersByStatus } from "./kanban";

const order = (id: string, status: Order["status"]): Order => ({
  id,
  code: id,
  type: "BALCAO",
  status,
  customerName: null,
  totalCents: 1000,
  items: [],
  delivererId: null,
  payment: null,
});

describe("kanban", () => {
  it("avança na ordem das colunas", () => {
    expect(nextStatus("PENDENTE")).toBe("CONFIRMADO");
    expect(nextStatus("PRONTO")).toBe("CONCLUIDO");
  });

  it("não avança depois de CONCLUIDO nem a partir de CANCELADO", () => {
    expect(nextStatus("CONCLUIDO")).toBeNull();
    expect(nextStatus("CANCELADO")).toBeNull();
  });

  it("CANCELADO não aparece em nenhuma coluna", () => {
    expect(KANBAN_COLUMNS).not.toContain("CANCELADO");
  });

  it("filtra pedidos por status", () => {
    const list = [order("1", "PENDENTE"), order("2", "PRONTO"), order("3", "PENDENTE")];
    expect(ordersByStatus(list, "PENDENTE").map((o) => o.id)).toEqual(["1", "3"]);
  });
});
