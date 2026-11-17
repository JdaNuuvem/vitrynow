import { useEffect, useRef, useState } from "react";
import type { PixPayment } from "@/core/domain/storefront";
import { formatCents } from "@/shared/format/money";
import type { OrderSummary } from "../checkoutForm";
import { PIX_EXPIRED_MESSAGE, PIX_PAID_REASSURANCE, PIX_RESUMED_MESSAGE, TRACKING_UNAVAILABLE_MESSAGE } from "../hooks/useOrderFlow";
import { Sheet } from "./Sheet";

// Conversa com a loja no WhatsApp, só com o código do pedido na mensagem (sem token nem dado do cliente). Sem número
// cadastrado devolve null e a tela mostra só o texto.
export function storeChatLink(whatsapp: string | null | undefined, code: string): string | null {
  const digits = (whatsapp ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(`Pedido #${code}`)}` : null;
}

const formatClock = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

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
  trackingUnavailable = false,
  resume = "none",
  pixExpiresAt = null,
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
  // NG-16: sem acesso ao pedido neste aparelho: sem acompanhar o PIX nem cancelar; o cliente fala com a loja.
  trackingUnavailable?: boolean;
  // WEB-33b: tela recuperada depois de recarregar (só QR) ou com o PIX vencido.
  resume?: "none" | "valid" | "expired";
  pixExpiresAt?: number | null;
  summary?: OrderSummary | null;
  whatsapp?: string | null;
  onCancel: () => void | Promise<void>;
  onBack: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [copyNote, setCopyNote] = useState<string | null>(null);
  const pixCodeRef = useRef<HTMLTextAreaElement>(null);
  const chatLink = storeChatLink(whatsapp, code);

  async function copyPixCode() {
    try {
      await navigator.clipboard.writeText(pixData?.pixQrCode ?? "");
      setCopyNote("Código PIX copiado.");
    } catch {
      // sem permissão ou sem suporte: deixa o código selecionado para o cliente copiar
      pixCodeRef.current?.focus();
      pixCodeRef.current?.select();
      setCopyNote("Não deu para copiar sozinho. Copie o código selecionado abaixo.");
    }
  }

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

  if (resume === "expired") {
    return (
      <main className="loja__result">
        <h1 ref={headingRef} tabIndex={-1} className="loja__result-title">
          {`Pedido #${code}`}
        </h1>
        <p role="status" className="loja__result-text">
          {PIX_EXPIRED_MESSAGE}
        </p>
        {chatLink && (
          <a href={chatLink} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
            Falar com a loja no WhatsApp
          </a>
        )}
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
  const resumedValid = resume === "valid" && awaitingPix;
  const watchingPix = awaitingPix && !trackingUnavailable;
  const title = paymentConfirmed ? "Pagamento confirmado" : resumedValid ? `Pedido #${code} enviado` : awaitingPix ? `Pedido #${code}` : "Pedido enviado";

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
        ) : watchingPix ? (
          <p className="loja__result-hint">Aguardando confirmação do pagamento…</p>
        ) : awaitingPix ? null : (
          <p className="loja__result-text">A loja ainda precisa aceitar o pedido.</p>
        )}
      </div>

      {resumedValid && (
        <div role="status" className="loja__result-notice">
          <p className="loja__result-text">{PIX_RESUMED_MESSAGE}</p>
          {pixExpiresAt !== null && <p className="loja__result-hint">Vale até {formatClock(pixExpiresAt)}</p>}
          {chatLink && (
            <a href={chatLink} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
              Falar com a loja no WhatsApp
            </a>
          )}
        </div>
      )}

      {trackingUnavailable && !paymentConfirmed && !resumedValid && (
        <div role="status" className="loja__result-notice">
          <p className="loja__result-text">{TRACKING_UNAVAILABLE_MESSAGE}</p>
          {pixData && <p className="loja__result-text">{PIX_PAID_REASSURANCE}</p>}
          {chatLink && (
            <a href={chatLink} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
              Falar com a loja no WhatsApp
            </a>
          )}
        </div>
      )}

      {awaitingPix && pixData && (
        <>
          <p className="loja__result-text">Escaneie o QR Code ou copie o código para pagar via PIX:</p>
          {!resumedValid && <p className="loja__result-warning">Não feche esta página antes de pagar.</p>}
          {pixData.pixQrCode && (
            <>
              <button type="button" onClick={copyPixCode} className="loja__cta">
                Copiar código PIX
              </button>
              <p aria-live="polite" className="loja__result-hint">
                {copyNote}
              </p>
            </>
          )}
          {pixData.pixQrCodeBase64 && (
            // eslint-disable-next-line @next/next/no-img-element -- QR em data: URL, não há otimização possível
            <img src={`data:image/png;base64,${pixData.pixQrCodeBase64}`} alt="QR Code PIX" className="loja__qr" />
          )}
          {pixData.pixQrCode && (
            <>
              <label htmlFor="loja-pix-code" className="loja__label">
                Código PIX (copia e cola)
              </label>
              <textarea id="loja-pix-code" ref={pixCodeRef} readOnly value={pixData.pixQrCode} className="loja__pix-code" rows={3} />
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
      {!paymentConfirmed && !trackingUnavailable && (
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
              {chatLink && (
                <a href={chatLink} target="_blank" rel="noreferrer" className="loja__empty-menu-link">
                  Falar com a loja no WhatsApp
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
