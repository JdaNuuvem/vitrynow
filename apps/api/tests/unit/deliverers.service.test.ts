import { describe, expect, it } from "vitest";
import type { Deliverer, Order } from "@meucardapio/db";
import type { DeliverersRepository } from "../../src/modules/deliverers/deliverers.repository";
import { DeliverersService } from "../../src/modules/deliverers/deliverers.service";
import { ConflictError, NotFoundError } from "../../src/shared/errors";
import { FakeAudit, FakeStoreEvents, actor, rec } from "./fakes";

function setup(opts: { deliverers?: Deliverer[]; orders?: Order[]; ongoing?: number } = {}) {
  const log: string[] = [];
  const repo = {
    find: async (storeId: string, id: string) => (opts.deliverers ?? []).find((d) => d.id === id && d.storeId === storeId) ?? null,
    findOrder: async (storeId: string, id: string) => (opts.orders ?? []).find((o) => o.id === id && o.storeId === storeId) ?? null,
    countOngoingDeliveries: async () => opts.ongoing ?? 0,
    delete: async (id: string) => void log.push(`delete:${id}`),
    setOrderDeliverer: async (orderId: string, delivererId: string | null) => void log.push(`assign:${orderId}:${delivererId}`),
  } as unknown as DeliverersRepository;
  const audit = new FakeAudit();
  const events = new FakeStoreEvents();
  return { service: new DeliverersService(repo, audit, events), audit, events, log };
}

const deliverer = rec<Deliverer>({ id: "d-1", storeId: "store-1", name: "João" });
const order = rec<Order>({ id: "o-1", storeId: "store-1" });

describe("DeliverersService", () => {
  it("não exclui entregador com entrega em andamento (409)", async () => {
    const { service, log } = setup({ deliverers: [deliverer], ongoing: 2 });
    await expect(service.delete(actor, "d-1")).rejects.toThrow(ConflictError);
    await expect(service.delete(actor, "d-1")).rejects.toThrow("2 entrega(s) em andamento");
    expect(log).toEqual([]);
  });

  it("exclui entregador livre e audita com o nome", async () => {
    const { service, audit, log } = setup({ deliverers: [deliverer] });
    await service.delete(actor, "d-1");
    expect(log).toEqual(["delete:d-1"]);
    expect(audit.entries[0]).toMatchObject({ action: "deliverer.delete", metadata: { name: "João" } });
  });

  it("atribui entregador ao pedido e avisa o painel em tempo real", async () => {
    const { service, log, events } = setup({ deliverers: [deliverer], orders: [order] });
    await service.assignToOrder("store-1", "o-1", "d-1");
    expect(log).toEqual(["assign:o-1:d-1"]);
    expect(events.updated).toEqual([{ storeId: "store-1", orderId: "o-1" }]);
  });

  it("delivererId null desatribui sem consultar entregador", async () => {
    const { service, log } = setup({ orders: [order] });
    await service.assignToOrder("store-1", "o-1", null);
    expect(log).toEqual(["assign:o-1:null"]);
  });

  it("pedido inexistente é 404 e nada é gravado nem notificado", async () => {
    const { service, log, events } = setup({ deliverers: [deliverer] });
    await expect(service.assignToOrder("store-1", "nada", "d-1")).rejects.toThrow("pedido não encontrado");
    expect(log).toEqual([]);
    expect(events.updated).toEqual([]);
  });

  it("entregador de outra loja é 404 (isolamento entre lojas)", async () => {
    const { service, log } = setup({ deliverers: [rec<Deliverer>({ id: "d-9", storeId: "store-2" })], orders: [order] });
    await expect(service.assignToOrder("store-1", "o-1", "d-9")).rejects.toThrow(NotFoundError);
    expect(log).toEqual([]);
  });
});
