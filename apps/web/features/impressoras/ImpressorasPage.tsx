"use client";

import { NewTokenCard } from "./components/NewTokenCard";
import { TokenRow } from "./components/TokenRow";
import { useImpressoras } from "./hooks/useImpressoras";
import "./impressoras.css";

export function ImpressorasPage() {
  const { tokens, forbidden, create, revoke } = useImpressoras();

  function confirmRevoke(id: string) {
    if (!confirm("Revogar essa chave? O print-client conectado com ela para de funcionar.")) return;
    revoke(id);
  }

  return (
    <main className="impressoras">
      <h1>Chaves de impressora</h1>
      <p className="impressoras__intro">
        Cada PC com impressora térmica usa uma chave própria no módulo de impressão local (print-client). Só o dono da loja pode
        criar ou revogar chaves.
      </p>

      {forbidden && <p className="impressoras__error impressoras__error--block">Essa ação é restrita ao dono da loja.</p>}

      <NewTokenCard onCreate={create} />

      <div className="impressoras__list">
        {tokens?.map((token) => <TokenRow key={token.id} token={token} onRevoke={confirmRevoke} />)}
        {tokens?.length === 0 && <p className="impressoras__empty">Nenhuma chave gerada ainda.</p>}
      </div>
    </main>
  );
}
