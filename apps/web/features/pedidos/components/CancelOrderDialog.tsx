"use client";

import { useId, useState } from "react";
import type { Order } from "@/core/domain/orders";
import { formatCents } from "@/shared/format/money";
import { Modal } from "@/shared/ui/Modal";
import { CANCEL_REASONS, customerPhraseFor, validateCancel, type CancelDraft } from "../cancelReasons";
import { confirmCancelLabel, isRefundPending, kitchenNotWarned } from "../orderActions";
import type { CancelOutcome } from "../hooks/usePedidos";

// Texto validado pelo Ogilvy (17/11): primeiro o fato, depois o que fazer.
export const KITCHEN_NOT_WARNED_MESSAGE = "Este pedido já foi impresso e a impressora não avisa o cancelamento. Avise a cozinha.";

type Props = {
  order: Order;
  // O estorno é do dono: a API já só oferece "refund" a quem pode, esta janela só descreve o efeito.
  refund: boolean;
  onConfirm: (draft: CancelDraft) => Promise<CancelOutcome>;
  onRetryRefund: () => Promise<CancelOutcome>;
  onClose: () => void;
};

// Folha de recusar/cancelar (spec 02 §5, GRW-15). O botão que confirma REPETE o efeito e o valor
// ("Cancelar e estornar R$ 69,00"); nunca "Tem certeza?". O texto que o cliente verá é fixo e só leitura.
export function CancelOrderDialog({ order, refund, onConfirm, onRetryRefund, onClose }: Props) {
  const titleId = useId();
  const noteId = useId();
  const [draft, setDraft] = useState<CancelDraft>({ code: null, text: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Estorno já pedido: vem do pedido (reabrir a folha cai direto em "Tentar estorno") OU de uma tentativa feita nesta folha.
  const [attemptPending, setAttemptPending] = useState(false);
  const refundPending = isRefundPending(order) || attemptPending;

  const refusing = order.status === "PENDENTE";
  const verb = refusing ? "Recusar" : "Cancelar";
  const title = refundPending ? `Estorno do pedido #${order.code}` : refund ? `${verb} e estornar #${order.code}` : `${verb} pedido #${order.code}`;
  const validation = validateCancel(draft);
  const phrase = customerPhraseFor(draft.code);
  const confirmLabel = busy ? (refund ? "Estornando…" : refusing ? "Recusando…" : "Cancelando…") : confirmCancelLabel(order, formatCents);
  const retryLabel = busy ? "Tentando…" : `Tentar estorno de ${formatCents(order.totalCents)}`;

  function close() {
    // Com o estorno em andamento a folha não fecha (nem por Esc): fechar no meio esconderia o resultado.
    if (!busy) onClose();
  }

  async function run(action: () => Promise<CancelOutcome>) {
    setBusy(true);
    setError(null);
    const outcome = await action();
    setBusy(false);
    if (outcome.kind === "done") return onClose();
    if (outcome.kind === "refund-pending") return setAttemptPending(true);
    setError(outcome.message);
  }

  return (
    <Modal open onClose={close} labelledBy={titleId} width={480} sheetOnMobile fitContent closeOnScrim={!busy}>
      <form
        className="cancel-dialog"
        onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          if (refundPending) return void run(onRetryRefund);
          if (validation.ok) void run(() => onConfirm(draft));
        }}
      >
        <h2 id={titleId}>{title}</h2>

        {/* API-67 (Leonardo): em LEGACY a impressora não avisa a cozinha; o dono é quem avisa. Nunca em QUEUE. */}
        {kitchenNotWarned(order) && (
          <p role="note" className="cancel-dialog__kitchen">
            {/* ícone de atenção de linha (padrão das faixas de atenção); decorativo, o texto já diz tudo */}
            <svg className="cancel-dialog__kitchen-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>{KITCHEN_NOT_WARNED_MESSAGE}</span>
          </p>
        )}

        {refund && !refundPending && (
          <p className="cancel-dialog__effect">
            PIX de {formatCents(order.totalCents)} pago{order.customerName ? ` por ${order.customerName}` : ""}. Ao confirmar, o valor é devolvido ao cliente e o
            pedido só é cancelado depois que o estorno for aceito.
          </p>
        )}

        {refundPending && attemptPending && (
          <div role="alert" className="cancel-dialog__alert">
            Não foi possível estornar agora. O pedido continua como está.
          </div>
        )}
        {refundPending && !attemptPending && (
          <p className="cancel-dialog__effect" role="status">
            O estorno de {formatCents(order.totalCents)} ainda não foi aceito. O pedido continua como está e só é cancelado depois que o estorno for aceito.
          </p>
        )}
        {error && !(refundPending && attemptPending) && (
          <div role="alert" className="cancel-dialog__alert">
            {error}
          </div>
        )}

        {/* Folha reaberta com o estorno já pedido: não há motivo a escolher, só repetir o estorno. */}
        {!(refundPending && draft.code === null) && (
          <fieldset className="cancel-dialog__reasons" disabled={busy || refundPending}>
            <legend>{refusing ? "Por que você está recusando?" : "Por que você está cancelando?"}</legend>
            {CANCEL_REASONS.map((reason) => (
              <label key={reason.code} className={draft.code === reason.code ? "is-checked" : undefined}>
                <input type="radio" name="motivo" value={reason.code} checked={draft.code === reason.code} onChange={() => setDraft((previous) => ({ ...previous, code: reason.code }))} />
                {reason.label}
              </label>
            ))}
          </fieldset>
        )}

        {draft.code === "OUTRO" && (
          <div>
            <label htmlFor={noteId} className="cancel-dialog__label">
              Escreva o motivo (só a loja vê)
            </label>
            <textarea id={noteId} rows={2} maxLength={500} value={draft.text} disabled={busy || refundPending} onChange={(event) => setDraft((previous) => ({ ...previous, text: event.target.value }))} />
          </div>
        )}

        {/* GRW-15: a frase é fixa por motivo e o dono não edita; aqui ele só vê o que o cliente verá. */}
        {phrase && (
          <p className="cancel-dialog__customer">
            O cliente verá: <q>{phrase}</q>
          </p>
        )}

        <div className="cancel-dialog__actions">
          {/* `aria-disabled` (não `disabled`) enquanto roda: um botão desabilitado perde o foco e o passo de MFA, que
              devolve o foco a quem estava focado ao abrir, voltaria para o body (Deming, A2). O envio fica barrado em onSubmit. */}
          <button
            type="submit"
            className={refund || !refusing || refundPending ? "is-danger" : undefined}
            aria-disabled={busy || (!refundPending && !validation.ok) || undefined}
          >
            {refundPending ? retryLabel : confirmLabel}
          </button>
          {!refundPending && !validation.ok && <p className="cancel-dialog__hint">{validation.hint}</p>}
          <button type="button" className="cancel-dialog__back" onClick={close} disabled={busy}>
            Voltar
          </button>
        </div>
      </form>
    </Modal>
  );
}
