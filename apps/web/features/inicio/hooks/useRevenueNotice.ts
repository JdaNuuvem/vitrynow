"use client";

import { useCallback, useEffect, useState } from "react";

// Aviso de uma vez só "Mudamos como contamos o faturamento" (B14.1): aparece até o dono dizer "Entendi" e não volta.
// A chave leva a versão: se a regra mudar de novo, sobe o número e o aviso reaparece.
const STORAGE_KEY = "panel.inicio.revenueDefinitionNotice.v1";

export function useRevenueNotice() {
  // Começa escondido: no servidor e na 1ª pintura não se sabe se o dono já viu, e piscar o aviso a cada visita incomoda.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(STORAGE_KEY) !== "1");
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = useCallback(() => {
    setVisible(false);
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // sem armazenamento: some só nesta sessão
    }
  }, []);

  return { visible, dismiss };
}
