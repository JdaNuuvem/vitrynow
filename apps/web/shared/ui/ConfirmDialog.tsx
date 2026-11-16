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
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = "Voltar", tone = "primary", busy, error, onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} labelledBy="confirm-dialog-title" width={420}>
      <div className="confirm-dialog">
        <h3 id="confirm-dialog-title">{title}</h3>
        <p>{message}</p>
        {error && <p className="confirm-dialog__error">{error}</p>}
        <div className="confirm-dialog__actions">
          <button type="button" className={`confirm-dialog__confirm confirm-dialog__confirm--${tone}`} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="confirm-dialog__cancel" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
