"use client";

import { useEffect, useRef, type ReactNode } from "react";
import "./ui.css";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  width?: number;
  sheetOnMobile?: boolean;
  closeOnScrim?: boolean;
  children: ReactNode;
};

export function Modal({ open, onClose, labelledBy, width = 480, sheetOnMobile = false, closeOnScrim = true, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={`ui-modal${sheetOnMobile ? " ui-modal--sheet" : ""}`}>
      <div className="ui-modal__scrim" onClick={closeOnScrim ? onClose : undefined} />
      <div
        ref={panelRef}
        className="ui-modal__panel"
        style={{ width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
