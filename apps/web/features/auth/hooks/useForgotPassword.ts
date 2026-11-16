"use client";

import { useState } from "react";
import { useAuthGateway } from "@/core/services/AuthServices";

// A API nunca revela se o e-mail existe, então qualquer resposta vira "enviado".
export function useForgotPassword() {
  const auth = useAuthGateway();
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit(email: string) {
    setLoading(true);
    await auth.forgotPassword(email);
    setLoading(false);
    setSent(true);
  }

  return { submit, loading, sent };
}
