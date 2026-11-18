"use client";

import { DelivererRow } from "./components/DelivererRow";
import { NewDelivererForm } from "./components/NewDelivererForm";
import { useEntregadores } from "./hooks/useEntregadores";
import "./entregadores.css";

export function EntregadoresPage() {
  const { deliverers, error, create, toggleActive, remove } = useEntregadores();

  return (
    <main className="entregadores">
      <h1>Entregadores</h1>

      <NewDelivererForm onCreate={create} />

      {error && <p className="entregadores__error">{error}</p>}

      <div className="entregadores__list">
        {deliverers.map((deliverer) => (
          <DelivererRow
            key={deliverer.id}
            deliverer={deliverer}
            onToggleActive={() => toggleActive(deliverer)}
            onRemove={() => remove(deliverer.id)}
          />
        ))}
        {deliverers.length === 0 && <p className="entregadores__empty">Nenhum entregador cadastrado.</p>}
      </div>
    </main>
  );
}
