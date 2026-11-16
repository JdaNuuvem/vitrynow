"use client";

import { useEffect, useRef, type RefObject } from "react";

// Foco do menu lateral no celular (UX-17). O menu é um painel que cobre a tela, não um diálogo:
//  - ao abrir, o foco entra nele (o leitor de tela anuncia o menu e o Tab começa pelos itens);
//  - ao fechar, o foco volta ao botão que abriu ("Mais"), em vez de se perder no topo da página;
//  - Esc fecha.
export function useMobileMenuFocus(open: boolean, containerRef: RefObject<HTMLElement>, onClose: () => void) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wasOpen.current = true;
      containerRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    }
  }, [open, containerRef]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
}
