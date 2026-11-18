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
  // Com `sheetOnMobile`, a folha ocupa a altura do CONTEÚDO (até o limite da tela) em vez de preencher a tela
  // toda: folhas curtas (cancelar pedido) não sobram com um vazio branco embaixo.
  fitContent?: boolean;
  closeOnScrim?: boolean;
  children: ReactNode;
};

export function Modal({ open, onClose, labelledBy, width = 480, sheetOnMobile = false, fitContent = false, closeOnScrim = true, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // Quem chama costuma passar uma função NOVA a cada render. Se o efeito dependesse dela, cada re-render
  // do conteúdo (escolher uma opção, digitar) reiniciaria o efeito: devolveria o foco ao gatilho e o
  // puxaria de volta ao painel, e o gatilho guardado passaria a ser o próprio painel (Esc "perdia" o foco).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Quem abriu (o botão clicado): o foco volta para ele ao fechar, em vez de se perder no topo da página.
  // Capturado no RENDER em que `open` vira verdadeiro, não no efeito: um filho com `autoFocus` (o campo do código do
  // MFA) é focado durante o commit, ANTES dos efeitos do pai, e o "gatilho" guardado passava a ser esse campo, que
  // some ao fechar: o foco ficava no body (Deming, resíduo do A2). A leitura é idempotente; o StrictMode não a repete.
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) {
    triggerRef.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // O resto da página fica inerte enquanto a janela está aberta (nem Tab nem leitor de tela chegam lá).
    const inerted: Element[] = [];
    let node: Element | null = rootRef.current;
    while (node?.parentElement) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && !sibling.hasAttribute("inert")) {
          sibling.setAttribute("inert", "");
          inerted.push(sibling);
        }
      }
      if (node.parentElement === document.body || node.parentElement.classList.contains("panel-root")) break;
      node = node.parentElement;
    }
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
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
      inerted.forEach((element) => element.removeAttribute("inert"));
      document.removeEventListener("keydown", onKeyDown);
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div ref={rootRef} className={`ui-modal${sheetOnMobile ? " ui-modal--sheet" : ""}${sheetOnMobile && fitContent ? " ui-modal--fit" : ""}`}>
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
