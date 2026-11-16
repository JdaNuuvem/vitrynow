import { useEffect, useRef, useState } from "react";
import type { PixPayment } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import type { OrderSummary } from "../checkoutForm";
import { Sheet } from "./Sheet";

// Telas pós-pedido (spec 09 §10.2): resumo do que foi pedido, "Voltar ao cardápio" como ação
// principal e o cancelamento numa folha que escreve o efeito (nunca confirm() nativo).
// Apresentação pura; cancelar e acompanhar pagamento ficam em useOrderFlow.
export function OrderResultScreen({
  code,
  cancelled,
  pixData,
  paymentConfirmed,
  paymentFailedMessage,
  cancelError,
  summary = null,
  whatsapp = null,
  onCancel,
  onBack,
}: {
  code: string;
  cancelled: boolean;
  pixData: PixPayment | null;
  paymentConfirmed: boolean;
  paymentFailedMessage: string | null;
  cancelError: string | null;
  summary?: OrderSummary | null;
  whatsapp?: string | null;
  onCancel: () => void | Promise<void>;
  onBack: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // Ao entrar na tela, o foco vai ao título: o leitor de tela anuncia o resultado.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  async function confirmCancel() {
    setCancelling(true);
    try {
      await onCancel();
    } finally {
      setCancelling(false);
    }
  }

  if (cancelled) {
    return (
      <main className="loja__result">
        <h1 ref={headingRef} tabIndex={-1} className="loja__result-title">
          Pedido #{code} cancelado
        </h1>
        <button type="button" onClick={onBack} className="loja__cta">
          Voltar ao cardápio
        </button>
      </main>
    );
  }

  if (pixData && paymentFailedMessage) {
    return (
      <main className="loja__result">
        <h1 ref={headingRef} tabIndex={-1} className="loja__result-title">
          Pedido #{code} não concluído
        </h1>
        <p className="loja__result-error" role="alert">
          {paymentFailedMessage}
        </p>
        <button type="button" onClick={onBack} className="loja__cta">
          Voltar ao cardápio
        </button>
      </main>
    );
  }

  const awaitingPix = Boolean(pixData) && !paymentConfirmed;
  const title = paymentConfirmed ? "Pagamento confirmado" : awaitingPix ? `Pedido #${code}` : "Pedido enviado";

  return (
    <main className="loja__result">
      <h1 ref={headingRef} tabIndex={-1} className="loja__result-title">
        {!awaitingPix && <span aria-hidden="true">✓ </span>}
        {title}
      </h1>
      {!awaitingPix && <p className="loja__result-code">Pedido #{code}</p>}

      <div role="status">
        {paymentConfirmed ? (
          <p className="loja__result-text loja__result-text--ok">Pagamento confirmado! Seu pedido já está sendo preparado.</p>
        ) : awaitingPix ? (
          <p className="loja__result-hint">Aguardando confirmação do pagamento…</p>
        ) : (
          <p className="loja__result-text">A loja ainda precisa aceitar o pedido.</p>
        )}
      </div>

      {awaitingPix && pixData && (
        <>
          <p className="loja__result-text">Escaneie o QR Code ou copie o código para pagar via PIX:</p>
          {pixData.pixQrCodeBase64 && (
            // eslint-disable-next-line @next/next/no-img-element -- QR em data: URL, não há otimização possível
            <img src={`data:image/png;base64,${pixData.pixQrCodeBase64}`} alt="QR Code PIX" className="loja__qr" />
          )}
          {pixData.pixQrCode && (
            <>
              <label htmlFor="loja-pix-code" className="loja__label">
                Código PIX (copia e cola)
              </label>
              <textarea id="loja-pix-code" readOnly value={pixData.pixQrCode} className="loja__pix-code" rows={3} />
            </>
          )}
        </>
      )}

      {summary && (
        <section className="loja__result-summary" aria-label="Resumo do pedido">
          <ul>
            {summary.lines.map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
          <p>
            Total {formatCents(summary.totalCents)} · {summary.paymentLabel}
          </p>
          <p>
            {summary.deliveryLabel}
            {summary.address ? ` · ${summary.address}` : ""}
          </p>
        </section>
      )}

      <button type="button" onClick={onBack} className="loja__cta">
        Voltar ao cardápio
      </button>
      {!paymentConfirmed && (
        <button type="button" onClick={() => setCancelOpen(true)} className="loja__result-secondary">
          Cancelar pedido
        </button>
      )}

      {cancelOpen && (
        <Sheet title="Cancelar este pedido?" onClose={() => setCancelOpen(false)}>
          <p className="loja__result-text">O pedido será cancelado e a loja será avisada.</p>
          {cancelError && (
            <div role="alert" className="loja__error-summary">
              <p>{cancelError}</p>
              {whatsapp && (
                <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
                  Falar com a loja
                </a>
              )}
            </div>
          )}
          <button type="button" onClick={confirmCancel} disabled={cancelling} className="loja__cta loja__cta--danger loja__cta--spaced">
            {cancelling ? "Cancelando…" : "Cancelar pedido"}
          </button>
          <button type="button" onClick={() => setCancelOpen(false)} className="loja__result-secondary">
            Manter pedido
          </button>
        </Sheet>
      )}
    </main>
  );
}
