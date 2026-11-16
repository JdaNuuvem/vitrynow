"use client";

import type { ReactNode } from "react";
import { Modal } from "./Modal";

type InfoModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  closeLabel?: string;
  children: ReactNode;
};

export function InfoModal({ open, onClose, title, titleId, closeLabel = "Fechar", children }: InfoModalProps) {
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={766} sheetOnMobile>
      <div className="info-modal__handle" />
      <div className="info-modal__scroll">
        <h2 className="info-modal__title" id={titleId}>
          {title}
        </h2>
        <div className="info-modal__body">{children}</div>
        <button className="info-modal__close" type="button" onClick={onClose}>
          {closeLabel}
        </button>
      </div>
    </Modal>
  );
}

export function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="info-modal__section">
      <strong>{title}</strong>
      <div className="info-modal__section-desc">{children}</div>
    </div>
  );
}
