import type { ReactNode } from "react";
import { Modal } from "@/shared/ui/Modal";

type CashModalLayoutProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  titleId: string;
  info?: string;
  error?: string | null;
  footer: ReactNode;
  children: ReactNode;
};

export function CashModalLayout({ open, onClose, title, titleId, info, error, footer, children }: CashModalLayoutProps) {
  return (
    <Modal open={open} onClose={onClose} labelledBy={titleId} width={720}>
      <header className="cash-modal__header">
        <h4 id={titleId}>{title}</h4>
      </header>
      <div className="cash-modal__body">
        {info && <div className="cash-modal__info">{info}</div>}
        {children}
        {error && <p className="cash-modal__error">{error}</p>}
      </div>
      <footer className="cash-modal__footer">{footer}</footer>
    </Modal>
  );
}
