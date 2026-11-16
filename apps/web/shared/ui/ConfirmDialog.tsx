"use client";

import { Modal } from "./Modal";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  error?: string | null;
  // Segunda ação entre a principal e o "Voltar" (ex.: "Excluir de vez" ao lado de "Ocultar").
  alternative?: { label: string; onClick: () => void; tone?: "primary" | "danger" };
  // Janela só informativa: um botão só, sem "Voltar".
  hideCancel?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = "Voltar", tone = "primary", busy, error, alternative, hideCancel, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-dialog-title" width={420}>
      <div className="confirm-dialog">
        <h3 id="confirm-dialog-title">{title}</h3>
        <p>{message}</p>
        {error && (
          <p className="confirm-dialog__error" role="alert">
            {error}
          </p>
        )}
        <div className="confirm-dialog__actions">
          <button type="button" className={`confirm-dialog__confirm confirm-dialog__confirm--${tone}`} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
          {alternative && (
            <button
              type="button"
              className={`confirm-dialog__confirm confirm-dialog__confirm--${alternative.tone ?? "danger"}`}
              disabled={busy}
              onClick={alternative.onClick}
            >
              {alternative.label}
            </button>
          )}
          {!hideCancel && (
            <button type="button" className="confirm-dialog__cancel" onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
