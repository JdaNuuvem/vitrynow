"use client";

import { useEffect, useRef, type ReactNode } from "react";
import "./ui.css";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
    // Quem abriu (o botão clicado): o foco volta para ele ao fechar, em vez de se perder no topo da página.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      // Foco preso na janela: Tab do último vai ao primeiro, Shift+Tab do primeiro vai ao último.
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === items[0] || active === panel)) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && active === items[items.length - 1]) {
        event.preventDefault();
        items[0].focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      if (trigger && document.contains(trigger)) trigger.focus();
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
