"use client";

import { useRef, useState } from "react";
import type { CheckoutStatus, PixCheckout } from "@/core/domain/subscription";
import { Button } from "@/shared/design/components";
import { formatCents } from "@/shared/format/money";
import { Icon } from "@/shared/icons/Icon";
import { Modal } from "@/shared/ui/Modal";
import { useStoreTimezone } from "@/features/shell/useStoreTimezone";
import { formatInStoreTimezone } from "@/shared/format/storeTime";

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
  const timeZone = useStoreTimezone();
  const [clipboard, setClipboard] = useState<{ paymentId: string; copied: boolean } | null>(null);
  const codeInput = useRef<HTMLInputElement>(null);
  const copied = clipboard?.paymentId === payment?.id && clipboard?.copied;

  async function copyCode() {
    if (!payment?.pixQrCode) return;
    try {
      await navigator.clipboard.writeText(payment.pixQrCode);
      setClipboard({ paymentId: payment.id, copied: true });
    } catch {
      codeInput.current?.focus();
      codeInput.current?.select();
      setClipboard({ paymentId: payment.id, copied: false });
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
              <Button variant="primary" onClick={onClose}>Fechar</Button>
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
                  <input ref={codeInput} readOnly value={payment.pixQrCode} aria-label="Pix copia e cola" onFocus={(event) => event.currentTarget.select()} />
                  <Button onClick={copyCode} icon={copied ? "check" : "copy"}>
                    {copied ? "Copiado!" : "Copiar"}
                  </Button>
                </div>
              )}
              {clipboard?.paymentId === payment.id && <p role="status">{copied ? "Código Pix copiado." : "O código está selecionado e pode ser copiado manualmente."}</p>}
              {payment.expiresAt && Number.isFinite(Date.parse(payment.expiresAt)) && <p className="pix-checkout__waiting">
                Válido até {formatInStoreTimezone(payment.expiresAt, timeZone)} (horário da loja).
              </p>}
              <p className="pix-checkout__waiting" role="status">
                <span className="pix-checkout__spinner" aria-hidden="true" />
                Aguardando o pagamento... a confirmação é automática.
              </p>
              <Button variant="quiet" onClick={onClose}>Fechar</Button>
            </>
          )}

          {(status === "REJEITADO" || status === "EXPIRADO" || status === "REEMBOLSADO") && (
            <>
              <p className="pix-checkout__error">{FAILURE_MESSAGES[status] ?? "O pagamento foi estornado."}</p>
              <Button variant="primary" onClick={onRetry}>Gerar novo Pix</Button>
              <Button variant="quiet" onClick={onClose}>Fechar</Button>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
