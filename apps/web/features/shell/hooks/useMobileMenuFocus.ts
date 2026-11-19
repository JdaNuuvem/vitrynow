"use client";

import { useEffect, useRef, type RefObject } from "react";

// O gatilho pode estar no cabeçalho ou na navegação inferior.
export function useMobileMenuFocus(open: boolean, containerRef: RefObject<HTMLElement>, onClose: () => void, opener?: RefObject<HTMLElement>) {
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      triggerRef.current = opener?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
      wasOpen.current = true;
      containerRef.current?.focus();
    } else if (wasOpen.current) {
      wasOpen.current = false;
      const trigger = triggerRef.current;
      if (trigger && document.contains(trigger)) trigger.focus();
    }
  }, [open, containerRef, opener]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const panel = containerRef.current;
      if (!panel || (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
      if (event.key === "Escape") {
        onCloseRef.current();
      } else if (event.key === "Tab") {
        const items = panel.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, containerRef]);
}
