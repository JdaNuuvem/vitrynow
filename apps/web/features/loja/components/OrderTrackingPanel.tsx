import { useState } from "react";
import { statusLabel } from "@/core/domain/orderLabels";
import type { OrderTracking } from "@/core/domain/storefront";
import type { ReadOrderTracking } from "@/core/gateways/StorefrontGateway";
import { TRACKING_UNAVAILABLE_MESSAGE } from "../hooks/useOrderFlow";

export function OrderTrackingPanel({ read, chatLink }: { read: ReadOrderTracking; chatLink?: string | null }) {
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const result = await read();
      if (result.ok) {
        setTracking(result.data);
      } else if (result.status === 404) {
        setTracking(null);
        setUnavailable(true);
      } else {
        setError("Não foi possível atualizar o andamento. Tente novamente.");
      }
    } catch {
      setError("Não foi possível atualizar o andamento. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  if (unavailable) return (
    <div>
      <p role="status" className="loja__order-note">{TRACKING_UNAVAILABLE_MESSAGE}</p>
      {chatLink && <a href={chatLink} target="_blank" rel="noreferrer" className="loja__empty-menu-link">Falar com a loja no WhatsApp</a>}
    </div>
  );

  return (
    <div className="loja__tracking">
      <div aria-live="polite">
        {tracking && (
          <>
            <p className="loja__tracking-status">Status do pedido · <strong>{statusLabel(tracking.order.status)}</strong></p>
            {tracking.order.awaitingPayment && <p className="loja__order-note">Aguardando pagamento.</p>}
            {tracking.timeline.length > 0 && (
              <ol className="loja__tracking-timeline" aria-label="Histórico de andamento">
                {tracking.timeline.map((event, index) => (
                  <li key={index}>
                    <span>{statusLabel(event.status)}</span>
                    <time dateTime={event.at}>{new Date(event.at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time>
                  </li>
                ))}
              </ol>
            )}
            {tracking.cancelReason && <p className="loja__order-note">{tracking.cancelReason.customerMessage}</p>}
            {tracking.cancelReason?.moneyLine && <p className="loja__order-note">{tracking.cancelReason.moneyLine}</p>}
          </>
        )}
        {error && <p className="loja__order-note">{error}</p>}
      </div>
      <button type="button" className="loja__tracking-button" onClick={refresh} disabled={loading}>
        {loading ? "Consultando andamento…" : error ? "Tentar novamente" : tracking ? "Atualizar andamento" : "Acompanhar pedido"}
      </button>
    </div>
  );
}
