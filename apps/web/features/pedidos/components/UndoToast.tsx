"use client";

import { useEffect, useRef, useState } from "react";

export const UNDO_TOAST_MS = 8000;

// Toast "Pedido #0123 · Pronto. Desfazer" (spec 02 §4): 8 s, e o contador PAUSA com o mouse por cima ou o
// foco dentro. Anunciado ao leitor de tela (role=status). Um por vez: quem usa troca a oferta.
export function UndoToast({ text, onUndo, onDismiss, durationMs = UNDO_TOAST_MS }: { text: string; onUndo: () => void; onDismiss: () => void; durationMs?: number }) {
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => dismissRef.current(), durationMs);
    return () => window.clearTimeout(timer);
  }, [paused, durationMs, text]);

  return (
    <div
      className="pedidos-toast"
      role="status"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span>{text}.</span>
      <button type="button" onClick={onUndo}>
        Desfazer
      </button>
    </div>
  );
}
