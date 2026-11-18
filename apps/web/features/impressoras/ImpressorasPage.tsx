"use client";

import { useState } from "react";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { NewTokenCard } from "./components/NewTokenCard";
import { TokenRow, tokenName } from "./components/TokenRow";
import { useImpressoras } from "./hooks/useImpressoras";
import "./impressoras.css";

export function ImpressorasPage() {
  const { tokens, forbidden, create, revoke } = useImpressoras();
  const [toRevoke, setToRevoke] = useState<DeviceToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  function askRevoke(token: DeviceToken) {
    setRevokeError(null);
    setToRevoke(token);
  }

  async function confirmRevoke() {
    if (!toRevoke) return;
    setBusy(true);
    const outcome = await revoke(toRevoke.id);
    setBusy(false);
    // Recusada por papel: o aviso "restrito ao dono" já aparece na página, a janela só fecha.
    if (outcome.status === "error") return setRevokeError(outcome.message);
    setToRevoke(null);
  }

  return (
    <main className="impressoras">
      <h1>Chaves de impressora</h1>
      <p className="impressoras__intro">
        Cada PC com impressora térmica usa uma chave própria no módulo de impressão local (print-client). Só o dono da loja pode
        criar ou revogar chaves.
      </p>

      {forbidden && (
        <p role="alert" className="impressoras__error impressoras__error--block">
          Essa ação é restrita ao dono da loja.
        </p>
      )}

      {/* Sem lista (403) o usuário não é o dono: nada de formulário que também seria recusado. */}
      {(tokens !== null || !forbidden) && <NewTokenCard onCreate={create} />}

      <div className="impressoras__list">
        {tokens?.map((token) => <TokenRow key={token.id} token={token} onRevoke={askRevoke} />)}
        {tokens?.length === 0 && <p className="impressoras__empty">Nenhuma chave gerada ainda.</p>}
      </div>

      <ConfirmDialog
        open={toRevoke !== null}
        title={toRevoke ? `Revogar a chave "${tokenName(toRevoke)}"?` : ""}
        message="O print-client que usa essa chave para de funcionar e deixa de imprimir os pedidos. Para imprimir de novo naquele PC, gere uma chave nova e cole nele. Não dá para desfazer."
        confirmLabel={busy ? "Revogando…" : "Revogar chave"}
        tone="danger"
        busy={busy}
        error={revokeError}
        onConfirm={confirmRevoke}
        onCancel={() => !busy && setToRevoke(null)}
      />
    </main>
  );
}
