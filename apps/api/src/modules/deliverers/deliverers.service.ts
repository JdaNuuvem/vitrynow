import type { CreateDelivererInput, UpdateDelivererInput } from "@meucardapio/shared-types";
import type { Actor, AuditLogger } from "../../shared/audit";
import { ConflictError, NotFoundError } from "../../shared/errors";
import type { StoreEvents } from "../../shared/storeEvents";
import type { DeliverersRepository } from "./deliverers.repository";

// Entregadores da loja e a atribuição deles a pedidos de delivery.
export class DeliverersService {
  constructor(
    private readonly repo: DeliverersRepository,
    private readonly audit: AuditLogger,
    private readonly events: StoreEvents,
  ) {}

  list(storeId: string) {
    return this.repo.list(storeId);
  }

  create(storeId: string, input: CreateDelivererInput) {
    return this.repo.create(storeId, input);
  }

  async update(storeId: string, id: string, input: UpdateDelivererInput) {
    await this.require(storeId, id);
    return this.repo.update(id, input);
  }

  async delete(actor: Actor, id: string) {
    const deliverer = await this.require(actor.storeId, id);
    const ongoing = await this.repo.countOngoingDeliveries(id);
    if (ongoing > 0) {
      throw new ConflictError(`entregador tem ${ongoing} entrega(s) em andamento — conclua ou cancele antes de excluir`);
    }
    await this.repo.delete(id);
    this.audit.log({ ...actor, action: "deliverer.delete", targetType: "Deliverer", targetId: id, metadata: { name: deliverer.name } });
  }

  // delivererId null desatribui o entregador do pedido.
  async assignToOrder(storeId: string, orderId: string, delivererId: string | null) {
    if (!(await this.repo.findOrder(storeId, orderId))) throw new NotFoundError("pedido não encontrado");
    if (delivererId) await this.require(storeId, delivererId);
    await this.repo.setOrderDeliverer(orderId, delivererId);
    this.events.orderUpdated(storeId, orderId);
  }

  private async require(storeId: string, id: string) {
    const deliverer = await this.repo.find(storeId, id);
    if (!deliverer) throw new NotFoundError("entregador não encontrado");
    return deliverer;
  }
}
