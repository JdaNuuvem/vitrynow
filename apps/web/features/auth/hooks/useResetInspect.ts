"use client";

import { useEffect, useState } from "react";
import { useAuthGateway } from "@/core/services/AuthServices";

export type ResetInspect =
  | { state: "checking" } // conferindo: ainda sem campo de senha
  | { state: "ok"; email: string } // e-mail mascarado, para mostrar como TEXTO
  | { state: "invalid" } // inválido, vencido, usado ou malformado: a API não diferencia o motivo
  | { state: "failed" }; // rede, 429 ou resposta inesperada: FALHA FECHADA, sem campo de senha

// E-mail mascarado só como texto curto: o que a API devolver fora disso é tratado como falha, nunca desenhado.
const MASKED_EMAIL = /^[^\s<>"'&]{1,254}$/;

// Confere o token na API UMA vez ao abrir a página (token no CORPO, nunca na URL) e de novo só quando a pessoa pede "Tentar de
// novo". Não manda mais nada ao servidor antes de a pessoa digitar a senha e enviar. O resultado vive só em memória.
export function useResetInspect(token: string) {
  const auth = useAuthGateway();
  const [result, setResult] = useState<ResetInspect>({ state: "checking" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setResult({ state: "checking" });
    auth.inspectResetToken(token).then((response) => {
      if (cancelled) return;
      if (!response.ok) return setResult({ state: "failed" });
      const { valid, email } = response.data ?? {};
      if (valid === false) return setResult({ state: "invalid" });
      if (valid === true && typeof email === "string" && MASKED_EMAIL.test(email)) return setResult({ state: "ok", email });
      setResult({ state: "failed" });
    });
    return () => {
      cancelled = true;
    };
  }, [auth, token, attempt]);

  return { result, retry: () => setAttempt((previous) => previous + 1) };
}
