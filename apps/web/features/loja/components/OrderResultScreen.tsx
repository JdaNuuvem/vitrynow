import type { PixPayment } from "@/core/domain/storefront";

// Telas pós-pedido: cancelado, aguardando/confirmado PIX, ou pedido enviado (pagamento
// presencial). Apresentação pura; cancelar e acompanhar pagamento ficam em useOrderFlow.
export function OrderResultScreen({
  code,
  cancelled,
  pixData,
  paymentConfirmed,
  paymentFailedMessage,
  cancelError,
  onCancel,
  onBack,
}: {
  code: string;
  cancelled: boolean;
  pixData: PixPayment | null;
  paymentConfirmed: boolean;
  paymentFailedMessage: string | null;
  cancelError: string | null;
  onCancel: () => void;
  onBack: () => void;
}) {
  if (cancelled) {
    return (
      <main className="loja__result">
        <h1 className="loja__result-title">Pedido #{code} cancelado</h1>
        <button onClick={onBack} className="loja__result-link loja__result-link--back-lg">
          Voltar ao cardápio
        </button>
      </main>
    );
  }

  if (pixData && paymentFailedMessage) {
    return (
      <main className="loja__result">
        <h1 className="loja__result-title">Pedido #{code} não concluído</h1>
        <p className="loja__result-error" role="alert">
          {paymentFailedMessage}
        </p>
        <button onClick={onBack} className="loja__result-link loja__result-link--back-lg">
          Voltar ao cardápio
        </button>
      </main>
    );
  }

  if (pixData) {
    return (
      <main className="loja__result">
        <h1 className="loja__result-title">Pedido #{code}</h1>
        {paymentConfirmed ? (
          <p className="loja__result-text loja__result-text--ok">
            Pagamento confirmado! Seu pedido já está sendo preparado.
          </p>
        ) : (
          <>
            <p className="loja__result-text">Escaneie o QR Code ou copie o código para pagar via PIX:</p>
            {pixData.pixQrCodeBase64 && (
              <img src={`data:image/png;base64,${pixData.pixQrCodeBase64}`} alt="QR Code PIX" className="loja__qr" />
            )}
            {pixData.pixQrCode && <textarea readOnly value={pixData.pixQrCode} className="loja__pix-code" rows={3} />}
            <p className="loja__result-hint">Aguardando confirmação do pagamento...</p>
            {cancelError && <p className="loja__result-error">{cancelError}</p>}
            <button onClick={onCancel} className="loja__result-link loja__result-link--cancel">
              Cancelar pedido
            </button>
          </>
        )}
      </main>
    );
  }

  return (
    <main className="loja__result">
      <h1 className="loja__result-title">Pedido enviado!</h1>
      <p className="loja__result-text">Seu número de pedido é #{code}.</p>
      {cancelError && <p className="loja__result-error">{cancelError}</p>}
      <button onClick={onCancel} className="loja__result-link loja__result-link--cancel">
        Cancelar pedido
      </button>
      <button onClick={onBack} className="loja__result-link loja__result-link--back">
        Voltar ao cardápio
      </button>
    </main>
  );
}
