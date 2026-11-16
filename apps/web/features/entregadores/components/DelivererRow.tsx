import type { Deliverer } from "@/core/domain/orders";

type DelivererRowProps = {
  deliverer: Deliverer;
  onToggleActive: () => void;
  onRemove: () => void;
};

export function DelivererRow({ deliverer, onToggleActive, onRemove }: DelivererRowProps) {
  return (
    <div className="entregadores__row">
      <div>
        <strong>{deliverer.name}</strong>
        {deliverer.phone && <span className="entregadores__phone">{deliverer.phone}</span>}
        {!deliverer.active && <span className="entregadores__inactive">(inativo)</span>}
      </div>
      <div className="entregadores__actions">
        <button type="button" onClick={onToggleActive}>
          {deliverer.active ? "desativar" : "ativar"}
        </button>
        <button type="button" className="entregadores__danger" onClick={onRemove}>
          excluir
        </button>
      </div>
    </div>
  );
}
