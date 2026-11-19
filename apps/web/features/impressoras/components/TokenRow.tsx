"use client";

import type { DeviceToken } from "@/core/domain/deviceTokens";
import { Button } from "@/shared/design/components";

export const tokenName = (token: DeviceToken) => token.label || "(sem nome)";

function StatusBadge({ token }: { token: DeviceToken }) {
  if (token.revokedAt) return <span className="impressoras-row__status impressoras-row__status--revoked">revogada</span>;
  if (token.online) return <span className="impressoras-row__status impressoras-row__status--online">● online</span>;
  return <span className="impressoras-row__status impressoras-row__status--offline">○ offline</span>;
}

export function TokenRow({ token, onRevoke }: { token: DeviceToken; onRevoke: (token: DeviceToken) => void }) {
  return (
    <div className="impressoras-row">
      <div>
        <strong>{tokenName(token)}</strong> <StatusBadge token={token} />
        {/* Espaço de verdade entre os trechos: sem ele o leitor de tela lê "offlinechave uIQA" */}
        {token.tokenPreview && <> <span className="impressoras-row__seen">chave {token.tokenPreview}</span></>}
        {token.lastSeenAt && (
          <> <span className="impressoras-row__seen">última vez vista: {new Date(token.lastSeenAt).toLocaleString("pt-BR")}</span></>
        )}
      </div>
      {!token.revokedAt && (
        <Button variant="quiet" className="impressoras-row__revoke" aria-label={`Revogar chave ${tokenName(token)}`} onClick={() => onRevoke(token)}>
          Revogar
        </Button>
      )}
    </div>
  );
}
