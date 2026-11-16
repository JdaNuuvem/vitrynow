"use client";

import { useState } from "react";
import type { CheckoutStatus, PixCheckout } from "@/core/domain/subscription";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { Modal } from "@/shared/ui/Modal";

type PixCheckoutModalProps = {
  payment: PixCheckout | null;
  status: CheckoutStatus;
  onClose: () => void;
  onRetry: () => void;
};

const FAILURE_MESSAGES: Partial<Record<CheckoutStatus, string>> = {
  REJEITADO: "O pagamento não foi aprovado.",
  EXPIRADO: "O código Pix expirou.",
};

export function PixCheckoutModal({ payment, status, onClose, onRetry }: PixCheckoutModalProps) {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    if (!payment?.pixQrCode) return;
    try {
      await navigator.clipboard.writeText(payment.pixQrCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal open={payment !== null} onClose={onClose} labelledBy="pix-checkout-title" width={440}>
      {payment && (
        <div className="pix-checkout">
          <h3 id="pix-checkout-title">{status === "APROVADO" ? "Pagamento confirmado!" : "Pague com Pix"}</h3>

          {status === "APROVADO" && (
            <>
              <div className="pix-checkout__done">
                <Icon name="check" size={40} />
              </div>
              <p>Seu plano já está ativo. Obrigado!</p>
              <button type="button" className="pix-checkout__primary" onClick={onClose}>
                Fechar
              </button>
            </>
          )}

          {status === "PENDENTE" && (
            <>
              <p className="pix-checkout__amount">{formatCents(payment.amountCents)}</p>
              {payment.pixQrCodeBase64 && (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="pix-checkout__qr" src={`data:image/png;base64,${payment.pixQrCodeBase64}`} alt="QR Code do Pix" />
              )}
              {payment.pixQrCode && (
                <div className="pix-checkout__copy">
                  <input readOnly value={payment.pixQrCode} aria-label="Pix copia e cola" />
                  <button type="button" onClick={copyCode}>
                    <Icon name={copied ? "check" : "copy"} size={16} />
                    {copied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
              )}
              <p className="pix-checkout__waiting">
                <span className="pix-checkout__spinner" aria-hidden="true" />
                Aguardando o pagamento... a confirmação é automática.
              </p>
              <button type="button" className="pix-checkout__secondary" onClick={onClose}>
                Fechar
              </button>
            </>
          )}

          {(status === "REJEITADO" || status === "EXPIRADO" || status === "REEMBOLSADO") && (
            <>
              <p className="pix-checkout__error">{FAILURE_MESSAGES[status] ?? "O pagamento foi estornado."}</p>
              <button type="button" className="pix-checkout__primary" onClick={onRetry}>
                Gerar novo Pix
              </button>
              <button type="button" className="pix-checkout__secondary" onClick={onClose}>
                Fechar
              </button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
