"use client";

import type { DeviceToken } from "@/core/domain/deviceTokens";

function StatusBadge({ token }: { token: DeviceToken }) {
  if (token.revokedAt) return <span className="impressoras-row__status impressoras-row__status--revoked">revogada</span>;
  if (token.online) return <span className="impressoras-row__status impressoras-row__status--online">● online</span>;
  return <span className="impressoras-row__status impressoras-row__status--offline">○ offline</span>;
}

export function TokenRow({ token, onRevoke }: { token: DeviceToken; onRevoke: (id: string) => void }) {
  return (
    <div className="impressoras-row">
      <div>
        <strong>{token.label || "(sem nome)"}</strong> <StatusBadge token={token} />
        {token.lastSeenAt && (
          <span className="impressoras-row__seen">última vez vista: {new Date(token.lastSeenAt).toLocaleString("pt-BR")}</span>
        )}
      </div>
      {!token.revokedAt && (
        <button type="button" className="impressoras-row__revoke" onClick={() => onRevoke(token.id)}>
          revogar
        </button>
      )}
    </div>
  );
}
