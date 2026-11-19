"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { DeviceToken } from "@/core/domain/deviceTokens";
import { ConfirmDialog } from "@/shared/ui/ConfirmDialog";
import { Button, PageHeading, Panel, StateMessage } from "@/shared/design/components";
import { DeviceAlertsPanel } from "./components/DeviceAlertsPanel";
import { NewTokenCard } from "./components/NewTokenCard";
import { PrintConfigurationPanel } from "./components/PrintConfigurationPanel";
import { TokenRow, tokenName } from "./components/TokenRow";
import { useImpressoras } from "./hooks/useImpressoras";
import "./impressoras.css";

export function ImpressorasPage() {
  const { tokens, forbidden, loading, loadError, reload, create, revoke } = useImpressoras();
  const [toRevoke, setToRevoke] = useState<DeviceToken | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const revoking = useRef(false);

  function askRevoke(token: DeviceToken) {
    setRevokeError(null);
    setToRevoke(token);
  }

  async function confirmRevoke() {
    if (!toRevoke || revoking.current) return;
    revoking.current = true;
    setRevokeError(null);
    setBusy(true);
    const outcome = await revoke(toRevoke.id);
    revoking.current = false;
    setBusy(false);
    // Recusada por papel: o aviso "restrito ao dono" já aparece na página, a janela só fecha.
    if (outcome.status === "error") return setRevokeError(outcome.message);
    setToRevoke(null);
  }

  return (
    <main className="impressoras">
      <PageHeading title="Impressoras"
        description="Configure o print-client da loja, acompanhe alertas e gerencie as chaves dos dispositivos."
        actions={<Link className="ds-button ds-button--secondary" href="/dashboard/impressoras/fila">Abrir fila de impressão</Link>} />
      {forbidden && <StateMessage tone="danger" title="Essa ação é restrita ao dono da loja." />}
      {loading && !tokens && <StateMessage title="Consultando dispositivos…" busy />}
      {loadError && <StateMessage title="Falha ao consultar as chaves" tone="danger"
        action={<Button disabled={loading} onClick={() => void reload()}>Tentar novamente</Button>}>{loadError}</StateMessage>}
      {tokens && <>
        <div className="print-settings__grid">
          <PrintConfigurationPanel />
          <NewTokenCard onCreate={create} />
        </div>
        <Panel title="Chaves de impressora" actions={<Button disabled={loading} onClick={() => void reload()}>Atualizar chaves</Button>}>
          <div className="impressoras__list" aria-busy={loading}>
            {tokens.map((token) => <TokenRow key={token.id} token={token} onRevoke={askRevoke} />)}
            {!tokens.length && <p className="print-settings__muted">Nenhuma chave gerada ainda.</p>}
          </div>
        </Panel>
        <DeviceAlertsPanel />
      </>}

      <ConfirmDialog
        open={toRevoke !== null}
        title={toRevoke ? `Revogar a chave "${tokenName(toRevoke)}"?` : ""}
        message="O print-client que usa essa chave para de funcionar e deixa de imprimir os pedidos. Para imprimir de novo naquele PC, gere uma chave nova e cole nele. Não dá para desfazer."
        confirmLabel={busy ? "Revogando…" : "Revogar chave"}
        tone="danger"
        busy={busy}
        error={revokeError}
        onConfirm={confirmRevoke}
        onCancel={() => !revoking.current && setToRevoke(null)}
      />
    </main>
  );
}
