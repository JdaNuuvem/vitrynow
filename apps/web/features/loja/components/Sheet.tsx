"use client";

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { CloseIcon } from "../icons";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// Folha do cardápio (carrinho e checkout), spec 09 §10.2: diálogo acessível.
//  - role="dialog" aria-modal com título associado;
//  - foco entra na folha ao abrir, fica preso nela (Tab/Shift+Tab) e volta ao gatilho ao fechar;
//  - Esc e toque no fundo fecham;
//  - o resto da página fica `inert` enquanto a folha está aberta (nem Tab nem leitor de tela chegam lá);
//  - ≤ 800 px é bottom sheet, ≥ 801 px é modal de 520 px (CSS).
export function Sheet({
  title,
  onClose,
  tall = false,
  purchase = false,
  children,
}: {
  title: string;
  onClose: () => void;
  tall?: boolean;
  purchase?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Torna inerte tudo que não é a folha, subindo até a raiz da vitrine (.loja).
    const inerted: Element[] = [];
    let node: Element = root;
    while (node.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
      if (node.parentElement.classList.contains("loja")) break;
      node = node.parentElement;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    return () => {
      inerted.forEach((element) => element.removeAttribute("inert"));
      document.body.style.overflow = previousOverflow;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={rootRef}
      className="loja__sheet"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={`loja__sheet-panel${tall ? " loja__sheet-panel--tall" : ""}${purchase ? " loja__sheet-panel--purchase" : ""}`}
      >
        <div className="loja__sheet-head">
          <h2 id={titleId} className="loja__sheet-title">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="loja__sheet-close" aria-label="Fechar">
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
