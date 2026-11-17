"use client";

import { useState } from "react";
import { isPasswordLongEnough, PASSWORD_TOO_SHORT_MESSAGE } from "./passwordPolicy";

// Quando mostrar o erro de tamanho (spec 16 §2): DEPOIS da tentativa de envio ou ao SAIR do campo, nunca a cada tecla. Se o servidor
// recusar pelo tamanho, aparece a mesma frase no campo (`serverRejected`).
export function usePasswordRule(value: string, serverRejected = false) {
  const [touched, setTouched] = useState(false);
  const tooShort = !isPasswordLongEnough(value);
  const error = (touched && tooShort) || serverRejected ? PASSWORD_TOO_SHORT_MESSAGE : null;

  return {
    error,
    onBlur: () => setTouched(true),
    /** Chame no envio: marca como tocado e diz se pode enviar. */
    validate: () => {
      setTouched(true);
      return !tooShort;
    },
  };
}
